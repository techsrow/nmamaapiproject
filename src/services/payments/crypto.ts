import crypto from "crypto";

function key(): Buffer {
  const raw = process.env.PAYMENT_CONFIG_ENCRYPTION_KEY;
  if (!raw) throw new Error("PAYMENT_CONFIG_ENCRYPTION_KEY is required to store payment credentials");
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  try {
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) return b;
  } catch {}
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptJson<T = Record<string, any>>(payload?: string | null): T {
  if (!payload) return {} as T;
  const [version, iv64, tag64, data64] = payload.split(".");
  if (version !== "v1" || !iv64 || !tag64 || !data64) throw new Error("Invalid encrypted payment configuration");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv64, "base64"));
  decipher.setAuthTag(Buffer.from(tag64, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(data64, "base64")), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as T;
}

export function maskSecrets(value: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value || {})) {
    if (typeof v !== "string") { out[k] = v; continue; }
    out[k] = v.length <= 4 ? "••••" : `••••••••${v.slice(-4)}`;
  }
  return out;
}
