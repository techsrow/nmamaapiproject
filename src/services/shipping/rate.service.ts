import axios from "axios";
import crypto from "crypto";

import { prisma } from "../../lib/prisma";
import { credentialsFor } from "./provider.service";
import type { RateInput, ShippingRate } from "../../types/shipping";

type Config = Record<string, unknown>;

const TIMEOUT_MS = 15000;

class ShippingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShippingConfigError";
  }
}

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
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Config)
    : {};
}

function numberValue(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim())
  ) {
    return null;
  }

  const result = Number(value);

  return Number.isFinite(result) && result >= 0 ? result : null;
}

function amount(value: unknown): number {
  const result = numberValue(value);

  if (result === null) {
    throw new ShippingConfigError("Invalid shipping rate returned.");
  }

  return Math.round((result + Number.EPSILON) * 100) / 100;
}

function estimatedDays(value: unknown): number | undefined {
  const days = numberValue(value);
  return days !== null && days > 0 ? Math.ceil(days) : undefined;
}

function yes(value: unknown): boolean {
  return (
    value === true ||
    value === 1 ||
    ["1", "Y", "YES", "TRUE"].includes(
      String(value).trim().toUpperCase(),
    )
  );
}

function validateInput(input: RateInput): void {
  if (!/^[1-9][0-9]{5}$/.test(input.pickupPincode)) {
    throw new Error(
      "The store pickup PIN code is invalid. Update the active pickup location.",
    );
  }

  if (!/^[1-9][0-9]{5}$/.test(input.deliveryPincode)) {
    throw new Error("Enter a valid six-digit delivery PIN code.");
  }

  if (
    !Number.isFinite(input.declaredValue) ||
    input.declaredValue < 0 ||
    typeof input.cod !== "boolean"
  ) {
    throw new Error("Invalid shipping request.");
  }

  if (
    !input.package ||
    [
      input.package.weightKg,
      input.package.lengthCm,
      input.package.widthCm,
      input.package.heightCm,
    ].some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    throw new Error("Valid package weight and dimensions are required.");
  }
}

function logFailure(provider: string, error: unknown): void {
  if (axios.isAxiosError(error)) {
    let endpoint = "unknown";

    try {
      endpoint = new URL(error.config?.url || "").pathname;
    } catch {
      // Do not log headers, tokens, response bodies or customer details.
    }

    console.error("Shipping provider request failed", {
      provider,
      status: error.response?.status,
      endpoint,
      code: error.code,
    });

    return;
  }

  console.error("Shipping provider configuration failed", {
    provider,
    reason:
      error instanceof ShippingConfigError
        ? error.message
        : "Provider configuration could not be read.",
  });
}

