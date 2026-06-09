import { NextRequest } from "next/server";
import { issueChallenge } from "@/lib/auth/challenge";
import { normalizeEvmAddress } from "@/lib/auth/siwe";
import { normalizeSolanaAddress } from "@/lib/auth/siws";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { isSessionConfigured } from "@/lib/auth/session";
import { rateLimit, getClientId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/nonce?address=…&chain=evm|solana
 * Issues a single-use challenge for the wallet to sign. The response is JSON:
 *   { ok: true, message, nonce, issuedAt }
 */
export async function GET(req: NextRequest) {
  const clientId = getClientId(req.headers);
  const rl = rateLimit(`auth-nonce:${clientId}`, { windowMs: 60_000, max: 20 });
  if (!rl.ok) {
    return json({ ok: false, error: "rate_limited" }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  if (!isSupabaseConfigured() || !isSessionConfigured()) {
    return json({ ok: false, error: "auth_unconfigured" }, 503);
  }

  const p = req.nextUrl.searchParams;
  const chain = p.get("chain");
  const rawAddress = p.get("address") || "";

  if (chain !== "evm" && chain !== "solana") {
    return json({ ok: false, error: "invalid_chain" }, 400);
  }

  const address =
    chain === "evm" ? normalizeEvmAddress(rawAddress) : normalizeSolanaAddress(rawAddress);
  if (!address) {
    return json({ ok: false, error: "invalid_address" }, 400);
  }

  const challenge = await issueChallenge(address);
  if (!challenge) {
    return json({ ok: false, error: "auth_unconfigured" }, 503);
  }

  return json({
    ok: true,
    address,
    message: challenge.message,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
  });
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}
