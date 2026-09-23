create or replace function public.autopilot_rearm_preserva_rails(
  p_wallet_address text,
  p_exchange_id text,
  p_risk_mode text,
  p_market_type text,
  p_max_trade_usd numeric,
  p_daily_loss_stop_usd numeric,
  p_max_trades_per_day integer,
  p_allowed_symbols text[],
  p_lang text,
  p_conexao_id uuid,
  p_key_permission text,
  p_key_permission_detail text,
  p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoje text := (current_timestamp at time zone 'UTC')::date::text;
  v_id uuid;
begin
  if p_conexao_id is null then
    raise exception 'conexao_id obrigatoria para armar sessao';
  end if;

  insert into public.autopilot_sessions (
    wallet_address,
    exchange_id,
    risk_mode,
    market_type,
    max_trade_usd,
    daily_loss_stop_usd,
    max_trades_per_day,
    allowed_symbols,
    lang,
    conexao_id,
    key_permission,
    key_permission_detail,
    key_checked_at,
    is_active,
    expires_at,
    trades_today,
    pnl_today,
    last_reset_day,
    frozen_until_day,
    updated_at
  ) values (
    p_wallet_address,
    p_exchange_id,
    p_risk_mode,
    p_market_type,
    p_max_trade_usd,
    p_daily_loss_stop_usd,
    p_max_trades_per_day,
    coalesce(p_allowed_symbols, '{}'::text[]),
    p_lang,
    p_conexao_id,
    p_key_permission,
    left(coalesce(p_key_permission_detail, ''), 300),
    now(),
    true,
    p_expires_at,
    0,
    0,
    v_hoje,
    null,
    now()
  )
  on conflict (wallet_address, exchange_id) do update
     set risk_mode             = excluded.risk_mode,
         market_type           = excluded.market_type,
         max_trade_usd         = excluded.max_trade_usd,
         daily_loss_stop_usd   = excluded.daily_loss_stop_usd,
         max_trades_per_day    = excluded.max_trades_per_day,
         allowed_symbols       = excluded.allowed_symbols,
         lang                  = excluded.lang,
         conexao_id            = excluded.conexao_id,
         key_permission        = excluded.key_permission,
         key_permission_detail = excluded.key_permission_detail,
         key_checked_at        = excluded.key_checked_at,
         is_active             = true,
         expires_at            = excluded.expires_at,
         trades_today = case
           when public.autopilot_sessions.last_reset_day = v_hoje
             then public.autopilot_sessions.trades_today
           else 0
         end,
         pnl_today = case
           when public.autopilot_sessions.last_reset_day = v_hoje
             then public.autopilot_sessions.pnl_today
           else 0
         end,
         last_reset_day = case
           when public.autopilot_sessions.last_reset_day = v_hoje
             then public.autopilot_sessions.last_reset_day
           else v_hoje
         end,
         frozen_until_day = case
           when public.autopilot_sessions.last_reset_day = v_hoje
             then public.autopilot_sessions.frozen_until_day
           else null
         end,
         updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.autopilot_rearm_preserva_rails(
  text, text, text, text, numeric, numeric, integer, text[], text, uuid,
  text, text, timestamptz
) is
  'A51: arma/rearma atomicamente. Mesmo dia preserva trades/pnl/freeze e '
  'bandeiras; novo dia faz rollover dos rails sem apagar quarentena ou '
  'contabilidade incompleta. Nunca grava credencial na sessao.';

revoke all on function public.autopilot_rearm_preserva_rails(
  text, text, text, text, numeric, numeric, integer, text[], text, uuid,
  text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.autopilot_rearm_preserva_rails(
  text, text, text, text, numeric, numeric, integer, text[], text, uuid,
  text, text, timestamptz
) to service_role;
