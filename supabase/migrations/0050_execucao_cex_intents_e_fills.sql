-- ═══════════════════════════════════════════════════════════════════════
-- A CADEIA AUTORITATIVA DE EXECUÇÃO EM CORRETORA — FASE 1: o modelo
--
-- Achados A80, A108, A109 da auditoria independente.
--
-- ⚠️⚠️ O QUE NÃO EXISTIA. Hoje a aplicação chama `createOrder` e, se a resposta
-- se perder (timeout, ECONNRESET, crash, redeploy), NÃO HÁ ESTADO DURÁVEL que
-- distinga "a ordem não foi enviada" de "a ordem foi enviada e eu não vi a
-- resposta". O código do DCA chega a escrever essa dúvida por extenso e a
-- resolver no chute pessimista, porque não havia terceira opção:
--
--     "uma ordem a mercado que estourou por timeout pode ter sido aceita pela
--      corretora. Repetir arrisca comprar DUAS vezes; consumir o ciclo e seguir
--      arrisca comprar uma vez a menos."
--
-- Estas duas tabelas são a terceira opção: o intent durável ANTES do efeito
-- externo, e o livro de fills que diz o que de fato aconteceu.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ POR QUE DUAS TABELAS, E NÃO `operations`.
--
-- `operations` é visão de PRODUTO: uma linha por operação, escrita pelo
-- navegador, agregada em painel. Ela não pode ser o livro contábil — é
-- declarada pelo cliente (achado A07) e não tem granularidade de fill.
-- Ela continua existindo e continua sendo visão. O livro é `cex_fills`.
--
-- ⚠️ INVARIANTE CENTRAL: `cex_execution_intents.filled_qty` NUNCA é escrito
-- por quem chama. Ele é derivado da SOMA de `cex_fills` dentro da transação
-- que insere o fill (ver migration 0051). ACK de ordem não é fill (INVARIANTE
-- 2): um intent em SUBMITTED com `filled_qty = 0` é exatamente isso.
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. OS ESTADOS
--
-- ⚠️ `UNKNOWN` NÃO É `FAILED_PRE_SUBMIT`, e essa é a distinção que a tabela
-- existe para carregar (INVARIANTE 3).
--
--   FAILED_PRE_SUBMIT  nada saiu daqui. Provado: a exceção veio ANTES da
--                      chamada externa (validação, cofre, kill-switch).
--   UNKNOWN            a chamada externa começou e não terminou de forma
--                      legível. PODE ter executado. Só a reconciliação diz.
--
-- Converter UNKNOWN em FAILED para simplificar a UI é proibido pelo briefing
-- e é o defeito que este modelo existe para tornar impossível.
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'cex_intent_state') then
    create type public.cex_intent_state as enum (
      'CREATED',                 -- intent gravado, nada autorizado ainda
      'AUTHORIZED',              -- passou autorização/certificado/kill-switch
      'RESERVED',                -- orçamento/cota reservados
      'SUBMITTING',              -- ⚠️ gravado ANTES do side effect externo
      'SUBMITTED',               -- a corretora aceitou. ACK, não fill.
      'PARTIALLY_FILLED',
      'FILLED',
      'CANCEL_PENDING',
      'CANCELED',
      'UNKNOWN',                 -- ⚠️ pode ter executado. Não é falha.
      'RECONCILIATION_REQUIRED', -- divergência que precisa de leitura externa
      'QUARANTINED',             -- fail-closed: nada automático prossegue
      'FAILED_PRE_SUBMIT'        -- provadamente nada saiu
    );
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. O INTENT DURÁVEL
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.cex_execution_intents (
  id                     uuid primary key default gen_random_uuid(),

  -- ⚠️ A CHAVE DE IDEMPOTÊNCIA. Gerada por nós ANTES do envio e mandada à
  -- corretora como clientOrderId quando ela suportar. É o que permite
  -- perguntar "esta ordem já existe aí?" depois de um timeout.
  client_order_id        text        not null unique,

  -- quem pediu
  wallet_address         text,
  origin                 text        not null,
  autonomous             boolean     not null default false,

  -- elos com o resto do sistema (nulos quando não se aplicam)
  session_id             uuid,
  plan_id                uuid,
  cycle_number           integer,
  conexao_id             uuid,
  strategy_id            text,
  strategy_version       integer,
  certificate_id         uuid,

  -- o pedido
  exchange_id            text        not null,
  symbol                 text        not null,
  side                   text        not null check (side in ('buy','sell')),
  order_type             text        not null check (order_type in ('market','limit')),
  requested_qty          numeric     not null check (requested_qty > 0),
  limit_price            numeric              check (limit_price is null or limit_price > 0),
  requested_notional_usd numeric,
  simulated              boolean     not null default false,

  -- estado
  state                  public.cex_intent_state not null default 'CREATED',
  state_reason           text,
  external_order_id      text,

  -- ⚠️ DERIVADOS DO LIVRO. Nunca escritos por quem chama — ver 0051.
  filled_qty             numeric     not null default 0 check (filled_qty >= 0),
  filled_quote           numeric     not null default 0 check (filled_quote >= 0),
  fee_total              numeric,
  fee_currency           text,
  canceled_qty           numeric     not null default 0 check (canceled_qty >= 0),

  -- tempo
  created_at             timestamptz not null default now(),
  authorized_at          timestamptz,
  submitting_at          timestamptz,
  submitted_at           timestamptz,
  terminal_at            timestamptz,
  last_reconciled_at     timestamptz,
  reconcile_attempts     integer     not null default 0,
  updated_at             timestamptz not null default now(),

  -- ⚠️ NÃO SE EXECUTA MAIS DO QUE SE PEDIU. Se a corretora reportar mais que o
  -- pedido, isso é divergência para reconciliar, não número para gravar.
  constraint cex_intent_nao_excede_pedido
    check (filled_qty <= requested_qty + 1e-12),

  -- ⚠️ O QUE FOI EXECUTADO MAIS O QUE FOI CANCELADO NÃO PASSA DO PEDIDO.
  -- É isto que impede o desfecho do A100: 10 executados + 10 cancelados.
  constraint cex_intent_soma_nao_excede
    check (filled_qty + canceled_qty <= requested_qty + 1e-12),

  -- ⚠️ ESTADO PRÉ-ENVIO NÃO TEM EXECUÇÃO. `FAILED_PRE_SUBMIT` afirma que nada
  -- saiu; um fill contra ele seria a própria contradição que ele nega.
  constraint cex_intent_pre_submit_sem_fill
    check (state not in ('CREATED','AUTHORIZED','RESERVED','FAILED_PRE_SUBMIT')
           or filled_qty = 0),

  -- ⚠️ `FILLED` SIGNIFICA CHEIO. Sem isto, "FILLED com 0" volta a ser possível
  -- — que é o achado A81 no nível do banco.
  constraint cex_intent_filled_tem_fill
    check (state <> 'FILLED' or filled_qty > 0)
);

