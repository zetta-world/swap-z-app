-- ═══════════════════════════════════════════════════════════════════════════
-- O VOCABULÁRIO DO VEREDITO — quatro trabalhos, quatro palavras (Fase 10).
--
-- ⚠️ POR QUE ISTO EXISTE (11/08).
--
-- A auditoria de estado cruzou `lab_strategies.status` (o que a tela pinta)
-- com o veredito da última rodada `ok` em `lab_results`. Onze das 28 linhas
-- contavam histórias diferentes, e em oito delas a tela contava a mais
-- favorável:
--
--   · `grid_bot`     — a mesa perdeu 54,19% do capital; a tela dizia CINZA
--   · `momentum_...` — perdeu 3,01% por período; a tela dizia CINZA
--   · `dex_cex_arb`  — o livro gravou MORTA; a tela dizia CINZA
--   · `amm_lp`       — EMPATE medido, a medição mais cara da Fase 8; CINZA
--   · `covered_call` / `restaking` — inconclusivas por margem e por piso; CINZA
--   · três verdes e duas mortas com ZERO rodadas no livro
--
-- A causa não é desleixo de atualização: é que `cinza` fazia QUATRO trabalhos
-- ao mesmo tempo — "nunca medida", "medida e deu empate", "rodou e não deu
-- para concluir" e "não é mensurável com fonte que a gente alcança". Os quatro
-- pedem coisas diferentes de quem lê; colapsados num só, pedem nada.
--
-- ⚠️ E A DISTINÇÃO JÁ EXISTIA NO CÓDIGO. Cinco dos sete módulos de medição
-- devolvem `readable: boolean` ao lado do status — `false` = não deu para ler,
-- `true` = leu e não há vantagem. O campo morria no ponto de contato com esta
-- tabela, porque `verdict` só aceitava três valores. Informação produzida, que
-- custou rodada, e que não chegava à coluna.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ ESTA MIGRAÇÃO VEM ANTES DO DEPLOY DO CÓDIGO.
--
-- `syncRegistry` roda no GET do laboratório. Código novo mandando 'empate'
-- para um banco com a restrição velha derruba o painel inteiro com 500 —
-- não é degradação, é queda. Banco primeiro, código depois.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. O ESTADO DA ESTRATÉGIA ─────────────────────────────────────────────
alter table lab_strategies drop constraint if exists lab_strategies_status_check;
alter table lab_strategies add constraint lab_strategies_status_check
  check (status in ('verde', 'cinza', 'morta', 'empate', 'inconclusiva', 'nao_mensuravel'));

-- ⚠️ MOTIVO OBRIGATÓRIO, senão `nao_mensuravel` vira o novo cinza: um lugar
-- onde coisa difícil se esconde sem ninguém precisar escrever por quê. O
-- comprimento mínimo é o mesmo critério de `capital_why` — 25 caracteres não
-- cabem numa desculpa de uma palavra.
alter table lab_strategies add column if not exists not_measurable_why text;
alter table lab_strategies drop constraint if exists lab_strategies_nao_mensuravel_com_motivo;
alter table lab_strategies add constraint lab_strategies_nao_mensuravel_com_motivo
  check (status <> 'nao_mensuravel' or length(coalesce(not_measurable_why, '')) >= 25);

-- ⚠️ ONDE A MEDIÇÃO VIVE, quando ela não vive aqui.
--
-- As três mesas de tendência e o comprar-e-segurar foram medidos na Fase 1
-- pelo painel 🧭, fora do `lab_runs`. Fabricar uma linha de rodada com números
-- copiados à mão seria INVENTAR PARCELA — exatamente o oposto do que estas
-- tabelas existem para fazer. Elas declaram onde o número mora, e o detector
-- de discordância para de reclamar delas por esse motivo, e só por ele.
alter table lab_strategies add column if not exists measured_elsewhere text;

-- ── 2. O VEREDITO DA RODADA ───────────────────────────────────────────────
-- A mesma lista, e isso não é simetria por estética: um veredito de rodada que
-- não cabe no estado da estratégia obrigaria uma tradução no meio do caminho,
-- e tradução é onde `source: "nft"` virou mentira em 11/08.
alter table lab_results drop constraint if exists lab_results_verdict_check;
alter table lab_results add constraint lab_results_verdict_check
  check (verdict is null or verdict in
    ('verde', 'cinza', 'morta', 'empate', 'inconclusiva', 'nao_mensuravel'));

comment on column lab_strategies.not_measurable_why is
  'Por que não dá para medir com fonte que alcançamos. Obrigatório quando status = nao_mensuravel.';
comment on column lab_strategies.measured_elsewhere is
  'Onde a medição vive, quando ela não vive no lab_runs. Ex.: "Fase 1, painel 🧭".';
