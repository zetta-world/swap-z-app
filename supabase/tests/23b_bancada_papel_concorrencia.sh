#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# 23b — PAPEL ADIANTE sob CONCORRÊNCIA real (migration 0076, RM-01/RM-02)
# Complementa o 23 (uma transação só não prova a exclusão entre sessões).
#
# ⚠️ SÓ EM BANCO DESCARTÁVEL (cadeia 0001→0076). NUNCA contra produção.
# Grava dados de verdade (as sessões precisam ver os COMMITs umas das outras) e apaga tudo no fim.
#
# Para cada N em NS (padrão "2 10 30"):
#   A. LEASE — N sessões pedem o lease do tique ao mesmo tempo, cada uma com token próprio, e seguram a
#      transação um instante. Com o caminho antigo (SELECT → decide → UPSERT) várias passariam.
#      Esperado: exatamente 1 'ok', N−1 'ocupado', 0 erros.
#   B. ABERTURA — N sessões abrem a MESMA oportunidade (mesma mesa, mesma vela; símbolos alternados).
#      Esperado: exatamente 1 'criada', N−1 'ja_registrada', 1 linha no banco, 0 erros.
#   C. CONTROLE — N mesas DIFERENTES, mesma vela, em paralelo: todas abrem (a trava não serializa demais).
#
# Uso: PSQL="psql -X -U supabase_admin -d postgres" NS="2 10 30" bash 23b_….sh
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
PSQL=${PSQL:-"psql -X -U supabase_admin -d postgres"}
NS=${NS:-"2 10 30"}
VELA=1700000000000
q() { $PSQL -v ON_ERROR_STOP=1 -t -A -c "$1"; }
limpar() {
  q "delete from public.bancada_estrategia where dono like 'conc23b%'" >/dev/null
  q "delete from public.bancada_arrendamento where escopo = 'conc_tique_23b'" >/dev/null
}
FALHOU=0
for N in $NS; do
  limpar
  TMP=$(mktemp -d)
  # ── A. lease ─────────────────────────────────────────────────────────
  for i in $(seq 1 "$N"); do
    $PSQL -t -A > "$TMP/a$i.out" 2>&1 <<Q &
begin;
set local role service_role;
select 'R='||(public.bancada_tique_arrendar('conc_tique_23b', 'sessao-23b-$i-$RANDOM', 60000)->>'ok');
select pg_sleep(0.05);
commit;
Q
  done
  wait
  A_OK=$(cat "$TMP"/a*.out | grep -c '^R=true' || true)
  A_NAO=$(cat "$TMP"/a*.out | grep -c '^R=false' || true)
  A_ERR=$(cat "$TMP"/a*.out | grep -ciE 'error|erro' || true)

  # ── B. mesma oportunidade ────────────────────────────────────────────
  M=$(q "insert into public.bancada_estrategia (dono, chain, nome, praca, papel, papel_adiante, simbolos, intervalo)
         values ('conc23b', 'evm', 't23b', 'spot_gate', 'taker', true, array['BTC','ETH'], '1h') returning id" | head -1)
  for i in $(seq 1 "$N"); do
    SIM=$([ $((i % 2)) = 0 ] && echo BTC || echo ETH)
    $PSQL -t -A > "$TMP/b$i.out" 2>&1 <<Q &
begin;
set local role service_role;
select 'R='||coalesce(r->>'criada','x')||':'||coalesce(r->>'motivo','-') from (
  select public.bancada_abrir_posicao_papel('conc23b', '$M'::uuid, '$SIM', 'long', 100, 1000, 3, 2,
    now() + interval '72 hours', $VELA, '1h', null, 72) as r) s;
select pg_sleep(0.05);
commit;
Q
  done
  wait
  B_CRIADA=$(cat "$TMP"/b*.out | grep -c '^R=true:' || true)
  B_REG=$(cat "$TMP"/b*.out | grep -c '^R=false:ja_registrada' || true)
  B_ERR=$(cat "$TMP"/b*.out | grep -ciE 'error|erro' || true)
  B_LINHAS=$(q "select count(*) from public.bancada_posicao where estrategia_id = '$M'")

  # ── C. mesas diferentes ──────────────────────────────────────────────
  for i in $(seq 1 "$N"); do
    $PSQL -t -A > "$TMP/c$i.out" 2>&1 <<Q &
begin;
set local role service_role;
with e as (insert into public.bancada_estrategia (dono, chain, nome, praca, papel, papel_adiante, simbolos, intervalo)
           values ('conc23b-c', 'evm', 't23b', 'spot_gate', 'taker', true, array['BTC'], '1h') returning id)
select 'R='||(public.bancada_abrir_posicao_papel('conc23b-c', e.id, 'BTC', 'long', 100, 1000, 3, 2,
  now() + interval '72 hours', $VELA, '1h', null, 72)->>'criada') from e;
commit;
Q
  done
  wait
  C_OK=$(cat "$TMP"/c*.out | grep -c '^R=true' || true)

  echo "N=$N lease_ok=$A_OK lease_ocupado=$A_NAO lease_erros=$A_ERR | mesma_oportunidade_criada=$B_CRIADA ja_registrada=$B_REG erros=$B_ERR linhas=$B_LINHAS | mesas_diferentes_ok=$C_OK"
  if [ "$A_OK" = 1 ] && [ "$A_NAO" = "$((N - 1))" ] && [ "$A_ERR" = 0 ] \
     && [ "$B_CRIADA" = 1 ] && [ "$B_REG" = "$((N - 1))" ] && [ "$B_ERR" = 0 ] && [ "$B_LINHAS" = 1 ] \
     && [ "$C_OK" = "$N" ]; then
    echo "  N=$N PASS"
  else
    echo "  N=$N FAIL"; FALHOU=1
  fi
  rm -rf "$TMP"
done
limpar
[ "$FALHOU" = 0 ] && echo "T23b PASS" || { echo "T23b FAIL"; exit 1; }
