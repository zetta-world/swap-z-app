-- ─────────────────────────────────────────────────────────────────────────
-- O VEREDITO DA CHAVE FICA GRAVADO — Fase 7 (09/08).
--
-- ⚠️ POR QUE ISTO EXISTE.
--
-- O autopilot em segundo plano guarda a credencial do cliente CIFRADA NO
-- SERVIDOR (`creds_cipher`) para negociar com o navegador fechado. O controle
-- que torna esse risco aceitável é a chave ser "só negocia, não saca" — e esse
-- controle NUNCA foi verificado: o cliente gravava `readOnly: true` fixo num
-- campo que ninguém lia.
--
-- Agora o servidor pergunta à corretora antes de guardar. E a resposta tem que
-- ficar QUADRADA no banco: sem isto, o veredito viveria só no toast do momento
-- do armar, e daqui a um mês ninguém saberia dizer se a chave que está rodando
-- sozinha foi provada incapaz de sacar ou apenas não pôde ser verificada.
--
-- ⚠️ TRÊS VALORES, NÃO DOIS. `nao_verificavel` é uma resposta distinta de
-- `so_negocia` — invariante nº 6 da lista: não medimos ≠ medimos zero.
-- O default de uma linha antiga é NULL (nunca verificada), que também não é
-- "segura": é a ausência de medição, e a UI mostra assim.
-- ─────────────────────────────────────────────────────────────────────────

alter table autopilot_sessions
  add column if not exists key_permission        text,
  add column if not exists key_permission_detail text,
  add column if not exists key_checked_at        timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'autopilot_sessions_key_permission_chk'
  ) then
    alter table autopilot_sessions
      add constraint autopilot_sessions_key_permission_chk
      check (key_permission is null
             or key_permission in ('so_negocia', 'pode_sacar', 'nao_verificavel'));
  end if;
end $$;

-- ⚠️ `pode_sacar` é aceito pelo CHECK mas RECUSADO pela rota de armar. O banco
-- guarda o vocabulário completo de propósito: se um dia o veredito passar a ser
-- re-verificado numa sessão já armada, o valor tem onde ser gravado antes de a
-- sessão ser desligada. Um CHECK que proíbe o valor perigoso esconderia o caso
-- em vez de registrá-lo.

comment on column autopilot_sessions.key_permission is
  'Veredito da chave no momento do armar: so_negocia | pode_sacar | nao_verificavel. NULL = sessão anterior à verificação (ausência de medição, NÃO "segura").';
