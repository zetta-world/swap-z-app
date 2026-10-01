#!/usr/bin/env bash
set -euo pipefail

# A58 estável — duas conexões PostgreSQL reais, com rendezvous observável.
#
# Uso:
#   T13_CONFIRM_DISPOSABLE=YES DATABASE_URL=postgresql://... \
#     bash supabase/tests/13_dca_a58_concorrencia_stable.sh
#
# O pg_sleep mantém o lock dentro da transação; ele NÃO é a prova. O teste só
# avança depois de observar PgSleep no holder e pg_blocking_pids() no waiter.
# DATABASE_URL deve apontar exclusivamente para PostgreSQL descartável.
: "${DATABASE_URL:?DATABASE_URL obrigatório; use PostgreSQL descartável}"
: "${T13_CONFIRM_DISPOSABLE:?defina T13_CONFIRM_DISPOSABLE=YES}"
: "${T13_STABLE_EVIDENCE_DIR:?T13_STABLE_EVIDENCE_DIR obrigatório para evidência persistente}"
[[ "$T13_CONFIRM_DISPOSABLE" == YES ]] || {
  echo "T13_CONFIRM_DISPOSABLE precisa ser YES" >&2
  exit 2
}

# Esta trava acontece antes de qualquer conexão. Não imprime a URL, pois ela
# pode conter password. A ref abaixo é a produção conhecida desta release line.
database_url_lower=${DATABASE_URL,,}
case "$database_url_lower" in
  *.supabase.co*|*.supabase.com*|*vuvvftdsfmagmtbovzgq*)
    echo "DATABASE_URL hospedada/conhecida recusada; use PostgreSQL descartável" >&2
    exit 2
    ;;
esac

T13_STABLE_RUNS=${T13_STABLE_RUNS:-20}
[[ "$T13_STABLE_RUNS" =~ ^[1-9][0-9]*$ ]] || {
  echo "T13_STABLE_RUNS deve ser inteiro positivo" >&2
  exit 2
}
command -v psql >/dev/null || { echo "psql não encontrado" >&2; exit 2; }

PSQL=(psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -At)
mkdir -p "$T13_STABLE_EVIDENCE_DIR"
chmod 700 "$T13_STABLE_EVIDENCE_DIR"

q() { "${PSQL[@]}" -c "$1"; }

wait_for() {
  local sql=$1 expected=$2 label=$3 value='' attempt
  for attempt in $(seq 1 1000); do
    value=$(q "$sql")
    if [[ "$value" == "$expected" ]]; then
      printf '%s=%s\n' "$label" "$value"
      return 0
    fi
    sleep 0.01
  done
  printf '%s=RENDEZVOUS_TIMEOUT(last=%s)\n' "$label" "$value" >&2
  return 1
}

WAIT_VALUE=''
wait_for_nonempty() {
  local sql=$1 label=$2 value='' attempt
  for attempt in $(seq 1 1000); do
    value=$(q "$sql")
    if [[ -n "$value" ]]; then
      WAIT_VALUE=$value
      printf '%s=%s\n' "$label" "$value"
      return 0
    fi
    sleep 0.01
  done
  printf '%s=RENDEZVOUS_TIMEOUT\n' "$label" >&2
  return 1
}

require_holder_blocks_waiter() {
  local holder_pid=$1 waiter_app=$2 label=$3 waiter_pid blockers
  wait_for_nonempty \
    "select coalesce((select pid::text from pg_stat_activity
       where application_name='$waiter_app' and wait_event_type='Lock'
         and $holder_pid = any(pg_blocking_pids(pid))
       order by pid limit 1),'')" \
    "${label}_waiter_pid"
  waiter_pid=$WAIT_VALUE
  [[ "$waiter_pid" =~ ^[0-9]+$ ]] || {
    echo "$label: waiter PID inválido" >&2
    return 1
  }
  blockers=$(q "select array_to_string(pg_blocking_pids($waiter_pid), ',')")
  [[ ",$blockers," == *",$holder_pid,"* ]] || {
    echo "$label: holder PID não consta em pg_blocking_pids(waiter)" >&2
    return 1
  }
  printf 'holder_pid=%s\nwaiter_pid=%s\nblocking_pids=%s\n' \
    "$holder_pid" "$waiter_pid" "$blockers" \
    >"$T13_STABLE_EVIDENCE_DIR/${label}-pids.txt"
  printf '%s_holder_blocks_waiter=PASS\n' "$label"
}

cleanup_rows() {
  q "delete from public.cex_execution_intents where client_order_id like 't13-stable-%';
     delete from public.dca_planos where wallet_address like 't13-stable-%';" \
    >/dev/null 2>&1 || true
}

cleanup() {
  local pid
  while read -r pid; do kill "$pid" >/dev/null 2>&1 || true; done < <(jobs -pr)
  wait >/dev/null 2>&1 || true
  cleanup_rows
}
trap cleanup EXIT INT TERM

