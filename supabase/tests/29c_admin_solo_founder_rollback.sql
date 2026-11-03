\set ON_ERROR_STOP on
-- ═══════════════════════════════════════════════════════════════════════════
-- 29c — ROLLBACK da 0088 (é o próprio roteiro de rollback, validado no harness).
--
-- Só vale ANTES de qualquer bootstrap/recuperação: depois disso há superadmin
-- sem concedente, que a regra da 0083 não aceita. Nesse caso NÃO rodar: voltar
-- ADMIN_AUTH_MODE para legacy (o Admin decide como antes; admin_private fica
-- intacto) e seguir docs/ADMIN-SOLO-FOUNDER-MODE.md § Recuperação.
--
-- Prova no harness: depois deste arquivo, o 27_admin_private.sql (regras da
-- 0083) passa de novo; depois, a 0088 reaplica limpa e o 29 passa.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if exists (select 1 from admin_private.admin_role_assignments where grant_kind <> 'standard')
     or exists (select 1 from admin_private.admin_founder_authorizations)
     or (select mode from admin_private.admin_governance) <> 'multi_admin' then
    raise exception 'rollback 0088 recusado: já houve bootstrap/recuperação (ver docs/ADMIN-SOLO-FOUNDER-MODE.md)';
  end if;
end $$;

drop function admin_private.founder_bootstrap(uuid, uuid, bytea, text, text);
drop function admin_private.founder_mfa_reset(bytea, text, bytea, timestamptz, text, text);
drop function admin_private.governance_to_multi(uuid, text);
drop trigger ara_imutavel_salvo_revogacao on admin_private.admin_role_assignments;
drop function admin_private.ara_so_revogacao();
drop index admin_private.ara_fundador_uma_vez;
alter table admin_private.admin_role_assignments
  drop constraint ara_concessao_padrao,
  drop constraint ara_concessao_fundador,
  drop column founder_authorization,
  drop column grant_kind;
alter table admin_private.admin_role_assignments alter column granted_by set not null;
-- as 3 regras da 0083, de volta (mesma definição)
alter table admin_private.admin_role_assignments
  add check (granted_by <> identity_id),
  add check (approved_by is null or (approved_by <> granted_by and approved_by <> identity_id)),
  add check (role not in ('superadmin','security_admin') or approved_by is not null);
drop table admin_private.admin_founder_authorizations;
drop table admin_private.admin_governance;

commit;
\echo 'rollback 0088 aplicado'
