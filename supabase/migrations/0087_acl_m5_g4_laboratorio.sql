-- ═══════════════════════════════════════════════════════════════════════════
-- 0087 — R4/M5-G4 (Admin CC 2.0): fechamento TOTAL de laboratório/papel/mercado (20 tabelas)
-- para PUBLIC/anon/authenticated (padrão 0067/0070/0078)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O M1 (0079) tirou TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. Sobravam
-- SELECT/INSERT/UPDATE/DELETE para `anon`/`authenticated` — barrados hoje só
-- pela RLS sem policy (0 linhas / "new row violates row-level security"). Um
-- policy criado por engano, ou RLS desligada numa manutenção, abriria a tabela
-- para a chave pública. Com o REVOKE, a barreira passa a ser a ACL (42501).
--
-- Consumidores (docs/ADMIN-SECURITY-DB-ACL.md §4): o app só alcança estas
-- tabelas por `service_role` (`getSupabaseAdmin`), que NÃO é tocado aqui. O
-- cliente com chave anon só assina o canal broadcast do Realtime (não lê tabela).
-- O teste `checkRls` (src/lib/admin/audit.ts) segue passando: o GET anon passa
-- de `200 []` para 401/403 (`res.ok` falso → sem vazamento).
--
-- Uma migration POR GRUPO (G1 → G2 → G3 → G4), cada uma reversível sozinha.
-- LISTA FECHADA; tabela ausente (desvio local × hospedado) é pulada com aviso.
--
-- ROLLBACK: `grant select, insert, update, delete on table public.<t> to anon, authenticated;`
-- (o M1 continua valendo).
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
  tabelas text[] := array[
    'paper_accounts','paper_positions','lab_strategies','lab_runs','lab_results','lab_capital_log',
    'bancada_estrategia','bancada_rodada','bancada_operacao','bancada_posicao','bancada_resultado',
    'bancada_arrendamento','celeiro_genoma','celeiro_mutacoes','celeiro_fluxos','celeiro_posicoes',
    'mercado_vela','mercado_cobertura','pro_piscina_medicao','pro_piscina_veredito'];
begin
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is null then
      raise notice '0087: public.% ausente — pulada', t;
      continue;
    end if;
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;