for run in $(seq 1 "$T13_STABLE_RUNS"); do
  cleanup_rows
  wallet="t13-stable-$run"
  plan=$(q "insert into public.dca_planos
    (wallet_address,exchange_id,symbol,orcamento_total_usd,por_ciclo_usd,ciclos_total,intervalo,next_run_at,modo,status)
    values ('$wallet','binance','BTC/USDT',1000,100,10,'daily',now(),'simulado','ativo')
    returning id;")

  # Caso A: pause segura o plano; auth é observada bloqueada e depois recusa.
  intent_a=$(q "insert into public.cex_execution_intents
    (client_order_id,origin,autonomous,plan_id,cycle_number,exchange_id,symbol,side,order_type,
     requested_qty,requested_notional_usd,simulated,state)
    values ('t13-stable-$run-pause-first','dca_cron',true,'$plan',1,'binance','BTC/USDT',
            'buy','market',1,100,true,'RESERVED') returning id;")
  app_pause_a="t13s_${run}_pause_a"
  app_auth_a="t13s_${run}_auth_a"
  pause_a="$T13_STABLE_EVIDENCE_DIR/run-${run}-case-a-pause.out"
  auth_a="$T13_STABLE_EVIDENCE_DIR/run-${run}-case-a-auth.out"

  PGAPPNAME="$app_pause_a" "${PSQL[@]}" \
    -c "BEGIN; UPDATE public.dca_planos SET status='pausado' WHERE id='$plan'; SELECT pg_sleep(1.5); COMMIT;" \
    >"$pause_a" 2>&1 &
  pause_a_pid=$!
  wait_for \
    "select count(*) from pg_stat_activity where application_name='$app_pause_a' and state='active' and wait_event='PgSleep'" \
    1 "run_${run}_case_a_pause_holds_lock"
  wait_for_nonempty \
    "select coalesce((select pid::text from pg_stat_activity where application_name='$app_pause_a'
       and state='active' and wait_event='PgSleep' order by pid limit 1),'')" \
    "run_${run}_case_a_holder_pid"
  holder_a_pid=$WAIT_VALUE

  PGAPPNAME="$app_auth_a" "${PSQL[@]}" \
    -c "select public.cex_autorizar_e_submeter('$intent_a'::uuid)::text" \
    >"$auth_a" 2>&1 &
  auth_a_pid=$!
  require_holder_blocks_waiter "$holder_a_pid" "$app_auth_a" "run-${run}-case-a"
  wait "$pause_a_pid"
  wait "$auth_a_pid"
  grep -q '"ok": false' "$auth_a"
  grep -Fq '"porque": "plano DCA pausado na autorizacao final"' "$auth_a"
  [[ "$(q "select state::text from public.cex_execution_intents where id='$intent_a'")" == RESERVED ]]

  # Caso B: auth segura os locks; pause é observada bloqueada e só então avança.
  q "update public.dca_planos set status='ativo' where id='$plan'" >/dev/null
  intent_b=$(q "insert into public.cex_execution_intents
    (client_order_id,origin,autonomous,plan_id,cycle_number,exchange_id,symbol,side,order_type,
     requested_qty,requested_notional_usd,simulated,state)
    values ('t13-stable-$run-auth-first','dca_cron',true,'$plan',2,'binance','BTC/USDT',
            'buy','market',1,100,true,'RESERVED') returning id;")
  app_auth_b="t13s_${run}_auth_b"
  app_pause_b="t13s_${run}_pause_b"
  auth_b="$T13_STABLE_EVIDENCE_DIR/run-${run}-case-b-auth.out"
  pause_b="$T13_STABLE_EVIDENCE_DIR/run-${run}-case-b-pause.out"

  PGAPPNAME="$app_auth_b" "${PSQL[@]}" \
    -c "BEGIN; SELECT public.cex_autorizar_e_submeter('$intent_b'::uuid)::text; SELECT pg_sleep(1.5); COMMIT;" \
    >"$auth_b" 2>&1 &
  auth_b_pid=$!
  wait_for \
    "select count(*) from pg_stat_activity where application_name='$app_auth_b' and state='active' and wait_event='PgSleep'" \
    1 "run_${run}_case_b_auth_holds_locks"
  wait_for_nonempty \
    "select coalesce((select pid::text from pg_stat_activity where application_name='$app_auth_b'
       and state='active' and wait_event='PgSleep' order by pid limit 1),'')" \
    "run_${run}_case_b_holder_pid"
  holder_b_pid=$WAIT_VALUE

  PGAPPNAME="$app_pause_b" "${PSQL[@]}" \
    -c "update public.dca_planos set status='pausado' where id='$plan'" \
    >"$pause_b" 2>&1 &
  pause_b_pid=$!
  require_holder_blocks_waiter "$holder_b_pid" "$app_pause_b" "run-${run}-case-b"
  wait "$auth_b_pid"
  wait "$pause_b_pid"
  grep -q '"ok": true' "$auth_b"
  [[ "$(q "select state::text from public.cex_execution_intents where id='$intent_b'")" == SUBMITTING ]]
  [[ "$(q "select status from public.dca_planos where id='$plan'")" == pausado ]]

  printf 'T13_STABLE_RUN=%s LOCK_ORDERING_A=PASS LOCK_ORDERING_B=PASS\n' "$run"
done

cleanup_rows
printf 'T13_STABLE=%s/%s PASS\n' "$T13_STABLE_RUNS" "$T13_STABLE_RUNS"
echo "A58_UNDERLYING_INVARIANT=PASS"