comment on table public.cex_execution_intents is
  'Intent de execucao em corretora, gravado ANTES do efeito externo. Achado A80.';
comment on column public.cex_execution_intents.filled_qty is
  'DERIVADO da soma de cex_fills pela RPC. Nunca escrever direto. Achados A81/A100.';
comment on column public.cex_execution_intents.state is
  'UNKNOWN != FAILED_PRE_SUBMIT. UNKNOWN pode ter executado. Achados A80/A104/A109.';

-- Recuperação no restart (INVARIANTE 7): os não-terminais, mais velhos primeiro.
create index if not exists idx_cex_intents_nao_terminais
  on public.cex_execution_intents (state, created_at)
  where state in ('SUBMITTING','SUBMITTED','PARTIALLY_FILLED','CANCEL_PENDING',
                  'UNKNOWN','RECONCILIATION_REQUIRED');

create index if not exists idx_cex_intents_por_ordem_externa
  on public.cex_execution_intents (exchange_id, external_order_id)
  where external_order_id is not null;

create index if not exists idx_cex_intents_por_plano
  on public.cex_execution_intents (plan_id, cycle_number)
  where plan_id is not null;

create index if not exists idx_cex_intents_por_sessao
  on public.cex_execution_intents (session_id, created_at)
  where session_id is not null;

