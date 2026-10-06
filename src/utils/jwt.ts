import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";

// Load secret from .env OR fallback for dev
const JWT_SECRET: string = process.env.JWT_SECRET || "dev_secret_key";

/**
 * Generate JWT token
 * @param payload - Data to store in token
 * @param options - Optional sign settings (default: expires in 7 days)
 */
export function signJwt(
  payload: JwtPayload,
  options: SignOptions = { expiresIn: "7d" }
): string {
  return jwt.sign(payload, JWT_SECRET, options);
}

/**
 * Verify JWT token
 * @param token
 * @returns Decoded payload OR null if expired/invalid
 */
export function verifyJwt<T = JwtPayload>(token: string): T | null {
  try {
    return jwt.verify(token, JWT_SECRET) as T;
  } catch (err) {
    return null;
  }
}
