#!/usr/bin/env bash
set -euo pipefail

# C4 determinístico para uma stack DESCARTÁVEL já preparada com a fake venue
# deste diretório. Este harness nunca constrói, inicia ou remove containers.
# Ele exige nomes explícitos para não atingir LAB/DEMO preservados por acidente.
: "${CHAOS_CONFIRM_DISPOSABLE:?defina CHAOS_CONFIRM_DISPOSABLE=YES}"
[[ "$CHAOS_CONFIRM_DISPOSABLE" == YES ]] || {
  echo "CHAOS_CONFIRM_DISPOSABLE precisa ser YES" >&2
  exit 2
}
: "${APP_URL:?APP_URL local obrigatório}"
: "${FAKE_CONTAINER:?FAKE_CONTAINER descartável obrigatório}"
: "${DB_CONTAINER:?DB_CONTAINER descartável obrigatório}"
: "${OUT_DIR:?OUT_DIR obrigatório}"
C4_RUNS=${C4_RUNS:-10}
[[ "$C4_RUNS" =~ ^[1-9][0-9]*$ ]] || { echo "C4_RUNS inválido" >&2; exit 2; }
[[ "$APP_URL" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] || {
  echo "APP_URL deve apontar para 127.0.0.1" >&2
  exit 2
}

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
API_KEY=$(openssl rand -hex 24)
API_SECRET=$(openssl rand -hex 32)

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

reset_rate_limits() {
  # Não aumenta o limite. Zera apenas os dois buckets desta prova no banco
  # descartável, eliminando interferência acumulada entre as dez rodadas.
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
    -c "delete from public.rate_limits
        where bucket like 'cex_order:%' or bucket like 'cex_order_status:%';" \
    >/dev/null
}

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
  local ip=$1 out=$2
  printf '{"exchange":"binance","symbol":"BTC/USDT","side":"buy","type":"market","amount":0.001,"confirm":"I-CONFIRM-REAL-ORDER","apiKey":"%s","apiSecret":"%s"}' \
    "$API_KEY" "$API_SECRET" |
    curl -sS --max-time 40 -w '\nHTTP=%{http_code}\n' \
      -H 'content-type: application/json' -H "x-forwarded-for: $ip" \
      --data-binary @- "$APP_URL/api/cex/order" >"$out" 2>&1
}

recover_intent() {
  local intent=$1 ip=$2 out=$3
  printf '{"intentId":"%s","apiKey":"%s","apiSecret":"%s"}' \
    "$intent" "$API_KEY" "$API_SECRET" |
    curl -sS --max-time 40 -w '\nHTTP=%{http_code}\n' \
      -H 'content-type: application/json' -H "x-forwarded-for: $ip" \
      --data-binary @- "$APP_URL/api/cex/order/status" >"$out" 2>&1
}

run_c4() {
  local n=$1 run_id base state submit_count orders_length client_order_id row intent
  local before_status before_fills request_http request_json blocked_reads release final
  local final_status final_fills recovery_http recovery_json successful_reads
  run_id="c4-${n}-$(date -u +%s%N)"
  base="$OUT_DIR/c4-$n"
  reset_rate_limits
  control POST "/__control/reset?mode=accept_then_truncate_block_reconcile&runId=$run_id" \
    >"$base-control-reset.json"

  post_order "127.79.$n.1" "$base-request.out"
  request_http=$(response_code "$base-request.out")
  request_json=$(response_body "$base-request.out")
  [[ "$request_http" == 202 ]]
  ! grep -q '"filledImmediately":true' <<<"$request_json"

  state=$(control GET /__control/state)
  printf '%s\n' "$state" >"$base-control-before-recovery.json"
  submit_count=$(printf '%s' "$state" | json_field submitCount)
  orders_length=$(printf '%s' "$state" | json_length orders)
  blocked_reads=$(printf '%s' "$state" | json_field blockedReadCount)
  [[ "$submit_count" == 1 ]]
  [[ "$orders_length" == 1 ]]
  [[ "$blocked_reads" -ge 1 ]]
  [[ "$(printf '%s' "$state" | json_field recoveryReadsBlocked)" == true ]]
  client_order_id=$(printf '%s' "$state" | json_field orders.0.clientOrderId)

  row=$(intent_row "$client_order_id")
  printf '%s\n' "$row" >"$base-intent-before-recovery.txt"
  intent=${row%%|*}
  before_status=$(printf '%s' "$row" | cut -d'|' -f2)
  before_fills=$(printf '%s' "$row" | cut -d'|' -f4)
  [[ "$before_status" == UNKNOWN ]]
  [[ "$before_fills" == 0 ]]

  release=$(control POST "/__control/release-recovery?runId=$run_id")
  printf '%s\n' "$release" >"$base-control-release.json"
  [[ "$(printf '%s' "$release" | json_field ok)" == true ]]

  recover_intent "$intent" "127.80.$n.1" "$base-recovery.out"
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
  successful_reads=$(printf '%s' "$state" | json_field successfulRecoveryReads)
  [[ "$submit_count" == 1 ]]
  [[ "$orders_length" == 1 ]]
  [[ "$successful_reads" -ge 1 ]]

  printf 'C4 run=%s submit_count=%s orders.length=%s clientOrderId=%s intent_before=%s inline_reconciliation=false recovery_route_called=true final=%s fills=%s PASS\n' \
    "$n" "$submit_count" "$orders_length" "$client_order_id" "$before_status" "$final_status" "$final_fills"
}

echo "UTC_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "C4_RUNS=$C4_RUNS"
for n in $(seq 1 "$C4_RUNS"); do run_c4 "$n"; done
echo "UTC_END=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "CHAOS_C4=$C4_RUNS/$C4_RUNS PASS"
