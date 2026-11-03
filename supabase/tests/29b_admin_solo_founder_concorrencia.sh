#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# 29b — 0088: DOIS bootstraps simultâneos, em processos separados, disputando a
# mesma governança. Só um pode criar o superadmin de fundador.
#
# Uso (cluster DESCARTÁVEL, nunca produção):  PSQL="psql -h … -U postgres -d zswap" bash 29b_…sh
# Deixa as linhas gravadas (o cluster é descartável; a trilha é append-only).
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
PSQL=${PSQL:?defina PSQL}

$PSQL -v ON_ERROR_STOP=1 -q <<'SQL'
insert into admin_private.admin_identities
  (id, status, email_normalized, provider, expected_issuer, expected_tenant, auth_user_id, idp_subject, mfa_factor_id, mfa_enrolled_at)
values ('00000000-0000-0000-0000-0000000000f1','active','dono@concorrencia.test','google','https://accounts.google.com','concorrencia.test',
        '10000000-0000-0000-0000-0000000000f1','sub-f','20000000-0000-0000-0000-0000000000f1', now());
insert into admin_private.admin_sessions
  (id, token_hash, kind, state, identity_id, absolute_expires_at, idle_timeout_s, aal, mfa_verified_at, step_up_at)
values ('30000000-0000-0000-0000-0000000000f1', decode(repeat('f1',32),'hex'), 'corp','active','00000000-0000-0000-0000-0000000000f1',
        now() + interval '8 hours', 1800, 'aal2', now(), now());
SQL

# processo 1 faz o bootstrap e SEGURA a transação 2 s; processo 2 tenta no meio, com OUTRO token
( $PSQL -v ON_ERROR_STOP=1 -qtA <<'SQL'
begin;
set local role service_role;
select 'P1=' || admin_private.founder_bootstrap('00000000-0000-0000-0000-0000000000f1','30000000-0000-0000-0000-0000000000f1',
  decode(repeat('a1',32),'hex'), 'dono@concorrencia.test', 'p1');
select pg_sleep(2);
commit;
SQL
) > /tmp/zswap-29b-p1.out &
P1=$!
sleep 0.5
$PSQL -v ON_ERROR_STOP=1 -qtA <<'SQL' > /tmp/zswap-29b-p2.out
begin;
set local role service_role;
select 'P2=' || admin_private.founder_bootstrap('00000000-0000-0000-0000-0000000000f1','30000000-0000-0000-0000-0000000000f1',
  decode(repeat('a2',32),'hex'), 'dono@concorrencia.test', 'p2');
commit;
SQL
wait $P1

R1=$(grep -o 'P1=.*' /tmp/zswap-29b-p1.out); R2=$(grep -o 'P2=.*' /tmp/zswap-29b-p2.out)
N=$($PSQL -qtA -c "select count(*) from admin_private.admin_role_assignments where grant_kind = 'founder_bootstrap'")
A=$($PSQL -qtA -c "select count(*) from admin_private.admin_founder_authorizations where purpose = 'bootstrap'")
echo "$R1 · $R2 · founder_bootstrap=$N · autorizacoes=$A"
rm -f /tmp/zswap-29b-p1.out /tmp/zswap-29b-p2.out
if [ "$R1" = "P1=ok" ] && [ "$R2" = "P2=ja_feito" ] && [ "$N" = "1" ] && [ "$A" = "1" ]; then
  echo "T29b ok — concorrência: um bootstrap, o outro esperou a trava e recusou; 1 superadmin de fundador"
else
  echo "T29b FALHOU"; exit 1
fi
