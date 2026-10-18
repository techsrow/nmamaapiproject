export class PaymentError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); this.name = "PaymentError"; }
}
export function paymentMessage(error: unknown): string {
  return error instanceof PaymentError ? error.message : "The payment request could not be completed. Please retry the same order.";
}
export function paymentStatusCode(error: unknown): number { return error instanceof PaymentError ? error.status : 503; }
export function paise(value: unknown): number {
  if (value === null || value === undefined || value === "") throw new PaymentError("Invalid payment amount.");
  const n = Number(value), result = Math.round(n * 100);
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(result)) throw new PaymentError("Invalid payment amount.");
  return result;
}
export function jsonObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
