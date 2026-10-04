#!/usr/bin/env bash
# Confere um banco contra um estado esperado de scripts/release/expected.json (baseline | target).
# Só leitura: tudo roda dentro de "begin transaction read only … rollback".
#   PSQL='…' scripts/release/verify-state.sh baseline|target
# Exit 0 = confere; 1 = diverge; 2 = uso.
set -uo pipefail
ESTADO=${1:?baseline|target}; [[ "$ESTADO" == baseline || "$ESTADO" == target ]] || exit 2
: "${PSQL:?defina PSQL}"
AQUI=$(cd "$(dirname "$0")" && pwd)
esp() { node -e "const e=require('$AQUI/expected.json')['$ESTADO'];console.log(e['$1'])"; }
ro() { { echo "begin transaction read only;"; cat; echo "rollback;"; } | $PSQL -At -v ON_ERROR_STOP=1 | grep -vE '^(BEGIN|ROLLBACK)$'; }
fp=$(ro < "$AQUI/sql/fp_v1.sql" | tail -1)
rows=$(echo "select count(*) from supabase_migrations.schema_migrations;" | ro | tail -1)
tabs=$(echo "select count(*) from pg_tables where schemaname='public';" | ro | tail -1)
ok=1
chk() { if [[ "$2" == "$3" ]]; then echo "OK   $1=$2"; else echo "DIFF $1: atual=$2 esperado=$3"; ok=0; fi; }
chk fp_v1 "$fp" "$(esp fp_v1)"; chk history_rows "$rows" "$(esp history_rows)"; chk public_tables "$tabs" "$(esp public_tables)"
echo "ESTADO_$ESTADO=$([[ $ok == 1 ]] && echo CONFERE || echo DIVERGE)"; [[ $ok == 1 ]]