-- ⚠️ UM INTENT VIVO POR CICLO DE DCA. A trava de `dca_ciclos (plano_id,
-- ciclo_numero)` protege o REGISTRO do ciclo; esta protege o ENVIO. Sem ela,
-- uma reconciliação concorrente poderia abrir um segundo intent para o mesmo
-- ciclo e o par "reserva + envio" deixaria de ser um par.
create unique index if not exists idx_cex_intent_um_vivo_por_ciclo
  on public.cex_execution_intents (plan_id, cycle_number)
  where plan_id is not null
    and state not in ('CANCELED','FAILED_PRE_SUBMIT');

-- ─────────────────────────────────────────────────────────────────────────
-- 3. O LIVRO DE FILLS — append-only
--
-- ⚠️ INVARIANTE 1: um fill único é contabilizado EXATAMENTE uma vez. A trava é
-- `unique (exchange_id, dedupe_key)`, no banco, não em código.
--
-- ⚠️ DOIS MODOS DE INGESTÃO, e a diferença importa:
--
--   trade-level   a corretora deu um id de trade. `dedupe_key = 'trade:<id>'`.
--                 É identidade de verdade.
--
--   order-level   a corretora só deu o ACUMULADO da ordem. Não há identidade
--                 de trade, então gravamos o DELTA contra o que o livro já
--                 tem, com `dedupe_key = 'ordercum:<ordem>:<acumulado>'`.
--                 Reaplicar o mesmo acumulado dá conflito e não soma nada.
--                 Estas linhas nascem `sintetico = true`.
--
-- ⚠️ E O SINTÉTICO CEDE LUGAR AO REAL. Quando os trades de verdade aparecem
-- para a mesma ordem, a RPC APAGA os sintéticos daquela ordem na MESMA
-- transação antes de inserir os reais — senão o mesmo volume entraria duas
-- vezes, por dois caminhos diferentes, que é a forma mais cara de quebrar a
-- INVARIANTE 1. É a única exclusão permitida neste livro, e ela é append-only
-- do ponto de vista do que é FATO: sintético é estimativa, não fato.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.cex_fills (
  id                 uuid        primary key default gen_random_uuid(),
  intent_id          uuid        not null
                       references public.cex_execution_intents(id) on delete restrict,
  exchange_id        text        not null,
  external_order_id  text,
  external_trade_id  text,
  client_order_id    text,
  symbol             text        not null,
  side               text        not null check (side in ('buy','sell')),

  qty                numeric     not null check (qty > 0),
  price              numeric     not null check (price > 0),
  quote_amount       numeric     not null check (quote_amount >= 0),
  fee                numeric              check (fee is null or fee >= 0),
  fee_currency       text,

  executed_at        timestamptz,
  -- ⚠️ `sintetico` marca a linha derivada de acumulado, sem id de trade.
  sintetico          boolean     not null default false,
  dedupe_key         text        not null,
  raw_hash           text,
  created_at         timestamptz not null default now(),

  constraint cex_fills_dedupe unique (exchange_id, dedupe_key)
);

comment on table public.cex_fills is
  'Livro append-only de execucoes. Um fill = uma linha, deduplicado no banco. Achado A108.';
comment on column public.cex_fills.sintetico is
  'Linha derivada do acumulado da ordem, sem id de trade. Cede lugar ao trade real.';

create index if not exists idx_cex_fills_por_intent
  on public.cex_fills (intent_id, created_at);

create index if not exists idx_cex_fills_por_ordem
  on public.cex_fills (exchange_id, external_order_id)
  where external_order_id is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. RLS LIGADA, ZERO POLÍTICAS — o padrão da casa
--
-- ⚠️⚠️ A GUARDA DO REPOSITÓRIO PEGOU ESTA FALTA, e ela é real: sem RLS, a chave
-- ANÔNIMA — a que vai no navegador — lê estas duas tabelas inteiras. O livro de
-- execuções contém símbolo, quantidade, preço e carteira de todo mundo.
--
-- ⚠️ ZERO POLÍTICAS É DE PROPÓSITO, não esquecimento: RLS habilitada sem
-- política nenhuma nega TUDO por padrão. O acesso legítimo é exclusivamente
-- server-side pela service key, que ignora RLS. Uma política "só o dono lê"
-- pareceria mais generosa e seria mais frágil.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.cex_execution_intents enable row level security;
alter table public.cex_fills             enable row level security;
