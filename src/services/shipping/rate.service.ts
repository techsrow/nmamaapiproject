import axios from "axios";
import crypto from "crypto";

import { prisma } from "../../lib/prisma";
import { credentialsFor } from "./provider.service";
import type { RateInput, ShippingRate } from "../../types/shipping";

type Config = Record<string, unknown>;

const TIMEOUT_MS = 15000;

let tokenCache: {
  token: string;
  until: number;
  credentialHash: string;
} | null = null;

let tokenRequest: {
  credentialHash: string;
  promise: Promise<string>;
} | null = null;

function configObject(value: unknown): Config {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Config;
  }

  return {};
}

function numberValue(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }

  const result = Number(value);

  return Number.isFinite(result) && result >= 0 ? result : null;
}

function amount(value: unknown): number {
  const result = numberValue(value);

  if (result === null) {
    throw new Error("Provider returned an invalid shipping rate.");
  }

  return Math.round((result + Number.EPSILON) * 100) / 100;
}

function estimatedDays(value: unknown): number | undefined {
  const result = numberValue(value);
  return result !== null && result > 0 ? Math.ceil(result) : undefined;
}

function yes(value: unknown): boolean {
  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    String(value).toUpperCase() === "Y"
  );
}

function validateInput(input: RateInput): void {
  if (
    !/^[1-9][0-9]{5}$/.test(String(input.pickupPincode)) ||
    !/^[1-9][0-9]{5}$/.test(String(input.deliveryPincode))
  ) {
    throw new Error("Valid pickup and delivery pincodes are required.");
  }

  if (
    !Number.isFinite(input.declaredValue) ||
    input.declaredValue < 0 ||
    typeof input.cod !== "boolean"
  ) {
    throw new Error("Invalid shipping request.");
  }

  const dimensions = [
    input.package.weightKg,
    input.package.lengthCm,
    input.package.widthCm,
    input.package.heightCm,
  ];

  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Valid package weight and dimensions are required.");
  }
}

function logFailure(provider: string, error: unknown): void {
  if (axios.isAxiosError(error)) {
    let endpoint = "unknown";

    try {
      endpoint = new URL(error.config?.url || "").pathname;
    } catch {
      // Never log request headers, credentials, tokens or payloads.
    }

    console.error("Shipping provider request failed", {
      provider,
      status: error.response?.status,
      endpoint,
      code: error.code,
    });

    return;
  }

  // Avoid logging arbitrary exception objects containing sensitive data.
  console.error("Shipping provider configuration or response failed", {
    provider,
  });
}

export async function shiprocketToken(): Promise<string> {
  // Also confirms Shiprocket remains enabled.
  const { credentials } = await credentialsFor("Shiprocket");

  const email = String(credentials.email || "").trim();
  const password = String(credentials.password || "");

  if (!email || !password) {
    throw new Error("Shiprocket credentials are incomplete.");
  }

  // Changing either credential invalidates the cached token.
  const credentialHash = crypto
    .createHash("sha256")
    .update(JSON.stringify([email, password]))
    .digest("hex");

  if (
    tokenCache?.credentialHash === credentialHash &&
    Date.now() < tokenCache.until
  ) {
    return tokenCache.token;
  }

  if (tokenRequest?.credentialHash === credentialHash) {
    return tokenRequest.promise;
  }

  const promise = (async () => {
    const response = await axios.post(
      "https://apiv2.shiprocket.in/v1/external/auth/login",
      { email, password },
      { timeout: TIMEOUT_MS },
    );

    const token = response.data?.token;

    if (typeof token !== "string" || !token) {
      throw new Error("Shiprocket token not received.");
    }

    tokenCache = {
      token,
      credentialHash,
      until: Date.now() + 5 * 24 * 60 * 60 * 1000,
    };

    return token;
  })();

  tokenRequest = { credentialHash, promise };

  try {
    return await promise;
  } finally {
    if (tokenRequest?.promise === promise) {
      tokenRequest = null;
    }
  }
}

