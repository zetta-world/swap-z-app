import { NextRequest } from "next/server";
import { verifyEvmSignature, normalizeEvmAddress } from "@/lib/auth/siwe";
import { verifySolanaSignature, normalizeSolanaAddress } from "@/lib/auth/siws";
import { issueSession, setSessionCookie, isSessionConfigured } from "@/lib/auth/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import type { WalletChain } from "@/lib/supabase/types";
import { rateLimit, getClientId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/verify
 * Body: { address, chain: "evm"|"solana", signature }
 *
 * Verifies the signature against the pending (single-use) nonce, upserts the
 * user, issues a 30-day JWT, and sets it as an httpOnly session cookie.
 */
export async function POST(req: NextRequest) {
  const clientId = getClientId(req.headers);
  const rl = rateLimit(`auth-verify:${clientId}`, { windowMs: 60_000, max: 20 });
  if (!rl.ok) {
    return json({ ok: false, error: "rate_limited" }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  if (!isSupabaseConfigured() || !isSessionConfigured()) {
    return json({ ok: false, error: "auth_unconfigured" }, 503);
  }

  let body: { address?: string; chain?: string; signature?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const chain = body.chain;
  if (chain !== "evm" && chain !== "solana") {
    return json({ ok: false, error: "invalid_chain" }, 400);
  }
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!signature || signature.length > 200) {
    return json({ ok: false, error: "invalid_signature" }, 400);
  }

  const address =
    chain === "evm"
      ? normalizeEvmAddress(body.address ?? "")
      : normalizeSolanaAddress(body.address ?? "");
  if (!address) {
    return json({ ok: false, error: "invalid_address" }, 400);
  }

  return finishVerify(address, chain, signature);
}

async function finishVerify(address: string, chain: WalletChain, signature: string) {
  // Pull and consume the stored nonce for this wallet. We stored only one, so
  // we look it up, validate the signature against it, then it's already gone.
  const db = getSupabaseAdmin();
  if (!db) return json({ ok: false, error: "auth_unconfigured" }, 503);

  const { data: nonceRow } = await db
    .from("auth_nonces")
    .select("nonce, issued_at, expires_at")
    .eq("wallet_address", address)
    .maybeSingle();

  if (!nonceRow) return json({ ok: false, error: "no_challenge" }, 400);
  if (new Date(nonceRow.expires_at).getTime() < Date.now()) {
    await db.from("auth_nonces").delete().eq("wallet_address", address);
    return json({ ok: false, error: "challenge_expired" }, 400);
  }

  // The wallet signed a message built with `new Date().toISOString()` (…Z),
  // but PostgREST returns timestamptz as `…+00:00`. Round-trip through Date
  // so the reconstructed message matches the signed bytes exactly.
  const issuedAt = new Date(nonceRow.issued_at).toISOString();

  const ok =
    chain === "evm"
      ? await verifyEvmSignature({ address, signature, nonce: nonceRow.nonce, issuedAt })
      : verifySolanaSignature({ address, signature, nonce: nonceRow.nonce, issuedAt });

  // Single-use regardless of outcome — burn the nonce so failed attempts can't
  // be brute-forced and successes can't be replayed.
  await db.from("auth_nonces").delete().eq("wallet_address", address);

  if (!ok) {
    console.warn(`[auth] signature verification failed for ${chain} wallet ${address.slice(0, 6)}…`);
    return json({ ok: false, error: "bad_signature" }, 401);
  }

  // Upsert the user record (wallet-first; email stays null until captured).
  await db
    .from("users")
    .upsert(
      { wallet_address: address, wallet_chain: chain, last_seen_at: new Date().toISOString() },
      { onConflict: "wallet_address" },
    );

  const token = await issueSession({ sub: address, chain });
  await setSessionCookie(token);

  return json({ ok: true, address, chain });
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}
