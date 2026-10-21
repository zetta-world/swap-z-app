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
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — só com "manter sessão iniciada" (W4)
/**
 * W4: sem "manter sessão", o cookie é de SESSÃO DO NAVEGADOR (sem maxAge: some ao fechar) e o JWT
 * vence em 12 h mesmo que o navegador fique aberto (ou restaure abas). Tokens antigos de 30 dias
 * continuam válidos até vencer — nada quebra para quem já estava logado.
 */
const SESSION_CURTA_SECONDS = 60 * 60 * 12;
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

/** Signs a session token (30 days when `manter`, else 12 h). Throws if AUTH_JWT_SECRET is unset. */
export async function issueSession(claims: SessionClaims, manter = true): Promise<string> {
  const secret = getSecret();
  if (!secret) throw new Error("AUTH_JWT_SECRET is not configured.");
  return new SignJWT({ chain: claims.chain })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${manter ? SESSION_TTL_SECONDS : SESSION_CURTA_SECONDS}s`)
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
export async function setSessionCookie(token: string, manter = true): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, manter ? { ...cookieBase(), maxAge: SESSION_TTL_SECONDS } : cookieBase());
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
