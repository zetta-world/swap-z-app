/**
 * Hand-written DB types mirroring supabase/migrations/0001_auth.sql.
 * Kept narrow on purpose — only the columns the app reads/writes. If the
 * schema grows, regenerate with `supabase gen types typescript`.
 */
import type { Tier, TierSource } from "@/lib/tier/types";

export type WalletChain = "evm" | "solana";

// NB: these MUST be `type` aliases, not `interface`s. supabase-js constrains
// each table's Row/Insert/Update to `Record<string, unknown>`, and interfaces
// don't satisfy that constraint (no implicit index signature) — which would
// silently degrade every query's row type to `never`.
export type UserRow = {
  id:                string;
  wallet_address:    string;
  wallet_chain:      WalletChain;
  email:             string | null;
  email_verified_at: string | null;
  created_at:        string;
  last_seen_at:      string;
};

export type AuthNonceRow = {
  wallet_address: string;
  nonce:          string;
  issued_at:      string;
  expires_at:     string;
};

export type TierCacheRow = {
  wallet_address: string;
  tier:           Tier;
  source:         TierSource;
  checked_at:     string;
  expires_at:     string;
};

export interface Database {
  public: {
    Tables: {
      users:       { Row: UserRow;      Insert: Partial<UserRow> & { wallet_address: string; wallet_chain: WalletChain }; Update: Partial<UserRow>;   Relationships: [] };
      auth_nonces: { Row: AuthNonceRow; Insert: AuthNonceRow;                                                            Update: Partial<AuthNonceRow>; Relationships: [] };
      tier_cache:  { Row: TierCacheRow; Insert: TierCacheRow;                                                            Update: Partial<TierCacheRow>; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
