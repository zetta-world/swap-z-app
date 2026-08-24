-- A POSIÇÃO DO CELEIRO — o que faltava para os agentes OPERAREM.
--
-- ⚠️⚠️ POR QUE ESTA TABELA NASCEU DEPOIS (21/08). Os agentes de estrutura e
-- evento tinham `decidir()`, `deveCotar()` e `portaoDeSobrevivencia()` — o
-- "devo?" — e nada mais. Nenhum tinha onde GUARDAR uma posição, então nenhum
-- podia abrir uma. Eram cabeça sem mão: código que julga e não opera.
--
-- ⚠️ E POR QUE NÃO REUSAR `paper_positions`. Aquela tabela foi desenhada para a
-- arena antiga, cujo placar é acerto de direção; o Celeiro mede USDT por causa.
-- Reusá-la traria junto a régua velha e cruzaria as duas arenas num join
-- distraído — que é exatamente o que o plano proibiu.
create table if not exists public.celeiro_posicoes (
  id             uuid primary key default gen_random_uuid(),
  agente         text        not null,
  simbolo        text        not null,
  lado           text        not null check (lado in ('buy','sell')),

  -- O nocional que PASSOU pelo portão de profundidade, não o desejado.
  usd            numeric     not null check (usd > 0),
  preco_entrada  numeric     not null check (preco_entrada > 0),
  alvo           numeric     not null,
  stop           numeric     not null,

  -- ⚠️ Sem limite de tempo, uma posição que nunca toca alvo nem stop fica aberta
  -- para sempre e o capital do agente some do experimento sem aparecer como
  -- perda. Fechar por tempo é caro; ficar preso é pior.
  horas_limite   integer     not null default 8,

  -- Guardada na posição para o extrato poder ser auditado linha a linha.
  derrapagem_pct numeric     not null default 0,

  aberta_em      timestamptz not null default now(),
  fechada_em     timestamptz,
  preco_saida    numeric,
  motivo_saida   text check (motivo_saida in ('alvo','stop','tempo')),

  genoma_versao  integer,
  braco          text check (braco in ('controle','mutacao')),
  meta           jsonb       not null default '{}'::jsonb
);

create index if not exists celeiro_posicoes_abertas_idx
  on public.celeiro_posicoes (agente) where fechada_em is null;
create index if not exists celeiro_posicoes_agente_idx
  on public.celeiro_posicoes (agente, aberta_em desc);

-- RLS habilitada, ZERO políticas — o padrão da casa.
alter table public.celeiro_posicoes enable row level security;
