#!/usr/bin/env sh
# 24b — W3-C: duas sessões REAIS disputando a mesma carteira com assinaturas diferentes.
# ⚠️ SÓ EM BANCO DESCARTÁVEL. Uso: PSQL="psql -X -U supabase_admin -d postgres" sh 24b_solana_tx_em_voo_concorrencia.sh
# Esperado: exatamente UMA 'reservada' e UMA 'bloqueada'; 'T24b PASS'.
set -eu
: "${PSQL:?defina PSQL}"
C=Fh8nWt7QBhLNGjSSHB3oZqfLSWBRHmwH4TrjYH4Wrn6L
H=$(printf 'f%.0s' $(seq 64)); BH=4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi
A=$(printf 'C%.0s' $(seq 88)); B=$(printf 'D%.0s' $(seq 88))
$PSQL -qAt -c "delete from public.solana_tx_em_voo where carteira='$C'"
$PSQL -qAt -c "begin; select public.solana_tx_reservar('$C','$A','$H','$BH',10)->>'resultado'; select pg_sleep(2); commit;" > /tmp/24b-a.txt &
sleep 0.5
$PSQL -qAt -c "begin; select public.solana_tx_reservar('$C','$B','$H','$BH',10)->>'resultado'; commit;" > /tmp/24b-b.txt
wait
RA=$(grep -E 'reservada|bloqueada' /tmp/24b-a.txt); RB=$(grep -E 'reservada|bloqueada' /tmp/24b-b.txt)
N=$($PSQL -qAt -c "select count(*) from public.solana_tx_em_voo where carteira='$C' and estado <> 'resolvida'")
$PSQL -qAt -c "delete from public.solana_tx_em_voo where carteira='$C'"
echo "A=$RA B=$RB abertas=$N"
[ "$RA" = reservada ] && [ "$RB" = bloqueada ] && [ "$N" = 1 ] && echo 'T24b PASS' || { echo 'T24b FAIL'; exit 1; }
