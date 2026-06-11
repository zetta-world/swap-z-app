import { getSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isTier } from "@/lib/tier/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tier/select — admin-only tier switcher for end-to-end testing.
 *
 * Lets a wallet whose tier_cache row was seeded with source='admin' (see
 * supabase/migrations/0001_auth.sql) flip its own tier to any value, so the
 * founder can exercise every gated surface as free/pro/trader/pilot before
 * the 5.4 NFT mint exists. Regular wallets (source='nft'/'subscription', or
 * no row) get a 403 — there is no path for a normal user to grant themselves
 * a tier through this endpoint.
 *
 * Body: { tier: "free" | "pro" | "trader" | "pilot" }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return json({ ok: false, error: "unauthenticated" }, 401);
  }

  const db = getSupabaseAdmin();
  if (!db) {
    return json({ ok: false, error: "unconfigured" }, 503);
  }

  let tier: unknown;
  try {
    ({ tier } = await req.json());
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }
  if (!isTier(tier)) {
    return json({ ok: false, error: "invalid_tier" }, 400);
  }

  // Only pre-seeded admin rows may switch — the source column is the gate.
  const { data: row, error: readErr } = await db
    .from("tier_cache")
    .select("source")
    .eq("wallet_address", session.sub)
    .maybeSingle();
  if (readErr) {
    return json({ ok: false, error: "db_error" }, 500);
  }
  if (!row || row.source !== "admin") {
    return json({ ok: false, error: "admin_only" }, 403);
  }

  // Keep source='admin' and the long expiry so the on-chain check never
  // overwrites the chosen tier while testing.
  const expires = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const { error: writeErr } = await db
    .from("tier_cache")
    .update({ tier, source: "admin", checked_at: new Date().toISOString(), expires_at: expires })
    .eq("wallet_address", session.sub);
  if (writeErr) {
    return json({ ok: false, error: "db_error" }, 500);
  }

  return json({ ok: true, tier });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