async function configuredRuleRates(
  input: RateInput,
  provider: "Local" | "Custom",
): Promise<ShippingRate[]> {
  const rules = await prisma.shippingRule.findMany({
    where: { isActive: true },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
  });

  for (const rule of rules) {
    // Zone matching requires destination country/state.
    // Do not accidentally apply a zone-specific rule everywhere.
    if (rule.zoneId !== null) continue;

    if (input.cod && !rule.codAllowed) continue;

    const orderValue = input.declaredValue;
    const weight = input.package.weightKg;

    if (
      rule.minOrderValue !== null &&
      orderValue < Number(rule.minOrderValue)
    ) {
      continue;
    }

    if (
      rule.maxOrderValue !== null &&
      orderValue > Number(rule.maxOrderValue)
    ) {
      continue;
    }

    if (
      rule.minWeightKg !== null &&
      weight < Number(rule.minWeightKg)
    ) {
      continue;
    }

    if (
      rule.maxWeightKg !== null &&
      weight > Number(rule.maxWeightKg)
    ) {
      continue;
    }

    if (rule.pincodes !== null) {
      if (!Array.isArray(rule.pincodes)) {
        console.warn("Invalid shipping rule pincode configuration", {
          ruleId: rule.id,
        });
        continue;
      }

      const pins = rule.pincodes.map((pin) => String(pin).trim());

      if (
        pins.length > 0 &&
        !pins.includes(String(input.deliveryPincode))
      ) {
        continue;
      }
    }

    // The current admin saves flat charges.
    // Unsupported types must not silently be treated as flat rates.
    if (rule.rateType !== "FLAT") {
      console.warn("Unsupported shipping rule rate type", {
        ruleId: rule.id,
        rateType: rule.rateType,
      });
      continue;
    }

    const baseRate = numberValue(String(rule.rate));
    const freeAbove =
      rule.freeAbove === null
        ? null
        : numberValue(String(rule.freeAbove));

    const codFee =
      rule.codFee === null
        ? 0
        : numberValue(String(rule.codFee));

    if (
      baseRate === null ||
      (rule.freeAbove !== null && freeAbove === null) ||
      codFee === null
    ) {
      console.warn("Invalid shipping rule amounts", {
        ruleId: rule.id,
      });
      continue;
    }

    // A saved threshold of zero means free shipping for every order.
    const freeShipping =
      freeAbove !== null && orderValue >= freeAbove;

    const deliveryCharge = freeShipping ? 0 : baseRate;
    const additionalCodFee = input.cod ? codFee : 0;

    return [
      {
        provider,
        courierName: rule.methodName || rule.name,
        courierCode: `rule-${rule.id}`,
        rate: amount(deliveryCharge + additionalCodFee),
        estimatedDays: estimatedDays(
          rule.estimatedMaxDays ?? rule.estimatedMinDays,
        ),
        codAvailable: rule.codAllowed,
        meta: {
          source: "ShippingRule",
          ruleId: rule.id,
          ruleName: rule.name,
          priority: rule.priority,
          baseRate,
          freeShipping,
          deliveryCharge,
          codFee: additionalCodFee,
          estimatedMinDays: rule.estimatedMinDays,
          estimatedMaxDays: rule.estimatedMaxDays,
        },
      },
    ];
  }

  return [];
}

