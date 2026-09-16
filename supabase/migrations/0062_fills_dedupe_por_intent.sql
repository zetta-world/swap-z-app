-- ═══════════════════════════════════════════════════════════════════════
-- A123 (round 5) — DEDUPE DO LIVRO DE FILLS COM ESCOPO DE INTENT.
--
-- A trava da INVARIANTE 1 ("um fill único é contabilizado EXATAMENTE uma
-- vez", 0050) era `unique (exchange_id, dedupe_key)` — GLOBAL na corretora.
-- Global demais: dois intents nossos na MESMA corretora podem carregar o
-- mesmo id de trade (ids de trade não são universalmente únicos — venues
-- diferentes, símbolos diferentes, e mesmo a mesma venue pode repetir id
-- entre símbolos), e o segundo fill legítimo caía no `on conflict do
-- nothing` e SUMIA do livro: o intent B ficava sem o fato dele para sempre.
--
-- A identidade certa é (intent_id, dedupe_key): o dedupe existe para tornar
-- replay/reentrega no-op DENTRO da mesma execução — cruzar intents nunca
-- foi a propriedade desejada, era vazamento de escopo. Dois intents com o
-- mesmo trade_id agora persistem os DOIS fills; o replay no MESMO intent
-- continua no-op.
--
-- ⚠️ SEGURA COM DADOS, sem DELETE nem UPDATE de fills: a constraint nova é
-- ESTRITAMENTE MAIS FRACA que a antiga — intent_id determina exchange_id
-- (todo fill herda a corretora do intent), então qualquer par que violasse
-- (intent_id, dedupe_key) já violaria (exchange_id, dedupe_key), que valia
-- até aqui. O swap drop→add não pode falhar por duplicata herdada, e não
-- depende do livro estar vazio.
--
-- ⚠️ ORDEM COM A 0059: a `cex_ingest_trades`/`cex_ingest_order_snapshot`
-- corrigidas (round 5, na própria 0059) usam `on conflict (intent_id,
-- dedupe_key)` — PL/pgSQL planeja no primeiro uso, não no create, então a
-- função criada na 0059 só passa a exigir este índice quando executar, e a
-- esta altura a constraint abaixo já existe. A 0051 (aplicada, histórica)
-- tinha o texto antigo, mas é suplantada pelo create or replace da 0059.
--
-- A COBERTURA NÃO MUDA DE ESCOPO (§27): o dedupe persistente é por intent,
-- mas a COBERTURA synthetic→real segue por (intent_id, external_order_id
-- is not distinct from, incluindo null = não atribuído do R4) — são
-- propriedades diferentes e uma ordem continua sem cobrir outra.
--
-- Sem `security definer`, sem função, sem GRANT: uma constraint de tabela.
-- Sem ACL nova, portanto.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.cex_fills drop constraint cex_fills_dedupe;

alter table public.cex_fills
  add constraint cex_fills_intent_dedupe unique (intent_id, dedupe_key);

comment on constraint cex_fills_intent_dedupe on public.cex_fills is
  'A123 (round 5): dedupe do livro com escopo de INTENT — replay no mesmo '
  'intent e no-op, e dois intents podem carregar o mesmo trade_id sem que o '
  'segundo fill legitimo suma. Substitui a antiga cex_fills_dedupe '
  '(exchange_id, dedupe_key), global demais. Estritamente mais fraca: '
  'intent_id determina exchange_id, entao dados existentes nunca a violam.';
