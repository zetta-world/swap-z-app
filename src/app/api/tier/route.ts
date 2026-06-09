import { getSession } from "@/lib/auth/session";
import { getTierForWallet } from "@/lib/tier/check";
import { gatesEnabled } from "@/lib/tier/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tier — resolves the tier for the currently signed-in wallet.
 * Response: { ok, authenticated, address|null, chain|null, tier, source, gatesEnabled }
 *
 * Unauthenticated callers get tier "free" with authenticated=false (never a
 * 401 — the UI uses this to decide whether to show a sign-in prompt).
 */
export async function GET() {
  const session = await getSession();

  if (!session) {
    return json({
      ok: true,
      authenticated: false,
      address: null,
      chain: null,
      tier: "free",
      source: "default",
      gatesEnabled: gatesEnabled(),
    });
  }

  const result = await getTierForWallet(session.sub, session.chain);
  return json({
    ok: true,
    authenticated: true,
    address: session.sub,
    chain: session.chain,
    tier: result.tier,
    source: result.source,
    gatesEnabled: gatesEnabled(),
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
