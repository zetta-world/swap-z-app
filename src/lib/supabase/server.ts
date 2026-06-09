import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Server-side Supabase client backed by the SERVICE-ROLE key.
 *
 * ⚠️  This module must NEVER be imported from a Client Component. The
 * service-role key bypasses Row-Level Security and would grant full table
 * access if it ever reached the browser bundle. It is read from a non-`NEXT_PUBLIC_`
 * env var precisely so Next.js refuses to inline it client-side, and the
 * runtime guard below throws loudly if this module is ever evaluated in a
 * browser context — turning an accidental client import into an obvious crash
 * rather than a silent key leak.
 */
if (typeof window !== "undefined") {
  throw new Error("supabase/server.ts must never be imported in the browser.");
}

let _client: SupabaseClient<Database> | null = null;

/**
 * Returns a memoized service-role client, or `null` when Supabase is not
 * configured. Callers MUST handle the null case — the app is designed to
 * degrade gracefully (auth 503 / tier "free") when the backend is absent,
 * rather than crash.
 */
export function getSupabaseAdmin(): SupabaseClient<Database> | null {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  _client = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

/** Cheap configuration probe used by auth routes to short-circuit with 503. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
