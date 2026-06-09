import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import type { WalletChain } from "@/lib/supabase/types";

/**
 * Session layer — issues and verifies the JWT that proves a wallet has signed
 * the SIWE / SIWS challenge. The token is HMAC-SHA256 signed with
 * AUTH_JWT_SECRET and stored in an httpOnly cookie so client JS can never read
 * it (XSS can't exfiltrate the session).
 */

export const SESSION_COOKIE = "zswap_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const ISSUER = "z-swap";
const AUDIENCE = "z-swap-app";

export interface SessionClaims {
  /** Wallet address (checksummed EVM or base58 Solana). */
  sub:   string;
  chain: WalletChain;
}

function getSecret(): Uint8Array | null {
  const s = process.env.AUTH_JWT_SECRET;
  if (!s || s.length < 16) return null;
  return new TextEncoder().encode(s);
}

export function isSessionConfigured(): boolean {
  return getSecret() !== null;
}

/** Signs a 30-day session token. Throws if AUTH_JWT_SECRET is unset. */
export async function issueSession(claims: SessionClaims): Promise<string> {
  const secret = getSecret();
  if (!secret) throw new Error("AUTH_JWT_SECRET is not configured.");
  return new SignJWT({ chain: claims.chain })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret);
}

/** Verifies a raw token. Returns null on any failure (expired, tampered, etc). */
export async function verifySession(token: string): Promise<SessionClaims | null> {
  const secret = getSecret();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return claimsFromPayload(payload);
  } catch {
    return null;
  }
}

function claimsFromPayload(payload: JWTPayload): SessionClaims | null {
  const sub = payload.sub;
  const chain = payload.chain;
  if (typeof sub !== "string" || (chain !== "evm" && chain !== "solana")) return null;
  return { sub, chain };
}

/** Cookie attributes shared by set + clear so they always match. */
function cookieBase() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

/** Writes the session cookie (called from the verify route after signing). */
export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { ...cookieBase(), maxAge: SESSION_TTL_SECONDS });
}

/** Clears the session cookie (logout). */
export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { ...cookieBase(), maxAge: 0 });
}

/** Reads + verifies the session from the incoming request cookies. */
export async function getSession(): Promise<SessionClaims | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}
