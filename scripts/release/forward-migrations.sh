#!/usr/bin/env bash
# Forward de migrations como ensaiado no PROD-CLONE (L-028): em ordem, UMA transação por arquivo,
# com a linha de histórico DENTRO da mesma transação; pula versão já registrada (reexecução = no-op).
#
#   PSQL='docker exec -i <db> psql -X -U supabase_admin -d postgres' \
#     scripts/release/forward-migrations.sh [--dry-run] 0059 0069
#
# ⚠️ Hospedado só com autorização do dono e depois da decisão EG-05 (nomenclatura das versões:
#    este script grava a versão de 4 dígitos do nome do arquivo, como no ensaio).
# Saída por arquivo: <v>|PASS|<sha256>|<ms> · <v>|SKIP_PRESENT|<sha256> · <v>|FAIL rc=N|<sha256>
# Exit: 0 tudo ok · 1 alguma migration falhou (para na primeira; o arquivo falho é revertido inteiro) · 2 uso.
set -uo pipefail
DRY=0; [[ "${1:-}" == "--dry-run" ]] && { DRY=1; shift; }
DE=${1:?versão inicial (ex.: 0059)}; ATE=${2:?versão final (ex.: 0069)}
[[ "$DE" =~ ^[0-9]{4}$ && "$ATE" =~ ^[0-9]{4}$ ]] || { echo "versões devem ter 4 dígitos" >&2; exit 2; }
: "${PSQL:?defina PSQL (comando psql completo, lendo SQL do stdin)}"
DIR=${MIGRATIONS_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/supabase/migrations}
q() { $PSQL -At -v ON_ERROR_STOP=1 -c "$1"; }
for n in $(seq $((10#$DE)) $((10#$ATE))); do
  v=$(printf '%04d' "$n"); f=$(ls "$DIR"/${v}_*.sql 2>/dev/null | head -1)
  [[ -n "$f" ]] || { echo "$v|FAIL missing-file|"; exit 1; }
  nome=$(basename "$f" .sql); nome=${nome#*_}; sha=$(sha256sum < "$f" | cut -c1-64)
  if [[ $DRY == 1 ]]; then echo "$v|PLAN|$sha|$nome"; continue; fi
  if [[ "$(q "select count(*) from supabase_migrations.schema_migrations where version='$v'")" == 1 ]]; then echo "$v|SKIP_PRESENT|$sha"; continue; fi
  t0=$(date +%s%N)
  saida=$({ cat "$f"; printf "\n;\ninsert into supabase_migrations.schema_migrations(version, statements, name) values ('%s', array[]::text[], '%s');\n" "$v" "$nome"; } \
          | $PSQL -v ON_ERROR_STOP=1 --single-transaction 2>&1); rc=$?
  if [[ $rc == 0 ]]; then echo "$v|PASS|$sha|$(( ($(date +%s%N)-t0)/1000000 ))ms"
  else echo "$v|FAIL rc=$rc|$sha"; printf '%s\n' "$saida" | grep -E 'ERROR' | head -3 | sed 's/^/  /'; exit 1; fi
done
