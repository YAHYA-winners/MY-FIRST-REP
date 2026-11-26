/**
 * Stateless signed session (HS256 JWT in an httpOnly cookie).
 * Edge-compatible: used both by the middleware and by server code.
 */
// JWS-only subpath imports keep jose's JWE (CompressionStream) code out of the Edge bundle.
import { SignJWT } from "jose/jwt/sign";
import { jwtVerify } from "jose/jwt/verify";
import type { JWTPayload } from "jose";

export const SESSION_COOKIE = "fa_session";
export const COMPANY_COOKIE = "fa_company";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 h — a full inventory working day

export interface SessionClaims extends JWTPayload {
  sub: string;
  role: string;
  name: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET est manquant ou trop court (32 caractères minimum).");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(claims: { sub: string; role: string; name: string }): Promise<string> {
  return new SignJWT({ role: claims.role, name: claims.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySession(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return payload as SessionClaims;
  } catch {
    return null;
  }
}
