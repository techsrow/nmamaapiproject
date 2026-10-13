import crypto from "crypto";

const LIFETIME = 24 * 60 * 60 * 1000;
function signature(payload: string): Buffer {
    const key = process.env.CHECKOUT_ACCESS_SECRET;
    if (!key || Buffer.byteLength(key, "utf8") < 32) throw new Error("CHECKOUT_ACCESS_SECRET is not configured.");
    return crypto.createHmac("sha256", key).update(`namama.order-access.v1.${payload}`).digest();
}
export function issueGuestOrderAccess(orderId: number): string {
    if (!Number.isSafeInteger(orderId) || orderId < 1) throw new Error("Invalid order ID.");
    const encoded = Buffer.from(JSON.stringify({ purpose: "guest-order-payment", orderId, expiresAt: Date.now() + LIFETIME })).toString("base64url");
    return `${encoded}.${signature(encoded).toString("base64url")}`;
}
export function verifyGuestOrderAccess(token: unknown, expectedOrderId: number): boolean {
    if (typeof token !== "string" || token.length > 1024 || !Number.isSafeInteger(expectedOrderId) || expectedOrderId < 1) return false;
    const parts = token.split(".");
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return false;
    const expected = signature(parts[0]);
    try {
        const supplied = Buffer.from(parts[1], "base64url");
        if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return false;
        const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
        return payload?.purpose === "guest-order-payment" && payload.orderId === expectedOrderId && Number.isSafeInteger(payload.expiresAt) && payload.expiresAt > Date.now();
    } catch { return false; }
}
