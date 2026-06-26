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
  /** Advisory lock (A2): the cron holds this until `now()` passes it. */
  locked_until:        string | null;
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

export type AutopilotPositionStatus = "open" | "exit_armed" | "closed";

export type AutopilotPositionRow = {
  id:             string;
  session_id:     string;
  wallet_address: string;
  exchange_id:    string;
  base:           string;
  pair:           string;
  entry_price:    number;
  base_amount:    number;
  cost_usd:       number;
  reasoning:      string | null;
  entry_label:    string | null;
  status:         AutopilotPositionStatus;
  exit_order_id:  string | null;
  exit_armed_at:  string | null;
  entry_ts:       string;
  updated_at:     string;
};

export type ZionSuggestionRow = {
  id:             string;
  symbol:         string;
  kind:           string;
  side:           "buy" | "sell";
  ref_price:      number;
  entry_price:    number | null;
  target_price:   number | null;
  stop_price:     number | null;
  probability:    number | null;
  regime:         string | null;
  source:         string;
  horizon_hours:  number;
  status:         string;
  outcome_pct:    number | null;
  resolved_price: number | null;
  created_at:     string;
  resolved_at:    string | null;
};

export type PlatformEventRow = {
  id:             string;
  event_type:     string;
  wallet_address: string | null;
  path:           string | null;
  metadata:       Record<string, unknown> | null;
  created_at:     string;
};

export type AdminKvRow = {
  key:        string;
  value:      string;
  updated_at: string;
};

export type MarketBrainRow = {
  symbol:       string;
  regime:       string | null;
  regime_since: string | null;
  prev_regime:  string | null;
  atr_pct:      number | null;
  vol_avg:      number | null;
  range_pct:    number | null;
  updated_at:   string;
};

export type AdminAuditLogRow = {
  id:           string;
  actor_wallet: string;
  action:       string;
  target:       string | null;
  payload:      Record<string, unknown> | null;
  created_at:   string;
};

export interface Database {
  public: {
    Tables: {
      users:       { Row: UserRow;      Insert: Partial<UserRow> & { wallet_address: string; wallet_chain: WalletChain }; Update: Partial<UserRow>;   Relationships: [] };
      auth_nonces: { Row: AuthNonceRow; Insert: AuthNonceRow;                                                            Update: Partial<AuthNonceRow>; Relationships: [] };
      tier_cache:  { Row: TierCacheRow; Insert: TierCacheRow;                                                            Update: Partial<TierCacheRow>; Relationships: [] };
      admin_audit_log: { Row: AdminAuditLogRow; Insert: Omit<AdminAuditLogRow, "id" | "created_at"> & { id?: string; created_at?: string }; Update: never; Relationships: [] };
      platform_events: { Row: PlatformEventRow; Insert: Omit<PlatformEventRow, "id" | "created_at"> & { id?: string; created_at?: string }; Update: never; Relationships: [] };
      admin_kv: { Row: AdminKvRow; Insert: AdminKvRow; Update: Partial<AdminKvRow>; Relationships: [] };
      market_brain: { Row: MarketBrainRow; Insert: Partial<MarketBrainRow> & { symbol: string }; Update: Partial<MarketBrainRow>; Relationships: [] };
      zion_suggestions: {
        Row: ZionSuggestionRow;
        Insert: Partial<ZionSuggestionRow> & { symbol: string; kind: string; side: "buy" | "sell"; ref_price: number };
        Update: Partial<ZionSuggestionRow>;
        Relationships: [];
      };
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
      autopilot_positions: {
        Row: AutopilotPositionRow;
        Insert: Partial<AutopilotPositionRow> & {
          session_id: string; wallet_address: string; exchange_id: string;
          base: string; pair: string; entry_price: number; base_amount: number; cost_usd: number;
        };
        Update: Partial<AutopilotPositionRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      consume_rate_limit: {
        Args: { p_bucket: string; p_max: number; p_window_secs: number };
        Returns: boolean;
      };
      apply_session_pnl: {
        Args: { p_id: string; p_delta: number; p_today: string };
        Returns: undefined;
      };
      bump_session_trades: {
        Args: { p_wallet: string; p_exchange: string; p_n: number };
        Returns: undefined;
      };
    };
  };
}
