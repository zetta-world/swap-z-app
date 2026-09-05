-- ── A DERRAPAGEM NÃO É ZERO, É DESCONHECIDA ─────────────────────────
--
-- ⚠️⚠️ CONSERTO DE UMA COLUNA QUE EU MESMO CRIEI ERRADA EM 0037 (05/09).
--
-- `bancada_resultado.derrapagem_pct` nasceu `not null`. Ao escrever o motor
-- (fase 2) ficou claro que isso obriga a gravar 0 — e 0 ali é uma afirmação
-- falsa: diz "medimos a derrapagem e ela não existiu".
--
-- Um backtest lê VELAS, e vela não tem livro de ofertas. A derrapagem do
-- instante em que aquela ordem teria sido enviada não foi medida por ninguém e
-- não é recuperável do histórico. O resultado é OTIMISTA por uma margem
-- desconhecida que CRESCE com o tamanho da ordem.
--
-- ⚠️ E É A MESMA FAMÍLIA DE DEFEITO QUE ESTA CASA JÁ PAGOU VÁRIAS VEZES:
-- `Number(null)` é 0 e passa em `isFinite`; um 429 virou "nenhuma pool
-- encontrada"; cinco linhas do admin saíram com cor de prejuízo para medição
-- que não existia. Ausência tem de continuar ausência até a borda da tela, onde
-- `corDoResultado(null)` a pinta de cinza.
--
-- A alternativa — somar um "buffer de derrapagem" chutado — trocaria um erro
-- MEDIDO por um palpite. `zion/custo.ts` já recusou esse caminho com todas as
-- letras, e a recusa vale igual aqui.
--
-- O nome do que falta vive em `bancada/veredito.ts` (`NAO_MEDIDO`) e vai para a
-- coluna `nao_medido`, que é jsonb e nunca fica vazia por acidente.

alter table public.bancada_resultado
  alter column derrapagem_pct drop not null;

comment on column public.bancada_resultado.derrapagem_pct is
  'NULO = nao medido, e nunca 0. Backtest le velas, e vela nao tem livro de ofertas. Ver NAO_MEDIDO em src/lib/bancada/veredito.ts.';
