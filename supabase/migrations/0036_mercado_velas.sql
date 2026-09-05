-- ── AS VELAS QUE SÓ SE BUSCA UMA VEZ ────────────────────────────────
--
-- Fase 0 da bancada do cliente (docs/PLANO-BANCADA-DO-CLIENTE.md §6.1).
--
-- ⚠️⚠️ POR QUE ESTA TABELA DECIDE O LUCRO DO PRODUTO.
--
-- Um backtest desta casa não custa token: `benchmarks.ts` e `regime.ts` são
-- puros. Ele custa CPU e VELA — e a vela era o problema.
--
-- Hoje as velas vivem só no cache de dados do Next (`revalidate: 3600`), cuja
-- chave inclui o `limit`. Dois clientes pedindo janelas diferentes do MESMO
-- símbolo erram o cache e fazem duas buscas. Com N clientes, N buscas para o
-- mesmo BTC — contra um limite por IP que os IPs de saída da Vercel dividem
-- com o resto do mundo.
--
-- ⚠️ E NÃO É HIPÓTESE: em 31/08 a medição de piscinas disparou ~200 requisições
-- em rajada e voltou com 56 de 62 leituras em 429. A rodada inteira não foi
-- evidência sobre nada.
--
-- Vela de período FECHADO nunca muda. Buscada uma vez, servida para sempre:
-- o milésimo backtest de BTC passa de mil buscas para ZERO.
--
--     10 símbolos × 730 dias = 7.300 linhas. O custo de armazenar isto é ruído.

create table if not exists public.mercado_vela (
  simbolo   text   not null,
  intervalo text   not null,
  -- ⚠️ O INSTANTE EM QUE A VELA ABRIU, unix ms. É a identidade dela na fonte,
  -- e é por ele que a chave primária dedupe: buscar a mesma faixa duas vezes
  -- não cria linha duplicada, faz UPSERT sobre a mesma.
  abriu_em  bigint not null,

  high   numeric not null,
  low    numeric not null,
  close  numeric not null,
  volume numeric not null,

  gravada_em timestamptz not null default now(),

  -- ⚠️ SÓ VELA FECHADA ENTRA AQUI. A guarda vive em `velaFechada()`, no código,
  -- porque ela depende do relógio — e um CHECK sobre `now()` não é imutável,
  -- então o Postgres o recusa em constraint. O teste que a prova está em
  -- `mercado/velas.test.ts`: "a vela de HOJE não fechou".
  primary key (simbolo, intervalo, abriu_em)
);

create index if not exists mercado_vela_serie_idx
  on public.mercado_vela (simbolo, intervalo, abriu_em desc);

-- ── O QUE JÁ FOI PERGUNTADO ─────────────────────────────────────────
--
-- ⚠️⚠️ COBERTURA É O QUE FOI PERGUNTADO, NÃO O QUE VEIO — e a distinção é o
-- que impede o custo de voltar pela porta dos fundos.
--
-- A tentação é deduzir buracos da ausência de vela: "não tenho a de 3 de março,
-- logo busco 3 de março". Isso re-busca PARA SEMPRE todo dia em que a fonte
-- genuinamente não tem vela — feriado, par recém-listado, hora sem negócio.
--
-- Guardando a FAIXA perguntada, uma vela ausente dentro dela é ausência
-- MEDIDA, e a gente para de perguntar.

create table if not exists public.mercado_cobertura (
  simbolo   text not null,
  intervalo text not null,

  -- A faixa de `abriu_em` já coberta por busca bem-sucedida.
  -- ⚠️ Ela anda até o que VEIO, nunca até o que foi pedido: `fetchTimedCandles`
  -- faz `break` no primeiro erro e devolve resposta parcial indistinguível de
  -- completa. Marcar como coberta uma faixa que não chegou criaria um buraco
  -- permanente. Ver `estenderCobertura()`.
  coberto_de  bigint not null,
  coberto_ate bigint not null,

  -- ⚠️ A FONTE NÃO TEM HISTÓRICO ANTES DE `coberto_de`.
  --
  -- Sem esta marca, todo backtest de um par listado há seis meses pediria dois
  -- anos, receberia seis meses, e tentaria de novo na próxima. Para sempre.
  --
  -- ⚠️ E ela é marcada SÓ quando a fonte avisa que acabou (devolveu menos do
  -- que cabia na página), nunca quando a busca falha. "Acabou" e "deu erro" são
  -- estados diferentes; confundi-los congela o histórico no ponto do erro.
  fonte_esgotou boolean not null default false,

  atualizada_em timestamptz not null default now(),

  primary key (simbolo, intervalo),
  constraint mercado_cobertura_faixa_coerente check (coberto_ate >= coberto_de)
);

-- ── RLS: default-deny, ZERO policies (o padrão desta casa) ──────────
--
-- ⚠️ ESTAS DUAS SÃO DADO DE MERCADO, NÃO DADO DE CLIENTE. Preço público de
-- BTC não tem dono. Quem lê e escreve é o servidor com a service key, que
-- ignora RLS; o anon key não alcança nada.
--
-- ⚠️ As tabelas da bancada (fase 1) são o OPOSTO: elas guardam a estratégia do
-- cliente e vão precisar de policy de verdade amarrando a carteira à sessão,
-- mais teste provando que a carteira A não lê a linha da B. Não confundir os
-- dois casos — é a diferença entre "interno" e "de alguém".
alter table public.mercado_vela      enable row level security;
alter table public.mercado_cobertura enable row level security;

comment on table public.mercado_vela is
  'Velas FECHADAS, buscadas uma vez e servidas para sempre. Vela do periodo corrente NAO entra: ela muda a cada negocio. Ver src/lib/mercado/velas.ts';
comment on table public.mercado_cobertura is
  'A faixa ja PERGUNTADA por (simbolo, intervalo). Vela ausente dentro da faixa e ausencia medida, nao buraco a rebuscar. fonte_esgotou impede a re-busca eterna de historico que nao existe.';
