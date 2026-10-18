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

export async function shiprocketToken(existingShipment=false): Promise<string> {
  const { credentials } = await credentialsFor("Shiprocket",existingShipment);
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

export type ShippingRuleInput = { deliveryPincode: string; declaredValue: number; cod: boolean; weightKg: number; country?: string; region?: string };
export async function getConfiguredRuleRates(
  input: ShippingRuleInput,
): Promise<ShippingRate[]> {
  if (!/^[1-9][0-9]{5}$/.test(input.deliveryPincode) || !Number.isFinite(input.declaredValue) || input.declaredValue < 0 || typeof input.cod !== "boolean") throw new Error("Invalid shipping request.");
  const rules = await prisma.shippingRule.findMany({
    where: { isActive: true },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
  });

  // Normal ranges win. If none match, priority chooses a default, relaxing only
  // order-value bounds; destination, weight and COD restrictions remain mandatory.
  for (const fallback of [false, true]) {
  for (const rule of rules) {
    let reason = "";

    if (rule.zoneId !== null) {
      const zone = await prisma.shippingZone.findUnique({ where: { id: rule.zoneId } });
      const normalize = (value: unknown) => String(value ?? "").trim().toUpperCase();
      const matches = (values: unknown, target: string | undefined, optional: boolean) =>
        (values === null && optional) || (Array.isArray(values) && ((optional && !values.length) || values.some(value => typeof value === "string" && normalize(value) === normalize(target))));
      if (!zone?.isActive || !matches(zone.countries, input.country, false) || !matches(zone.regions, input.region, true)) reason = "The destination does not match the active shipping zone.";
    }
    if (input.cod && !rule.codAllowed) {
      reason = "COD is not allowed.";
    } else if (
      !fallback && rule.minOrderValue !== null &&
      input.declaredValue < Number(rule.minOrderValue)
    ) {
      reason = "Order value is below the rule minimum.";
    } else if (
      !fallback && rule.maxOrderValue !== null &&
      input.declaredValue > Number(rule.maxOrderValue)
    ) {
      reason = "Order value exceeds the rule maximum.";
    } else if ((rule.minWeightKg !== null || rule.maxWeightKg !== null) && (!Number.isFinite(input.weightKg) || input.weightKg <= 0)) {
      reason = "Valid weight is required for this rule.";
    } else if (
      rule.minWeightKg !== null &&
      input.weightKg < Number(rule.minWeightKg)
    ) {
      reason = "Package weight is below the rule minimum.";
    } else if (
      rule.maxWeightKg !== null &&
      input.weightKg > Number(rule.maxWeightKg)
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

    const ruleRate: ShippingRate = {
        provider: "Local",
        courierName: rule.methodName || rule.name,
        courierCode: `rule-${rule.id}`,
        rate: amount(deliveryCharge + additionalCodFee),
        estimatedDays: estimatedDays(
          rule.estimatedMaxDays ?? rule.estimatedMinDays,
        ),
        codAvailable: rule.codAllowed,
        meta: {
          source: "ShippingRule",
          fallback,
          ruleId: rule.id,
          priority: rule.priority,
          freeShipping,
          deliveryCharge,
          codFee: additionalCodFee,
        },
      };
    const providers = await prisma.shippingProviderConfig.findMany({
      where: { isEnabled: true }, orderBy: { id: "asc" },
    });
    // These are merchant-offered methods, not live courier quotes or bookings.
    // The customer pays one rule charge irrespective of fulfillment provider.
    if (!providers.length) return [ruleRate];
    return providers.map(provider => ({
      ...ruleRate,
      provider: provider.provider,
      courierName: `${provider.displayName || provider.provider} — ${ruleRate.courierName}`,
      courierCode: `rule-${rule.id}-${provider.provider}`,
      meta: { ...ruleRate.meta, fulfillmentMode: "merchant", serviceabilityChecked: false },
    }));
  }
  }

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

  // Merchant rules determine the customer charge before any live carrier quote.
  const configured = await getConfiguredRuleRates({ deliveryPincode: normalized.deliveryPincode, declaredValue: normalized.declaredValue, cod: normalized.cod, weightKg: normalized.package?.weightKg, country: normalized.country, region: normalized.region });
  if (configured.length) return configured;
  validateInput(normalized);

  const providers = await prisma.shippingProviderConfig.findMany({
    where: { isEnabled: true },
    orderBy: { id: "asc" },
  });

  if (!providers.length) {
    throw new Error("No shipping provider is currently enabled.");
  }

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
            // Rules were already checked. These providers have no external rate API.
            return [];

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
/** Admin-only carrier estimates. Never substitute merchant checkout rules. */
export async function getCarrierQuotes(input:RateInput){
 const normalized={...input,pickupPincode:String(input.pickupPincode??'').trim(),deliveryPincode:String(input.deliveryPincode??'').trim()};
 validateInput(normalized);
 const providers=await prisma.shippingProviderConfig.findMany({where:{isEnabled:true},orderBy:{id:'asc'}});
 const results=await Promise.all(providers.map(async provider=>{
  try{
   let rates:ShippingRate[]=[];
   if(provider.provider==='Shiprocket')rates=await shiprocketRates(normalized);
   else if(provider.provider==='Delhivery')rates=await delhiveryRates(normalized,provider);
   else if(provider.provider==='Local'){
    const ruleRates=await getConfiguredRuleRates({deliveryPincode:normalized.deliveryPincode,declaredValue:normalized.declaredValue,cod:normalized.cod,weightKg:normalized.package.weightKg,country:normalized.country,region:normalized.region});
    const localRates=ruleRates.filter(rate=>rate.provider==='Local');
    return {rates:localRates,notice:localRates.length?null:{provider:provider.provider,message:'No active shipping rule matches this delivery.'}};
   }
   else return {rates:[],notice:{provider:provider.provider,message:provider.provider==='Shadowfax360'?'Shadowfax live pricing is not integrated. Check the carrier portal or your contracted rate card.':'No live quote integration. Check the carrier portal or your agreed delivery cost.'}};
   return {rates:rates.map(rate=>({...rate,meta:{...rate.meta,source:'CarrierAPI'}})),notice:rates.length?null:{provider:provider.provider,message:'The carrier returned no eligible quotes for this route.'}};
  }catch(error){logFailure(provider.provider,error);return {rates:[],notice:{provider:provider.provider,message:error instanceof ShippingConfigError?error.message:'Carrier quote request failed. Check credentials, account access and serviceability, then retry.'}};}
 }));
 return {rates:results.flatMap(x=>x.rates).sort((a,b)=>a.rate-b.rate),notices:results.flatMap(x=>x.notice?[x.notice]:[])};
}
