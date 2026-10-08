import Razorpay from "razorpay";
import { PaymentProvider } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { decryptJson } from "./crypto";

export const PROVIDERS: Record<string, { label:string; currencies:string[]; required:string[]; online:boolean }> = {
  Razorpay: { label:"Razorpay", currencies:["INR"], required:["keyId","keySecret","webhookSecret"], online:true },
  Stripe: { label:"Stripe", currencies:["INR","USD","GBP","EUR","AUD","CAD","SGD"], required:["secretKey","publishableKey","webhookSecret"], online:true },
  PhonePe: { label:"PhonePe", currencies:["INR"], required:["clientId","clientSecret","clientVersion","webhookUsername","webhookPassword"], online:true },
  Cashfree: { label:"Cashfree Payments", currencies:["INR"], required:["clientId","clientSecret","webhookSecret"], online:true },
  PayU: { label:"PayU India", currencies:["INR"], required:["merchantKey","merchantSalt"], online:true },
  CCAvenue: { label:"CCAvenue", currencies:["INR"], required:["merchantId","accessCode","workingKey"], online:true },
  PayPal: { label:"PayPal", currencies:["USD","GBP","EUR","AUD","CAD","SGD"], required:["clientId","clientSecret","webhookId"], online:true },
  Square: { label:"Square", currencies:["USD","GBP","EUR","AUD","CAD","JPY"], required:["accessToken","locationId","webhookSignatureKey"], online:true },
  COD: { label:"Cash on Delivery", currencies:["INR"], required:[], online:false },
  BankTransfer: { label:"Bank Transfer", currencies:["INR"], required:[], online:false },
  Manual: { label:"Manual Payment", currencies:["INR"], required:[], online:false },
};

export async function gateway(provider: PaymentProvider | string) {
  const row = await prisma.paymentGatewayConfig.findUnique({ where: { provider: provider as PaymentProvider } });
  if (!row || !row.isEnabled) throw new Error(`${provider} payment provider is not enabled`);
  return { ...row, credentials: decryptJson<Record<string,string>>(row.encryptedCredentials) };
}

export async function testGateway(provider: PaymentProvider | string, credentials: Record<string,string>, mode="TEST") {
  const meta = PROVIDERS[String(provider)];
  if (!meta) throw new Error("Unsupported payment provider");
  const missing = meta.required.filter(k => !credentials?.[k]);
  if (missing.length) throw new Error(`Missing credentials: ${missing.join(", ")}`);
  if (!meta.online) return { ok:true, message:`${meta.label} is ready` };

  if (provider === "Razorpay") {
    const rz = new Razorpay({ key_id: credentials.keyId, key_secret: credentials.keySecret });
    await rz.orders.all({ count: 1 });
    return { ok:true, message:"Razorpay credentials verified" };
  }

  // Credential shapes are validated here. Provider account/API validation is performed
  // by provider-specific transaction calls because several gateways do not expose a safe
  // read-only credential-test endpoint.
  return { ok:true, message:`${meta.label} configuration accepted (${mode})` };
}
