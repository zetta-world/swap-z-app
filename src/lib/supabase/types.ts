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

export type AutopilotRiskMode  = "conservador" | "moderado" | "agressivo";
export type AutopilotMarketType = "spot" | "futures" | "margin";

export type AutopilotSessionRow = {
  id:                  string;
  wallet_address:      string;
  exchange_id:         string;
  risk_mode:           AutopilotRiskMode;
  market_type:         AutopilotMarketType;
  max_trade_usd:       number;
  daily_loss_stop_usd: number;
  max_trades_per_day:  number;
  allowed_symbols:     string[];
  lang:                string;
  creds_cipher:        string;
  is_active:           boolean;
  expires_at:          string;
  trades_today:        number;
  pnl_today:           number;
  last_reset_day:      string;
  frozen_until_day:    string | null;
  last_scan_at:        string | null;
  last_error:          string | null;
  created_at:          string;
  updated_at:          string;
};

export type AutopilotRunRow = {
  id:             string;
  session_id:     string | null;
  wallet_address: string;
  exchange_id:    string;
  ran_at:         string;
  symbol:         string | null;
  side:           string | null;
  order_type:     string | null;
  amount:         number | null;
  price:          number | null;
  notional_usd:   number | null;
  status:         string;
  order_id:       string | null;
  card_kind:      string | null;
  reason:         string | null;
};

export interface Database {
  public: {
    Tables: {
      users:       { Row: UserRow;      Insert: Partial<UserRow> & { wallet_address: string; wallet_chain: WalletChain }; Update: Partial<UserRow>;   Relationships: [] };
      auth_nonces: { Row: AuthNonceRow; Insert: AuthNonceRow;                                                            Update: Partial<AuthNonceRow>; Relationships: [] };
      tier_cache:  { Row: TierCacheRow; Insert: TierCacheRow;                                                            Update: Partial<TierCacheRow>; Relationships: [] };
      autopilot_sessions: {
        Row: AutopilotSessionRow;
        Insert: Partial<AutopilotSessionRow> & {
          wallet_address: string; exchange_id: string; risk_mode: AutopilotRiskMode;
          max_trade_usd: number; daily_loss_stop_usd: number; max_trades_per_day: number;
          creds_cipher: string; expires_at: string; last_reset_day: string;
        };
        Update: Partial<AutopilotSessionRow>;
        Relationships: [];
      };
      autopilot_runs: {
        Row: AutopilotRunRow;
        Insert: Partial<AutopilotRunRow> & { wallet_address: string; exchange_id: string; status: string };
        Update: Partial<AutopilotRunRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
