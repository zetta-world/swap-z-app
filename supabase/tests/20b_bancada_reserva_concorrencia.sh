#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# 20b — COTA DA BANCADA sob CONCORRÊNCIA real (migration 0073, CE-04)
# Complementa o 20 (uma transação só não prova a trava entre sessões).
#
# ⚠️ SÓ EM BANCO DESCARTÁVEL (cadeia 0001→0073). NUNCA contra produção.
# Grava dados de verdade (as sessões precisam ver os COMMITs umas das outras)
# e apaga tudo no fim.
#
# Cenário: limite = 10; CONC sessões simultâneas do MESMO dono, cada uma segura
# a transação por um instante depois de reservar (alarga a janela de corrida).
# Com o caminho antigo (ler → decidir → inserir) todas leriam "0 usadas" e
# passariam. Esperado aqui: exatamente 10 'ok' e CONC−10 'cota_esgotada';
# 10 linhas no banco. Um segundo dono em paralelo não é afetado.
#
# Uso: PSQL="psql -X -U supabase_admin -d postgres" CONC=30 bash 20b_….sh
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
PSQL=${PSQL:-"psql -X -U supabase_admin -d postgres"}
CONC=${CONC:-30}
LIMITE=10
TMP=$(mktemp -d)
q() { $PSQL -v ON_ERROR_STOP=1 -t -A -c "$1"; }

limpar() { q "delete from public.bancada_rodada where dono in ('conc20b', 'conc20b-outro')" >/dev/null; }
limpar

for i in $(seq 1 "$CONC"); do
  $PSQL -t -A > "$TMP/s$i.out" 2>&1 <<Q &
begin;
set local role service_role;
select 'R='||(public.bancada_reservar_rodada('conc20b', 'evm', null, 'propria', 100, array['BTC'], '1d',
  1000, 2000, 'spot_gate', 'taker', '{}'::jsonb, 1, 1, $LIMITE, 1000000, 86400000)->>'ok');
select pg_sleep(0.05);
commit;
Q
done
# um dono diferente, em paralelo, com limite 1: tem de passar
$PSQL -t -A > "$TMP/outro.out" 2>&1 <<Q &
begin;
set local role service_role;
select 'R='||(public.bancada_reservar_rodada('conc20b-outro', 'evm', null, 'propria', 100, array['BTC'], '1d',
  1000, 2000, 'spot_gate', 'taker', '{}'::jsonb, 1, 1, 1, 1000000, 86400000)->>'ok');
commit;
Q
wait

OK=$(cat "$TMP"/s*.out | grep -c '^R=true' || true)
NAO=$(cat "$TMP"/s*.out | grep -c '^R=false' || true)
ERR=$(cat "$TMP"/s*.out | grep -ciE 'error|erro' || true)
OUTRO=$(grep -c '^R=true' "$TMP/outro.out" || true)
LINHAS=$(q "select count(*) from public.bancada_rodada where dono = 'conc20b'")
limpar
rm -rf "$TMP"
echo "sessoes=$CONC ok=$OK recusadas=$NAO erros=$ERR linhas=$LINHAS outro_dono_ok=$OUTRO"
if [ "$OK" = "$LIMITE" ] && [ "$NAO" = "$((CONC - LIMITE))" ] && [ "$ERR" = "0" ] && [ "$LINHAS" = "$LIMITE" ] && [ "$OUTRO" = "1" ]; then
  echo "T20b PASS"
else
  echo "T20b FAIL"; exit 1
fi
