#!/usr/bin/env bash
set -euo pipefail

# Batch 2 / A58 — duas conexões PostgreSQL reais.
# Uso: DATABASE_URL=postgresql://... bash supabase/tests/13_dca_a58_concorrencia.sh
: "${DATABASE_URL:?DATABASE_URL obrigatório; use PostgreSQL descartável}"
PSQL=(psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -At)
# ⚠️ `psql -c` NÃO interpola variáveis (`:'intent'`): o texto chegaria cru ao
# servidor como erro de sintaxe. Todo comando com variável psql vai por
# stdin (heredoc ou here-string `<<<`), onde a interpolação acontece.

cleanup() {
  "${PSQL[@]}" <<'SQL' >/dev/null 2>&1 || true
DELETE FROM public.cex_execution_intents WHERE client_order_id LIKE 'b2-race-%';
DELETE FROM public.dca_planos WHERE wallet_address='batch2-race';
SQL
}
trap cleanup EXIT
cleanup

PLAN_ID=$("${PSQL[@]}" <<'SQL'
INSERT INTO public.dca_planos
  (wallet_address,exchange_id,symbol,orcamento_total_usd,por_ciclo_usd,ciclos_total,intervalo,next_run_at,modo,status)
VALUES ('batch2-race','binance','BTC/USDT',1000,100,10,'daily',now(),'simulado','ativo')
RETURNING id;
SQL
)

new_intent() {
  local key=$1 cycle=$2
  "${PSQL[@]}" -v plan="$PLAN_ID" -v key="$key" -v cycle="$cycle" <<'SQL'
INSERT INTO public.cex_execution_intents
 (client_order_id,origin,autonomous,plan_id,cycle_number,exchange_id,symbol,side,order_type,
  requested_qty,requested_notional_usd,simulated,state)
VALUES (:'key','dca_cron',true,:'plan'::uuid,:cycle,'binance','BTC/USDT','buy','market',1,100,true,'RESERVED')
RETURNING id;
SQL
}

# ── D1-A: writer PAUSE pega/commita antes da auth ─────────────────────────
I1=$(new_intent b2-race-pause-first 1)
(
  "${PSQL[@]}" -v plan="$PLAN_ID" <<'SQL'
BEGIN;
UPDATE public.dca_planos SET status='pausado' WHERE id=:'plan'::uuid;
SELECT pg_sleep(1.2);
COMMIT;
SQL
) & WRITER=$!
sleep 0.2
R1=$("${PSQL[@]}" -v intent="$I1" <<<"select public.cex_autorizar_e_submeter(:'intent'::uuid)::text;")
wait "$WRITER"
S1=$("${PSQL[@]}" -v intent="$I1" <<<"select state::text from public.cex_execution_intents where id=:'intent'::uuid;")
[[ "$R1" == *'"ok": false'* ]] || { echo "FAIL pause→auth: auth não recusou: $R1"; exit 1; }
[[ "$S1" == "RESERVED" ]] || { echo "FAIL pause→auth: estado=$S1"; exit 1; }
echo "PASS A58 race pause→auth: auth bloqueou e intent ficou RESERVED"

# ── D1-B: auth pega os locks primeiro; pause espera, SUBMITTING fica ───────
"${PSQL[@]}" -v plan="$PLAN_ID" <<<"update public.dca_planos set status='ativo' where id=:'plan'::uuid;" >/dev/null
I2=$(new_intent b2-race-auth-first 2)
AUTH_OUT=$(mktemp)
(
  "${PSQL[@]}" -v intent="$I2" >"$AUTH_OUT" <<'SQL'
BEGIN;
SELECT public.cex_autorizar_e_submeter(:'intent'::uuid)::text;
SELECT pg_sleep(1.2);
COMMIT;
SQL
) & AUTH_PID=$!
sleep 0.2
START=$(date +%s%3N)
"${PSQL[@]}" -v plan="$PLAN_ID" <<<"update public.dca_planos set status='pausado' where id=:'plan'::uuid;" >/dev/null
END=$(date +%s%3N)
wait "$AUTH_PID"
R2=$(cat "$AUTH_OUT"); rm -f "$AUTH_OUT"
S2=$("${PSQL[@]}" -v intent="$I2" <<<"select state::text from public.cex_execution_intents where id=:'intent'::uuid;")
P2=$("${PSQL[@]}" -v plan="$PLAN_ID" <<<"select status from public.dca_planos where id=:'plan'::uuid;")
ELAPSED=$((END-START))
[[ "$R2" == *'"ok": true'* ]] || { echo "FAIL auth→pause: auth não autorizou: $R2"; exit 1; }
[[ "$S2" == "SUBMITTING" ]] || { echo "FAIL auth→pause: estado=$S2"; exit 1; }
[[ "$P2" == "pausado" ]] || { echo "FAIL auth→pause: plano=$P2"; exit 1; }
[[ "$ELAPSED" -ge 700 ]] || { echo "FAIL auth→pause: pause não observou blocking real (${ELAPSED}ms)"; exit 1; }
echo "PASS A58 race auth→pause: pause bloqueou ${ELAPSED}ms; intent permaneceu SUBMITTING"
