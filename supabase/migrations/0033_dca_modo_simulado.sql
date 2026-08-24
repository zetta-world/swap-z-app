-- ── DCA: MODO SIMULADO ───────────────────────────────────────────────
-- (docs/PLANO-DCA-AUTOMATICO.md)
--
-- ⚠️⚠️ POR QUE NO PLANO E NÃO NUMA VARIÁVEL DE AMBIENTE.
--
-- Um `DCA_DRY_RUN` global faria o MESMO plano se comportar de um jeito hoje e
-- de outro amanhã, conforme o deploy. Pior: alguém virando a chave
-- transformaria histórico simulado em histórico com cara de real, sem que nada
-- na linha do banco denunciasse.
--
-- No plano, o modo é decidido uma vez e nunca muda. Simulado e real jamais
-- ocupam a mesma conta — a mesma disciplina que separa MESAS (papel) de
-- DINHEIRO (receita) no admin, e pelo mesmo motivo: misturar os dois já custou
-- caro neste produto.
--
-- ⚠️ E O PADRÃO É `simulado`. Criar plano que gasta dinheiro de verdade tem de
-- ser ato deliberado; esquecer o campo não pode comprar nada.

alter table public.dca_planos
  add column if not exists modo text not null default 'simulado'
    check (modo in ('simulado', 'real'));

/**
 * ⚠️ CARIMBO TAMBÉM NO CICLO, e não é redundância.
 *
 * Se o modo vivesse só no plano, um `update` na linha do plano relabelaria
 * TODO o histórico dele de uma vez. Com o carimbo no ciclo, o que aconteceu
 * fica dito onde aconteceu, e nenhuma edição futura reescreve o passado.
 */
alter table public.dca_ciclos
  add column if not exists simulado boolean not null default false;

/**
 * ⚠️ PLANO SIMULADO NÃO PRECISA DE CREDENCIAL — e este é o ponto inteiro.
 *
 * Dá para exercitar o relógio, a reserva, os tetos e o extrato SEM entregar a
 * chave da corretora a ninguém. Então `conexao_id` deixa de ser obrigatório...
 */
alter table public.dca_planos
  alter column conexao_id drop not null;

/**
 * ...mas o BANCO garante que plano REAL tem conexão. A regra não pode viver só
 * no TypeScript: `dca_planos` está fora do tipo `Database` (o teto de
 * inferência do supabase-js, §5.3 do ESTADO-ATUAL), então aqui não há checagem
 * de tipo nenhuma. O check constraint é a única trava que sobra.
 */
alter table public.dca_planos
  drop constraint if exists dca_planos_real_exige_conexao;
alter table public.dca_planos
  add constraint dca_planos_real_exige_conexao
  check (modo = 'simulado' or conexao_id is not null);
