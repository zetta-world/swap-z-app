#!/usr/bin/env bash
set -euo pipefail

# C4 determinístico para uma stack DESCARTÁVEL já preparada com a fake venue.
# Este harness nunca constrói, inicia ou remove containers.

assert_no_inline_fill() {
  local payload=$1
  if grep -Eq '"filledImmediately"[[:space:]]*:[[:space:]]*true' <<<"$payload"; then
    echo "C4 inválido: reconciliação ocorreu inline (filledImmediately=true)" >&2
    return 1
  fi
}

self_test_assertion() {
  assert_no_inline_fill '{"filledImmediately":false}'
  assert_no_inline_fill '{"state":"UNKNOWN"}'
  if assert_no_inline_fill '{"filledImmediately":true}' >/dev/null 2>&1; then
    echo "SELF_TEST FAIL: filledImmediately=true não foi recusado" >&2
    return 1
  fi
  echo "C4_ASSERTION_SELF_TEST=PASS"
}

if [[ "${1:-}" == "--self-test" ]]; then
  [[ $# == 1 ]] || { echo "uso: $0 [--self-test]" >&2; exit 2; }
  self_test_assertion
  exit 0
fi
[[ $# == 0 ]] || { echo "uso: $0 [--self-test]" >&2; exit 2; }

: "${CHAOS_CONFIRM_DISPOSABLE:?defina CHAOS_CONFIRM_DISPOSABLE=YES}"
[[ "$CHAOS_CONFIRM_DISPOSABLE" == YES ]] || {
  echo "CHAOS_CONFIRM_DISPOSABLE precisa ser YES" >&2
  exit 2
}
: "${APP_URL:?APP_URL local obrigatório}"
: "${APP_CONTAINER:?APP_CONTAINER descartável obrigatório}"
: "${FAKE_CONTAINER:?FAKE_CONTAINER descartável obrigatório}"
: "${DB_CONTAINER:?DB_CONTAINER descartável obrigatório}"
: "${OUT_DIR:?OUT_DIR obrigatório}"
C4_RUNS=${C4_RUNS:-10}
[[ "$C4_RUNS" =~ ^[1-9][0-9]*$ ]] && (( C4_RUNS <= 200 )) || {
  echo "C4_RUNS deve estar entre 1 e 200" >&2
  exit 2
}
[[ "$APP_URL" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] || {
  echo "APP_URL deve apontar para 127.0.0.1" >&2
  exit 2
}
case "$APP_URL" in
  http://127.0.0.1:3310|http://127.0.0.1:3410|http://127.0.0.1:3510|http://127.0.0.1:3520)
    echo "APP_URL recusada: porta de stack preservada" >&2
    exit 2
    ;;
esac

reject_protected_target() {
  local label=$1 value=${2,,}
  case "$value" in
    *zswap-lab-db*|*zswap-demo-db*|*zswap-prodclone-baseline*|*zswap-prodclone-candidate*|\
    *vuvvftdsfmagmtbovzgq*|*.supabase.co*|*.supabase.com*)
      echo "$label recusado: alvo preservado, hospedado ou conhecido de produção" >&2
      exit 2
      ;;
  esac
}

reject_protected_target APP_CONTAINER "$APP_CONTAINER"
reject_protected_target FAKE_CONTAINER "$FAKE_CONTAINER"
reject_protected_target DB_CONTAINER "$DB_CONTAINER"

prove_no_background_reconciler() {
  local app_project fake_project db_project names processes
  command -v docker >/dev/null || { echo "docker não encontrado" >&2; exit 2; }
  app_project=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$APP_CONTAINER")
  fake_project=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$FAKE_CONTAINER")
  db_project=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$DB_CONTAINER")
  [[ -n "$app_project" && "$app_project" != '<no value>' ]] || {
    echo "APP_CONTAINER sem identidade de projeto Compose" >&2
    exit 2
  }
  [[ "$app_project" == "$fake_project" && "$app_project" == "$db_project" ]] || {
    echo "app, fake venue e banco não pertencem ao mesmo projeto descartável" >&2
    exit 2
  }
  reject_protected_target COMPOSE_PROJECT "$app_project"

  names=$(docker ps --filter "label=com.docker.compose.project=$app_project" --format '{{.Names}}')
  for required in "$APP_CONTAINER" "$FAKE_CONTAINER" "$DB_CONTAINER"; do
    grep -Fxq "$required" <<<"$names" || {
      echo "container obrigatório não está ativo no projeto descartável" >&2
      exit 2
    }
  done
  if grep -Eiq '(^|[-_.])(cron|scheduler|runner|reconciler|reconcile|worker)([-_.]|$)' <<<"$names"; then
    echo "projeto descartável contém runner/reconciliador paralelo" >&2
    exit 2
  fi
  processes=$(docker top "$APP_CONTAINER" -eo args)
  if grep -Eiq '(^|[ /_-])(cron|scheduler|runner|reconciler|reconcile|worker)([ /_-]|$)' <<<"$processes"; then
    echo "APP_CONTAINER contém processo runner/reconciliador paralelo" >&2
    exit 2
  fi
  echo "NO_BACKGROUND_RECONCILER_PROVED=YES"
}

prove_no_background_reconciler

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
API_KEY=$(openssl rand -hex 24)
API_SECRET=$(openssl rand -hex 32)
C4_CLIENT_NAMESPACE=${C4_CLIENT_NAMESPACE:-$(printf '%s' "$(date -u +%s%N)-$$" | sha256sum | cut -c1-12)}
[[ "$C4_CLIENT_NAMESPACE" =~ ^[0-9a-f]{12}$ ]] || {
  echo "C4_CLIENT_NAMESPACE deve conter exatamente 12 hexadecimais minúsculos" >&2
  exit 2
}

control() {
  local method=$1 path=$2
  docker exec "$FAKE_CONTAINER" node --input-type=module -e '
    import https from "node:https";
    import fs from "node:fs";
    const ca=fs.readFileSync("/run/secrets/fake_binance_ca");
    const req=https.request({host:"localhost",port:443,path:process.argv[2],method:process.argv[1],ca,servername:"api.binance.com"},r=>{let b="";r.on("data",d=>b+=d);r.on("end",()=>{process.stdout.write(b);if((r.statusCode??500)>=400)process.exit(2)})});
    req.on("error",e=>{console.error(e.message);process.exit(3)});req.end();
  ' "$method" "$path"
}

json_field() {
  local path=$1
  python3 -c '
import json,sys
value=json.load(sys.stdin)
for part in sys.argv[1].split("."):
    value=value[int(part)] if isinstance(value,list) else value[part]
print(str(value).lower() if isinstance(value,bool) else value)
' "$path"
}

json_length() {
  local path=$1
  python3 -c '
import json,sys
value=json.load(sys.stdin)
for part in sys.argv[1].split("."):
    value=value[part]
print(len(value))
' "$path"
}

response_body() { sed '/^HTTP=/,$d' "$1"; }
response_code() { sed -n 's/^HTTP=//p' "$1" | tail -1; }

intent_row() {
  local client_order_id=$1
  [[ "$client_order_id" =~ ^[A-Za-z0-9._-]+$ ]] || return 2
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 \
    -c "select id||'|'||state||'|'||coalesce(external_order_id,'')||'|'||
               (select count(*) from public.cex_fills f where f.intent_id=i.id)
        from public.cex_execution_intents i
        where client_order_id='$client_order_id'
        order by created_at desc limit 1;"
}

post_order() {
  local client_id=$1 out=$2
  printf '{"exchange":"binance","symbol":"BTC/USDT","side":"buy","type":"market","amount":0.001,"confirm":"I-CONFIRM-REAL-ORDER","apiKey":"%s","apiSecret":"%s"}' \
    "$API_KEY" "$API_SECRET" |
    curl -sS --max-time 40 -w '\nHTTP=%{http_code}\n' \
      -H 'content-type: application/json' -H "x-forwarded-for: $client_id" \
      --data-binary @- "$APP_URL/api/cex/order" >"$out" 2>&1
}

recover_intent() {
  local intent=$1 client_id=$2 out=$3
  printf '{"intentId":"%s","apiKey":"%s","apiSecret":"%s"}' \
    "$intent" "$API_KEY" "$API_SECRET" |
    curl -sS --max-time 40 -w '\nHTTP=%{http_code}\n' \
      -H 'content-type: application/json' -H "x-forwarded-for: $client_id" \
      --data-binary @- "$APP_URL/api/cex/order/status" >"$out" 2>&1
}

run_c4() {
  local n=$1 run_id base state submit_count orders_length client_order_id row intent client_id
  local before_status before_fills request_http request_json blocked_reads begin end final recovery_rc
  local final_status final_fills recovery_http recovery_json reads_during reads_outside
  run_id="c4-${n}-$(date -u +%s%N)"
  base="$OUT_DIR/c4-$n"
  client_id="2001:db8:c4:${C4_CLIENT_NAMESPACE:0:4}:${C4_CLIENT_NAMESPACE:4:4}:${C4_CLIENT_NAMESPACE:8:4}:0:$n"

  # Cada rodada recebe identidade reservada e exclusiva. Assim os únicos
  # buckets são cex_order:<client_id> e cex_order_status:<client_id>; não há
  # DELETE, LIKE ou reset global de rate limit.
  control POST "/__control/reset?mode=accept_then_truncate_block_reconcile&runId=$run_id" \
    >"$base-control-reset.json"

  post_order "$client_id" "$base-request.out"
  request_http=$(response_code "$base-request.out")
  request_json=$(response_body "$base-request.out")
  [[ "$request_http" == 202 ]]
  assert_no_inline_fill "$request_json"

  state=$(control GET /__control/state)
  printf '%s\n' "$state" >"$base-control-before-recovery.json"
  submit_count=$(printf '%s' "$state" | json_field submitCount)
  orders_length=$(printf '%s' "$state" | json_length orders)
  blocked_reads=$(printf '%s' "$state" | json_field blockedReadCount)
  [[ "$submit_count" == 1 ]]
  [[ "$orders_length" == 1 ]]
  [[ "$blocked_reads" -ge 1 ]]
  [[ "$(printf '%s' "$state" | json_field recoveryReadsBlocked)" == true ]]
  [[ "$(printf '%s' "$state" | json_field explicitRecoveryCallActive)" == false ]]
  [[ "$(printf '%s' "$state" | json_field recoveryReadsDuringExplicitCall)" == 0 ]]
  [[ "$(printf '%s' "$state" | json_field recoveryReadsOutsideExplicitCall)" == 0 ]]
  client_order_id=$(printf '%s' "$state" | json_field orders.0.clientOrderId)

  row=$(intent_row "$client_order_id")
  printf '%s\n' "$row" >"$base-intent-before-recovery.txt"
  intent=${row%%|*}
  before_status=$(printf '%s' "$row" | cut -d'|' -f2)
  before_fills=$(printf '%s' "$row" | cut -d'|' -f4)
  [[ "$before_status" == UNKNOWN ]]
  [[ "$before_fills" == 0 ]]

  begin=$(control POST "/__control/begin-explicit-recovery?runId=$run_id")
  printf '%s\n' "$begin" >"$base-control-begin-recovery.json"
  [[ "$(printf '%s' "$begin" | json_field ok)" == true ]]

  recovery_rc=0
  recover_intent "$intent" "$client_id" "$base-recovery.out" || recovery_rc=$?
  end=$(control POST "/__control/end-explicit-recovery?runId=$run_id")
  printf '%s\n' "$end" >"$base-control-end-recovery.json"
  [[ "$(printf '%s' "$end" | json_field ok)" == true ]]
  [[ "$recovery_rc" == 0 ]]

  recovery_http=$(response_code "$base-recovery.out")
  recovery_json=$(response_body "$base-recovery.out")
  [[ "$recovery_http" == 200 ]]
  [[ "$(printf '%s' "$recovery_json" | json_field state)" == FILLED ]]

  final=$(intent_row "$client_order_id")
  printf '%s\n' "$final" >"$base-intent-final.txt"
  final_status=$(printf '%s' "$final" | cut -d'|' -f2)
  final_fills=$(printf '%s' "$final" | cut -d'|' -f4)
  [[ "$final_status" == FILLED ]]
  [[ "$final_fills" -ge 1 ]]

  state=$(control GET /__control/state)
  printf '%s\n' "$state" >"$base-control-final.json"
  submit_count=$(printf '%s' "$state" | json_field submitCount)
  orders_length=$(printf '%s' "$state" | json_length orders)
  reads_during=$(printf '%s' "$state" | json_field recoveryReadsDuringExplicitCall)
  reads_outside=$(printf '%s' "$state" | json_field recoveryReadsOutsideExplicitCall)
  [[ "$submit_count" == 1 ]]
  [[ "$orders_length" == 1 ]]
  [[ "$reads_during" -ge 1 ]]
  [[ "$reads_outside" == 0 ]]
  [[ "$(printf '%s' "$state" | json_field explicitRecoveryCallActive)" == false ]]

  printf 'C4 run=%s client_id=%s rate_keys=cex_order:%s,cex_order_status:%s submit_count=%s orders.length=%s clientOrderId=%s intent_before=%s inline_reconciliation=false recovery_route_called=true reads_during_recovery=%s reads_outside_recovery=%s final=%s fills=%s PASS\n' \
    "$n" "$client_id" "$client_id" "$client_id" "$submit_count" "$orders_length" \
    "$client_order_id" "$before_status" "$reads_during" "$reads_outside" "$final_status" "$final_fills"
}

echo "UTC_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "C4_RUNS=$C4_RUNS"
echo "C4_CLIENT_NAMESPACE=$C4_CLIENT_NAMESPACE"
for n in $(seq 1 "$C4_RUNS"); do run_c4 "$n"; done
echo "UTC_END=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "CHAOS_C4=$C4_RUNS/$C4_RUNS PASS"
