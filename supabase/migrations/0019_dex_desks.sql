-- 0019: origem DEX para as mesas do Ragnarök (docs/PLANO-RAGNAROK.md, S3).
--
-- POR QUE ISTO EXISTE: até aqui TODA a camada de resolução era CEX-shaped —
-- `resolveOpenSuggestions` precifica por klines da Binance e o paper engine
-- preenche por `gateioSpot`, ambos indexados por SÍMBOLO. Um token que só
-- existe on-chain não tem par na Binance/Gate.io, então a sugestão nunca
-- preencheria nem resolveria: ficaria "open" para sempre, envenenando o ledger.
--
-- Não faltou vontade de testar DEX — faltava saber ONDE buscar o preço. Estas
-- colunas guardam exatamente isso: a chain e o pool de onde o candle vem
-- (GeckoTerminal OHLCV). Nulas = linha de CEX, que segue pelo caminho antigo.
alter table zion_suggestions add column if not exists chain        text;
alter table zion_suggestions add column if not exists pool_address text;

alter table paper_positions  add column if not exists chain        text;
alter table paper_positions  add column if not exists pool_address text;

-- O resolver varre linhas abertas e precisa separar as de pool rapidamente.
create index if not exists idx_zion_suggestions_pool
  on zion_suggestions (pool_address) where pool_address is not null;
create index if not exists idx_paper_positions_pool
  on paper_positions (pool_address) where pool_address is not null;
