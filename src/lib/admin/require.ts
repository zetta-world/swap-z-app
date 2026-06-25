import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Server helper — call at the top of every admin Server Component / Route
 * Handler. Returns the verified wallet address or throws notFound() (404),
 * never 403, so the panel's existence is never revealed to outsiders.
 *
 * Access logic (either condition grants entry):
 *  1. Wallet address is in the ADMIN_WALLETS env var (comma-separated).
 *  2. The wallet has a tier_cache row with source = 'admin'.
 *
 * Both checks happen in this function; the middleware pre-screens with (1)
 * only to avoid a DB round-trip on every request.
 */
export async function requireAdmin(): Promise<{ wallet: string }> {
  const session = await getSession();
  if (!session) notFound();

  const wallet = session.sub;

  if (isEnvAdmin(wallet)) return { wallet };

  // Fallback: tier_cache.source = 'admin' (for wallets seeded in migrations)
  const db = getSupabaseAdmin();
  if (!db) notFound();

  const { data } = await db
    .from("tier_cache")
    .select("source")
    .eq("wallet_address", wallet)
    .eq("source", "admin")
    .maybeSingle();

  if (!data) notFound();
  return { wallet };
}

/** Returns true if the wallet is in the ADMIN_WALLETS env var. */
export function isEnvAdmin(wallet: string): boolean {
  const raw = process.env.ADMIN_WALLETS ?? "";
  if (!raw.trim()) return false;
  const set = new Set(raw.split(",").map((w) => w.trim().toLowerCase()));
  return set.has(wallet.toLowerCase());
}

/**
 * Writes one row to admin_audit_log. Fire-and-forget — never throws,
 * so a logging failure never aborts the action being audited.
 */
export async function logAdminAction(
  actor: string,
  action: string,
  target?: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    const db = getSupabaseAdmin();
    if (!db) return;
    await db.from("admin_audit_log").insert({ actor_wallet: actor, action, target: target ?? null, payload: payload ?? null });
  } catch {
    // intentionally swallowed — logging must not block the happy path
  }
}
