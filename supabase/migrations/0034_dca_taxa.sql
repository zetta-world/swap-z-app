-- ── A TAXA QUE O PLANO PAGOU ─────────────────────────────────────────
--
-- ⚠️ POR QUE ESTA COLUNA (26/08).
--
-- `dca_ciclos.custo_usd` guarda `order.cost` — o TOTAL GASTO na compra, não a
-- taxa. A taxa da corretora não era gravada em lugar nenhum, e o efeito é o de
-- sempre: o `src/lib/dca/custo.ts` consegue PROJETAR quanto o plano vai pagar,
-- e não tinha contra o que conferir. Projeção que ninguém afere é promessa.
--
-- E a conta já existia pronta: `taxaEmUsd()` em `src/lib/cex/taxa.ts` resolve
-- taxa cobrada em stablecoin e na moeda base sem consultar preço nenhum. O que
-- faltava era o lugar para guardar o resultado.
--
-- ⚠️ NULLABLE DE PROPÓSITO, e a distinção é o ponto.
--
-- `null` = ciclo anterior a esta migration, ou taxa que a corretora devolveu
-- numa moeda que não conseguimos precificar. `0` = a corretora cobrou zero.
-- Um default de 0 apagaria essa diferença, e `compararComRealizado()` leria os
-- ciclos antigos como "taxa zero" — fazendo a alíquota real despencar e a tela
-- anunciar que a corretora está cobrando barato. Mesma família do
-- `expired ≠ win/loss` do flywheel: ausência de dado não é dado.
--
-- `taxa_nao_precificada` guarda o que não deu para converter (ex.: taxa em BNB
-- num par que não é BNB). Continuar subtraindo zero é a única saída possível —
-- inventar preço seria pior — mas ela para de ser invisível.

alter table public.dca_ciclos
  add column if not exists taxa_usd numeric check (taxa_usd is null or taxa_usd >= 0);

alter table public.dca_ciclos
  add column if not exists taxa_nao_precificada jsonb;

comment on column public.dca_ciclos.taxa_usd is
  'Taxa da corretora em USD. NULL = nao registrada (ciclo antigo ou moeda nao precificavel); 0 = cobrou zero. Ver src/lib/dca/custo.ts';

comment on column public.dca_ciclos.taxa_nao_precificada is
  'A taxa que a corretora cobrou numa moeda sem preco conhecido: {moeda, valor}. NULL quando nao houve.';
