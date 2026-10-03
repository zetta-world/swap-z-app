#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# 16b — EARLY ACCESS FASE 2: duas confirmações CONCORRENTES do mesmo token
# Migration: 0069 · Complementa o 16 (que roda numa transação só e não prova
# FOR UPDATE entre sessões).
#
# ⚠️ SÓ EM BANCO DESCARTÁVEL (cadeia 0001→0069). NUNCA contra produção.
# Grava dados de verdade (duas sessões precisam ver o mesmo COMMIT) e apaga
# tudo no fim.
#
# Uso (dentro do container descartável):  PSQL="psql -X -U supabase_admin -d postgres" bash 16b_….sh
# Esperado: exatamente UM 'confirmado' e UM 'ja_confirmado'; 1 evento
# email_verified; 3 consentimentos email_confirmation; token consumido 1 vez.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
PSQL=${PSQL:-"psql -X -U supabase_admin -d postgres"}
q() { $PSQL -v ON_ERROR_STOP=1 -t -A -c "$1"; }
H=$(q "select encode(sha256(convert_to('t16b:conc', 'UTF8')), 'hex')")
EMAIL='conc16b@example.com'

limpar() {
  q "do \$\$ declare v uuid; begin
       select id into v from public.early_access_signups where email_normalized = '$EMAIL';
       if v is not null then
         delete from public.early_access_verificacoes where signup_id = v;
         delete from public.early_access_events where signup_id = v;
         delete from public.early_access_consents where signup_id = v;
         delete from public.early_access_signups where id = v;
       end if; end \$\$;" >/dev/null
}
limpar
q "set role service_role; select public.early_access_inscrever('$EMAIL', 'Pessoa Concorrente', 'BR', null, null, null, null, null,
     array['WWWWWWWWW9'], null, null, null, null, null, '/early-access', null, 'early_access_page',
     'tos-2026-10', 'priv-2026-10', false, null, 'pt', '$H')" >/dev/null

# sessão 1 confirma e SEGURA a transação por 2 s; sessão 2 tenta no meio
$PSQL -t -A > /tmp/16b_p1.out 2>&1 <<Q &
begin;
set local role service_role;
select 'P1='||(public.early_access_confirmar_email('$H', 'tos-2026-10', 'priv-2026-10', null, null, null)->>'resultado');
select pg_sleep(2);
commit;
Q
sleep 0.5
$PSQL -t -A > /tmp/16b_p2.out 2>&1 <<Q
begin;
set local role service_role;
select 'P2='||(public.early_access_confirmar_email('$H', 'tos-2026-10', 'priv-2026-10', null, null, null)->>'resultado');
commit;
Q
wait

R1=$(grep -E '^P1=' /tmp/16b_p1.out || true); R2=$(grep -E '^P2=' /tmp/16b_p2.out || true)
EV=$(q "select count(*) from public.early_access_events e join public.early_access_signups s on s.id = e.signup_id
        where s.email_normalized = '$EMAIL' and e.kind = 'email_verified'")
CO=$(q "select count(*) from public.early_access_consents c join public.early_access_signups s on s.id = c.signup_id
        where s.email_normalized = '$EMAIL' and c.source = 'email_confirmation'")
limpar
echo "$R1 $R2 email_verified=$EV consents_titular=$CO"
if [ "$R1" = "P1=confirmado" ] && [ "$R2" = "P2=ja_confirmado" ] && [ "$EV" = "1" ] && [ "$CO" = "3" ]; then
  echo "T16b OK — duas sessoes: uma confirma, a outra espera o lock e ve ja_confirmado; efeito unico"
else
  echo "T16b FAIL"; exit 1
fi

# ── T16b.2 — EA2-IA02: dois RETRIES concorrentes do mesmo token ─────────────
# Esperado: exatamente UM reemite (tentativa 2); o outro espera o lock e
# devolve nulo; sobra exatamente UM token ativo; o antigo cai como send_failed.
EMAIL='retry16b@example.com'
H1=$(q "select encode(sha256(convert_to('t16b:retry1', 'UTF8')), 'hex')")
HA=$(q "select encode(sha256(convert_to('t16b:retryA', 'UTF8')), 'hex')")
HB=$(q "select encode(sha256(convert_to('t16b:retryB', 'UTF8')), 'hex')")
limpar
q "set role service_role; select public.early_access_inscrever('$EMAIL', 'Pessoa Retry', 'BR', null, null, null, null, null,
     array['WWWWWWWWW8'], null, null, null, null, null, '/early-access', null, 'early_access_page',
     'tos-2026-10', 'priv-2026-10', false, null, 'pt', '$H1')" >/dev/null
q "set role service_role; select public.early_access_registrar_envio('$H1', false, 'provider_5xx', null, true)" >/dev/null
ID=$(q "select id from public.early_access_verificacoes where token_hash = '$H1'")

$PSQL -t -A > /tmp/16b_r1.out 2>&1 <<Q &
begin;
set local role service_role;
select 'R1='||coalesce((public.early_access_reemitir('$ID', '$HA'))::text, 'NULO');
select pg_sleep(2);
commit;
Q
sleep 0.5
$PSQL -t -A > /tmp/16b_r2.out 2>&1 <<Q
begin;
set local role service_role;
select 'R2='||coalesce((public.early_access_reemitir('$ID', '$HB'))::text, 'NULO');
commit;
Q
wait
X1=$(grep -E '^R1=' /tmp/16b_r1.out | sed 's/^R1=//' || true); X2=$(grep -E '^R2=' /tmp/16b_r2.out | sed 's/^R2=//' || true)
ATIVOS=$(q "select count(*) from public.early_access_verificacoes v join public.early_access_signups s on s.id = v.signup_id
            where s.email_normalized = '$EMAIL' and v.consumed_at is null and v.revoked_at is null")
TENT=$(q "select string_agg(tentativa::text || ':' || coalesce(revoked_reason, 'ativo'), ',' order by tentativa)
          from public.early_access_verificacoes v join public.early_access_signups s on s.id = v.signup_id
          where s.email_normalized = '$EMAIL'")
limpar
NULOS=$( { [ "$X1" = "NULO" ] && echo 1; [ "$X2" = "NULO" ] && echo 1; } | wc -l)
echo "retry: R1=$( [ "$X1" = NULO ] && echo NULO || echo EMITIU ) R2=$( [ "$X2" = NULO ] && echo NULO || echo EMITIU ) ativos=$ATIVOS tokens=$TENT"
if [ "$NULOS" = "1" ] && [ "$ATIVOS" = "1" ] && [ "$TENT" = "1:send_failed,2:ativo" ]; then
  echo "T16b.2 OK — dois retries concorrentes: um reemite, o outro ve o token ja trocado; um ativo so"
else
  echo "T16b.2 FAIL"; exit 1
fi