async function shiprocketRates(
  input: RateInput,
): Promise<ShippingRate[]> {
  const token = await shiprocketToken();

  let data: any;

  try {
    const response = await axios.get(
      "https://apiv2.shiprocket.in/v1/external/courier/serviceability/",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          pickup_postcode: input.pickupPincode,
          delivery_postcode: input.deliveryPincode,
          weight: input.package.weightKg,
          cod: input.cod ? 1 : 0,
          declared_value: input.declaredValue,
        },
        timeout: TIMEOUT_MS,
      },
    );

    data = response.data;
  } catch (error) {
    // Expired/revoked tokens are cleared. Do not retry a blocked account.
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401
    ) {
      tokenCache = null;
    }

    throw error;
  }

  const companies = data?.data?.available_courier_companies;

  if (!Array.isArray(companies)) {
    throw new Error("Shiprocket returned an invalid rates response.");
  }

  const rates: ShippingRate[] = [];

  for (const courier of companies) {
    const rate = numberValue(courier.rate ?? courier.freight_charge);
    const courierId =
      courier.courier_company_id ?? courier.courier_id;

    const codAvailable = yes(courier.cod);

    if (
      rate === null ||
      courierId === undefined ||
      courierId === null ||
      (input.cod && !codAvailable)
    ) {
      continue;
    }

    rates.push({
      provider: "Shiprocket",
      courierName: String(courier.courier_name || "Shiprocket Courier"),
      courierCode: String(courierId),
      rate: amount(rate),
      estimatedDays: estimatedDays(
        courier.estimated_delivery_days ?? courier.etd_days,
      ),
      codAvailable,
      meta: { estimated: true },
    });
  }

  return rates;
}

async function delhiveryRates(
  input: RateInput,
  providerConfig: unknown,
): Promise<ShippingRate[]> {
  const row = configObject(providerConfig);
  const config = configObject(row.publicConfig);

  const { credentials } = await credentialsFor("Delhivery");
  const token = String(credentials.token || "").trim();

  if (!token) {
    throw new Error("Delhivery API token is missing.");
  }

  // Production account rates are required for checkout.
  if (String(row.mode).toUpperCase() !== "LIVE") {
    throw new Error("Delhivery checkout rates require LIVE configuration.");
  }

  // Configure these according to the merchant's Delhivery contract.
  const billingMode = config.billingMode;

  if (billingMode !== "E" && billingMode !== "S") {
    throw new Error("Delhivery billingMode must be configured as E or S.");
  }

  const divisor = numberValue(config.volumetricDivisor);

  if (divisor === null || divisor <= 0) {
    throw new Error("Delhivery volumetricDivisor must be configured.");
  }

  const headers = {
    Authorization: `Token ${token}`,
    Accept: "application/json",
  };

  const serviceResponse = await axios.get(
    "https://track.delhivery.com/c/api/pin-codes/json/",
    {
      headers,
      params: {
        filter_codes: input.deliveryPincode,
      },
      timeout: TIMEOUT_MS,
    },
  );

  const codes = serviceResponse.data?.delivery_codes;

  if (!Array.isArray(codes)) {
    throw new Error("Delhivery returned invalid serviceability data.");
  }

  const postal = codes
    .map((entry: any) => entry?.postal_code)
    .find(
      (entry: any) =>
        String(entry?.pin) === String(input.deliveryPincode),
    );

  if (!postal) return [];

  // A provider restriction must not be overridden locally.
  if (String(postal.remarks || "").trim()) return [];

  const codAvailable = yes(postal.cod);
  const prepaidAvailable = yes(postal.pre_paid);

  if (
    (input.cod && !codAvailable) ||
    (!input.cod && !prepaidAvailable)
  ) {
    return [];
  }

  const volumetricKg =
    (input.package.lengthCm *
      input.package.widthCm *
      input.package.heightCm) /
    divisor;

  const chargeableGrams = Math.ceil(
    Math.max(input.package.weightKg, volumetricKg) * 1000,
  );

  const response = await axios.get(
    "https://track.delhivery.com/api/kinko/v1/invoice/charges/.json",
    {
      headers,
      params: {
        md: billingMode,
        ss: "Delivered",
        d_pin: input.deliveryPincode,
        o_pin: input.pickupPincode,
        cgm: chargeableGrams,
        pt: input.cod ? "COD" : "Pre-paid",
        ...(input.cod ? { cod: input.declaredValue } : {}),
      },
      timeout: TIMEOUT_MS,
    },
  );

  const rows = Array.isArray(response.data)
    ? response.data
    : [response.data];

  const validQuotes = rows.filter(
    (quote: any) =>
      quote &&
      !quote.error &&
      numberValue(quote.total_amount) !== null,
  );

  if (validQuotes.length !== 1) {
    throw new Error("Delhivery returned an ambiguous or invalid quote.");
  }

  const quote = validQuotes[0];
  const rate = amount(quote.total_amount);

  // Zero carrier estimates should not silently become free delivery.
  if (rate <= 0) {
    throw new Error("Delhivery did not return a usable shipping charge.");
  }

  return [
    {
      provider: "Delhivery",
      courierName: String(row.displayName || "Delhivery"),
      courierCode: `Delhivery-${billingMode}`,
      rate,
      codAvailable,
      meta: {
        estimated: true,
        billingMode,
      },
    },
  ];
}

