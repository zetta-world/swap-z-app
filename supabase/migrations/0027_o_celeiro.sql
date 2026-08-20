-- O CELEIRO — a segunda arena. Ver docs/PLANO-O-CELEIRO.md.
--
-- ⚠️ POR QUE TABELAS NOVAS E NÃO REUSO DAS ANTIGAS.
--
-- `zion_suggestions` e `paper_positions` foram desenhadas para uma pergunta
-- diferente: "a mesa acertou a direção?". O Celeiro pergunta "quantos USDT
-- entraram, e de ONDE". São esquemas para perguntas distintas, e forçar um no
-- outro faria o novo herdar a régua do velho — que é exatamente o que a
-- auditoria de 19/08 mandou não fazer.
--
-- Nada aqui referencia as tabelas antigas. As duas arenas não se cruzam.

-- ─────────────────────────────────────────────────────────────────────────────
-- ① O EXTRATO — o coração do Celeiro.
--
-- ⚠️⚠️ ESTA TABELA EXISTE POR CAUSA DE UMA MEDIÇÃO. Em 19/08 mediu-se que
-- mesas com 70,2% e 60,0% de acerto PERDIAM dinheiro (−0,401% e −0,291%
-- líquidos). O placar antigo não conseguia explicar isso porque guardava o
-- RESULTADO, nunca as PARTES.
--
-- Aqui todo movimento de USDT carrega a sua CAUSA. "Perdi 4 USDT" é narrativa;
-- "paguei 3,10 de taxa, 0,70 de derrapagem, recebi 1,20 de funding e o preço
-- levou 2,40" é diagnóstico. Sem esta decomposição o Investigador (§5 do plano)
-- não teria sobre o que raciocinar, e viraria mais um gerador de palpite.
create table if not exists public.celeiro_fluxos (
  id            uuid primary key default gen_random_uuid(),
  agente        text        not null,
  ocorreu_em    timestamptz not null default now(),

  -- ⚠️ A LISTA É FECHADA DE PROPÓSITO. Uma causa "outros" viraria o ralo onde
  -- todo vazamento não explicado se esconde, e a decomposição perderia o
  -- sentido. Causa nova exige migração — ou seja, exige alguém decidir.
  causa         text        not null check (causa in (
                  'taxa',        -- corretagem paga
                  'derrapagem',  -- diferença entre o preço cotado e o obtido
                  'funding',     -- fluxo do perpétuo (pode ser + ou −)
                  'preco',       -- movimento de mercado da posição
                  'aluguel',     -- juro recebido por USDT emprestado
                  'aporte'       -- capital entrando/saindo, não é resultado
                )),

  -- Assinado: negativo é saída. Somar esta coluna por agente dá o USDT dele.
  usdt          numeric     not null,

  simbolo       text,
  -- Liga o fluxo à operação que o gerou, para auditoria linha a linha.
  ref           text,

  -- ⚠️ QUAL GENOMA ESTAVA VIVO. Sem isto não dá para dizer se a mutação pagou:
  -- o fluxo ficaria órfão da versão de parâmetros que o produziu.
  genoma_versao integer,

  -- ⚠️ O BRAÇO DO A/B. `controle` = metade do capital sem a mutação;
  -- `mutacao` = metade com. Comparar os dois é como o Investigador é pontuado.
  braco         text        check (braco in ('controle','mutacao')),

  meta          jsonb       not null default '{}'::jsonb
);

create index if not exists celeiro_fluxos_agente_idx on public.celeiro_fluxos (agente, ocorreu_em desc);
create index if not exists celeiro_fluxos_causa_idx  on public.celeiro_fluxos (agente, causa);

-- ─────────────────────────────────────────────────────────────────────────────
-- ② O GENOMA — aprendizado que dá para auditar e reverter.
--
-- ⚠️ POR QUE NÃO "LIÇÕES EM TEXTO". A arena antiga guarda reflexão em prosa e
-- injeta no prompt (`agent_lessons`). Isso não é auditável, não é reversível, e
-- não permite dizer se ajudou — em 18 lições nenhuma tem resultado medido.
--
-- Aqui aprender é MUDAR UM PARÂMETRO, versionado, com autor e hipótese. Se não
-- pagou, reverte-se para a versão anterior e o par (hipótese, resultado) fica.
create table if not exists public.celeiro_genoma (
  id          uuid primary key default gen_random_uuid(),
  agente      text        not null,
  versao      integer     not null,
  params      jsonb       not null,

  -- Quem propôs. 'nascimento' na v1; senão o id do modelo que sugeriu.
  autor       text        not null,
  -- A frase falsificável que justificou a mudança. Obrigatória a partir da v2.
  hipotese    text,

  criado_em   timestamptz not null default now(),
  -- Apenas UMA versão ativa por agente (garantido pelo índice parcial abaixo).
  ativo       boolean     not null default false,

  unique (agente, versao)
);

create unique index if not exists celeiro_genoma_um_ativo
  on public.celeiro_genoma (agente) where ativo;

-- ─────────────────────────────────────────────────────────────────────────────
-- ③ AS MUTAÇÕES — o placar do Investigador.
--
-- ⚠️ `esperado` É PREENCHIDO ANTES DE APLICAR, e é o que separa hipótese de
-- narrativa. Sem ele, qualquer resultado vira "era o que eu previa" na leitura
-- seguinte — que é como a arena antiga produziu 18 lições e zero evidência.
create table if not exists public.celeiro_mutacoes (
  id            uuid primary key default gen_random_uuid(),
  agente        text        not null,
  modelo        text        not null,   -- qual IA propôs (nunca Anthropic)

  hipotese      text        not null,   -- por que o USDT vazou
  diff          jsonb       not null,   -- a mudança proposta no genoma
  esperado      text        not null,   -- o resultado previsto, ANTES

  proposta_em   timestamptz not null default now(),
  aplicada_em   timestamptz,
  avaliada_em   timestamptz,

  -- O julgamento: USDT de cada braço na janela de avaliação.
  usdt_controle numeric,
  usdt_mutacao  numeric,
  -- ⚠️ 'inconclusiva' É UM VEREDITO DE PRIMEIRA CLASSE. Sem ela, amostra
  -- pequena seria empurrada para 'pagou' ou 'nao_pagou' e viraria evidência
  -- falsa — é o `inconclusivo ≠ aprovado` da casa, aplicado à mutação.
  veredito      text        check (veredito in ('pagou','nao_pagou','inconclusiva')),
  revertida_em  timestamptz
);

create index if not exists celeiro_mutacoes_agente_idx on public.celeiro_mutacoes (agente, proposta_em desc);
create index if not exists celeiro_mutacoes_modelo_idx on public.celeiro_mutacoes (modelo, veredito);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: habilitada, ZERO políticas — o padrão da casa. Todo acesso passa pelo
-- service role no servidor; nenhum cliente lê estas tabelas diretamente.
alter table public.celeiro_fluxos   enable row level security;
alter table public.celeiro_genoma   enable row level security;
alter table public.celeiro_mutacoes enable row level security;
