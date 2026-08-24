-- EINHERJAR — a caixa entre o dono e os agentes.
-- (docs/PLANO-EINHERJAR.md)
--
-- ⚠️ POR QUE TABELA E NÃO `platform_events`.
--
-- O `platform_events` é append-only e serve para isso: um evento aconteceu e
-- fica. Uma CAIXA DE ENTRADA precisa de estado que MUDA — foi lida, foi
-- respondida — e modelar mudança de estado com eventos exigiria reconstruir a
-- verdade a cada leitura, ou gravar um evento de "li" e outro de "respondi"
-- que ninguém garante que casam.
--
-- ⚠️ E O ESTADO DE LEITURA É O PONTO DA TELA. "Perguntado há 12 min, AINDA NÃO
-- LIDO" é a diferença entre "o agente não respondeu" e "o agente nem viu" —
-- sem isso o dono fica esperando alguém que não sabe que foi chamado.

create table if not exists public.einherjar_mensagens (
  id            uuid        primary key default gen_random_uuid(),

  -- Quem falou e com quem. Texto livre de propósito: os nomes das sessões
  -- mudam (uma sessão nova tem outro id), e uma FK para uma tabela de agentes
  -- faria a caixa recusar mensagem de um agente que ainda não se registrou.
  de            text        not null,
  para          text        not null,

  assunto       text        not null,
  corpo         text        not null,

  criado_em     timestamptz not null default now(),

  -- ⚠️ NULL = nem viu. Não é o mesmo que "viu e não respondeu", e a tela
  -- mostra os dois estados diferentes.
  lido_em       timestamptz,

  resposta      text,
  respondido_em timestamptz
);

-- A consulta que a tela faz: as não lidas de um destinatário, mais recentes
-- primeiro. E a listagem geral por data.
create index if not exists einherjar_nao_lidas_idx
  on public.einherjar_mensagens (para, criado_em desc) where lido_em is null;
create index if not exists einherjar_recentes_idx
  on public.einherjar_mensagens (criado_em desc);

-- RLS habilitada, ZERO políticas — o padrão da casa. O acesso é só pela
-- service key, e a rota que a usa passa por `requireAdmin`.
alter table public.einherjar_mensagens enable row level security;