function localRates(
  input: RateInput,
  row: any,
): ShippingRate[] {
  const config = configObject(row.publicConfig);

  if (
    config.pincodes !== undefined &&
    !Array.isArray(config.pincodes)
  ) {
    throw new Error("Invalid local shipping pincode configuration.");
  }

  const pins = Array.isArray(config.pincodes)
    ? config.pincodes.map((pin) => String(pin).trim())
    : [];

  // Preserves the existing rule: an empty list covers all pincodes.
  if (
    pins.length > 0 &&
    !pins.includes(String(input.deliveryPincode))
  ) {
    return [];
  }

  const codAvailable = config.codAllowed === true;

  if (input.cod && !codAvailable) {
    return [];
  }

  // A rate must be explicitly configured. Zero is allowed if saved in admin.
  const baseRate = numberValue(config.rate);

  if (baseRate === null) {
    throw new Error("Local shipping rate is not configured.");
  }

  const freeAbove =
    config.freeAbove === undefined
      ? null
      : numberValue(config.freeAbove);

  if (
    config.freeAbove !== undefined &&
    freeAbove === null
  ) {
    throw new Error("Invalid free-shipping threshold.");
  }

  const freeShipping =
    freeAbove !== null &&
    freeAbove > 0 &&
    input.declaredValue >= freeAbove;

  return [
    {
      provider: row.provider,
      courierName: String(row.displayName || row.provider),
      courierCode: String(row.id),
      rate: freeShipping ? 0 : amount(baseRate),
      estimatedDays: estimatedDays(config.estimatedDays),
      codAvailable,
      meta: {
        local: true,
        freeShipping,
      },
    },
  ];
}

export async function getShippingRates(
  input: RateInput,
): Promise<ShippingRate[]> {
  validateInput(input);

  const providers = await prisma.shippingProviderConfig.findMany({
    where: { isEnabled: true },
    orderBy: { id: "asc" },
  });

  if (!providers.length) {
    throw new Error("No shipping provider is currently enabled.");
  }

  // ShippingRule has no provider association.
  // Choose one enabled rule-based provider to avoid duplicate methods.
  const ruleProvider =
    providers.find((row) => row.provider === "Local") ??
    providers.find((row) => row.provider === "Custom");

  const results = await Promise.all(
    providers.map(async (provider): Promise<ShippingRate[]> => {
      try {
        switch (provider.provider) {
          case "Shiprocket":
            return await shiprocketRates(input);

          case "Delhivery":
            return await delhiveryRates(input, provider);

          case "Local":
          case "Custom":
            if (provider.id !== ruleProvider?.id) return [];

            return await configuredRuleRates(
              input,
              provider.provider,
            );

          default:
            console.warn("Shipping rate adapter is unavailable", {
              provider: provider.provider,
            });
            return [];
        }
      } catch (error) {
        logFailure(provider.provider, error);
        return [];
      }
    }),
  );

  const rates = results
    .flat()
    .filter(
      (rate) =>
        Number.isFinite(rate.rate) &&
        rate.rate >= 0 &&
        (!input.cod || rate.codAvailable),
    )
    .sort((a, b) => a.rate - b.rate);

  if (!rates.length) {
    throw new Error(
      "No delivery method is available for this address, order value and payment method.",
    );
  }

  return rates;
}