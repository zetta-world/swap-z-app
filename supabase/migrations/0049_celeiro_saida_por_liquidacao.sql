-- ═══════════════════════════════════════════════════════════════════════
-- A SAÍDA POR LIQUIDAÇÃO EXISTIA EM PRODUÇÃO E NÃO EXISTIA NO REPO — 15/09
--
-- ⚠️⚠️ ACHADO A05 DA AUDITORIA EXTERNA. Em 23/08 a restrição de
-- `celeiro_posicoes.motivo_saida` foi ampliada DIRETO no banco de produção,
-- para aceitar `liquidacao`. O arquivo nunca entrou no repositório.
--
-- Medido em 15/09, comparando `supabase_migrations.schema_migrations` com
-- `supabase/migrations/`:
--
--   produção   CHECK (motivo_saida = ANY (ARRAY['alvo','stop','tempo','liquidacao']))
--   repo       0028_celeiro_posicoes.sql:35 → check (... in ('alvo','stop','tempo'))
--
-- ⚠️ E ISSO NÃO É COSMÉTICO. `src/lib/celeiro/posicao.ts:183` devolve
-- `motivo: "liquidacao"` quando o preço toca o nível de liquidação do agente
-- alavancado. Um banco reconstruído a partir deste repositório RECUSARIA essa
-- escrita — 23514 — no fechamento de uma posição alavancada, que é caminho de
-- dinheiro. Hoje em produção não dói porque produção tem a restrição larga; o
-- estrago aparece em qualquer ambiente novo, que é exatamente onde ninguém
-- estaria olhando.
--
-- ⚠️ IDEMPOTENTE. O `if exists` no drop faz esta migração rodar tanto num banco
-- vindo do 0028 (restrição estreita) quanto em produção (já ampliada). A versão
-- que rodou em 23/08 não tinha o `if exists` e não poderia ser reexecutada.
--
-- ⚠️ A LISTA É A MESMA DE `MotivoDeSaida` em `src/lib/celeiro/posicao.ts`, e
-- `saida-liquidacao.test.ts` amarra as duas: acrescentar um motivo no TypeScript
-- sem acrescentar aqui passa a quebrar o teste, em vez de quebrar a escrita.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.celeiro_posicoes
  drop constraint if exists celeiro_posicoes_motivo_saida_check;

alter table public.celeiro_posicoes
  add constraint celeiro_posicoes_motivo_saida_check
  check (motivo_saida = any (array['alvo'::text, 'stop'::text, 'tempo'::text, 'liquidacao'::text]));