export async function shiprocketToken(): Promise<string> {
  const { credentials } = await credentialsFor("Shiprocket");
  const email = String(credentials.email || "").trim();
  const password = String(credentials.password || "");

  if (!email || !password) {
    throw new ShippingConfigError(
      "Shiprocket email or password is missing.",
    );
  }

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

    if (typeof token !== "string" || !token.trim()) {
      throw new ShippingConfigError(
        "Shiprocket did not return an authentication token.",
      );
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
    if (tokenRequest?.promise === promise) tokenRequest = null;
  }
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
        headers: { Authorization: `Bearer ${token}` },
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
    throw new ShippingConfigError(
      "Shiprocket returned an invalid rates response.",
    );
  }

  const rates: ShippingRate[] = [];

  for (const courier of companies) {
    const rate = numberValue(courier.rate ?? courier.freight_charge);
    const id = courier.courier_company_id ?? courier.courier_id;
    const codAvailable = yes(courier.cod);

    if (
      rate === null ||
      id === undefined ||
      id === null ||
      (input.cod && !codAvailable)
    ) {
      continue;
    }

    rates.push({
      provider: "Shiprocket",
      courierName: String(courier.courier_name || "Shiprocket"),
      courierCode: String(id),
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
    throw new ShippingConfigError("Delhivery API token is missing.");
  }

  if (String(row.mode).toUpperCase() !== "LIVE") {
    throw new ShippingConfigError(
      "Delhivery checkout quotes require LIVE mode.",
    );
  }

  const billingMode = String(
    config.billingMode ?? process.env.DELHIVERY_BILLING_MODE ?? "",
  )
    .trim()
    .toUpperCase();

  if (billingMode !== "E" && billingMode !== "S") {
    throw new ShippingConfigError(
      "Configure Delhivery billingMode or DELHIVERY_BILLING_MODE as E or S.",
    );
  }

  const divisor = numberValue(
    config.volumetricDivisor ??
      process.env.DELHIVERY_VOLUMETRIC_DIVISOR,
  );

  if (divisor === null || divisor <= 0) {
    throw new ShippingConfigError(
      "Configure Delhivery volumetricDivisor or DELHIVERY_VOLUMETRIC_DIVISOR.",
    );
  }

  const headers = {
    Authorization: `Token ${token}`,
    Accept: "application/json",
  };

  const serviceResponse = await axios.get(
    "https://track.delhivery.com/c/api/pin-codes/json/",
    {
      headers,
      params: { filter_codes: input.deliveryPincode },
      timeout: TIMEOUT_MS,
    },
  );

  const codes = serviceResponse.data?.delivery_codes;

  if (!Array.isArray(codes)) {
    throw new ShippingConfigError(
      "Delhivery returned invalid serviceability data.",
    );
  }

  const postal = codes
    .map((entry: any) => entry?.postal_code)
    .find(
      (entry: any) =>
        String(entry?.pin).trim() === input.deliveryPincode,
    );

  if (!postal || String(postal.remarks || "").trim()) return [];

  const codAvailable = yes(postal.cod);

  if (
    (input.cod && !codAvailable) ||
    (!input.cod && !yes(postal.pre_paid))
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

  const quotes = rows.filter(
    (quote: any) =>
      quote &&
      !quote.error &&
      numberValue(quote.total_amount) !== null,
  );

  if (quotes.length !== 1) {
    throw new ShippingConfigError(
      "Delhivery returned an ambiguous or invalid quote.",
    );
  }

  const rate = amount(quotes[0].total_amount);

  if (rate <= 0) {
    throw new ShippingConfigError(
      "Delhivery did not return a usable shipping charge.",
    );
  }

  return [
    {
      provider: "Delhivery",
      courierName: String(row.displayName || "Delhivery"),
      courierCode: `Delhivery-${billingMode}`,
      rate,
      codAvailable,
      meta: { estimated: true, billingMode },
    },
  ];
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
    let reason = "";

    if (rule.zoneId !== null) {
      reason = "Zone matching requires destination country/state.";
    } else if (input.cod && !rule.codAllowed) {
      reason = "COD is not allowed.";
    } else if (
      rule.minOrderValue !== null &&
      input.declaredValue < Number(rule.minOrderValue)
    ) {
      reason = "Order value is below the rule minimum.";
    } else if (
      rule.maxOrderValue !== null &&
      input.declaredValue > Number(rule.maxOrderValue)
    ) {
      reason = "Order value exceeds the rule maximum.";
    } else if (
      rule.minWeightKg !== null &&
      input.package.weightKg < Number(rule.minWeightKg)
    ) {
      reason = "Package weight is below the rule minimum.";
    } else if (
      rule.maxWeightKg !== null &&
      input.package.weightKg > Number(rule.maxWeightKg)
    ) {
      reason = "Package weight exceeds the rule maximum.";
    } else if (String(rule.rateType).toUpperCase() !== "FLAT") {
      reason = "This rate adapter supports FLAT rules only.";
    }

    if (!reason && rule.pincodes !== null) {
      if (!Array.isArray(rule.pincodes)) {
        reason = "The rule pincode configuration is invalid.";
      } else {
        const pins = rule.pincodes.map((pin) =>
          String(pin).trim(),
        );

        if (
          pins.length > 0 &&
          !pins.includes(input.deliveryPincode)
        ) {
          reason = "The destination does not match the rule.";
        }
      }
    }

    if (reason) {
      console.info("Shipping rule skipped", {
        ruleId: rule.id,
        reason,
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
      codFee === null ||
      (rule.freeAbove !== null && freeAbove === null)
    ) {
      console.warn("Shipping rule has invalid amounts", {
        ruleId: rule.id,
      });
      continue;
    }

    const freeShipping =
      freeAbove !== null && input.declaredValue >= freeAbove;
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
          priority: rule.priority,
          freeShipping,
          deliveryCharge,
          codFee: additionalCodFee,
        },
      },
    ];
  }

  console.warn("No active shipping rule matched", {
    provider,
    activeRuleCount: rules.length,
  });

  return [];
}

export async function getShippingRates(
  input: RateInput,
): Promise<ShippingRate[]> {
  const normalized: RateInput = {
    ...input,
    pickupPincode: String(input.pickupPincode ?? "").trim(),
    deliveryPincode: String(input.deliveryPincode ?? "").trim(),
  };

  validateInput(normalized);

  const providers = await prisma.shippingProviderConfig.findMany({
    where: { isEnabled: true },
    orderBy: { id: "asc" },
  });

  if (!providers.length) {
    throw new Error("No shipping provider is currently enabled.");
  }

  // ShippingRule currently has no provider association.
  // Use one enabled rule-based provider to prevent duplicate options.
  const ruleProvider =
    providers.find((provider) => provider.provider === "Local") ??
    providers.find((provider) => provider.provider === "Custom");

  const results = await Promise.all(
    providers.map(async (provider): Promise<ShippingRate[]> => {
      try {
        let rates: ShippingRate[];

        switch (provider.provider) {
          case "Shiprocket":
            rates = await shiprocketRates(normalized);
            break;

          case "Delhivery":
            rates = await delhiveryRates(normalized, provider);
            break;

          case "Local":
          case "Custom":
            if (provider.id !== ruleProvider?.id) return [];

            rates = await configuredRuleRates(
              normalized,
              provider.provider,
            );
            break;

          default:
            console.warn("Shipping rate adapter is unavailable", {
              provider: provider.provider,
            });
            return [];
        }

        if (!rates.length) {
          console.warn("Shipping provider returned no eligible rates", {
            provider: provider.provider,
          });
        }

        return rates;
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
        (!normalized.cod || rate.codAvailable),
    )
    .sort((a, b) => a.rate - b.rate);

  if (!rates.length) {
    throw new Error(
      "No delivery method is available for this address, order value and payment method.",
    );
  }

  return rates;
}