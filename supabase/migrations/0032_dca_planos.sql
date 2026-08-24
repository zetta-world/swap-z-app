-- ── O DCA AUTOMÁTICO ─────────────────────────────────────────────────
-- (docs/PLANO-DCA-AUTOMATICO.md — fase D2)
--
-- ⚠️ PRODUTO SEPARADO DO AUTOPILOT, por decisão do dono em 24/08:
-- "cada um é uma solução diferente". Referencia o COFRE, não a sessão de IA:
-- ter um plano de poupança não pode exigir ligar um robô de IA.

create table if not exists public.dca_planos (
  id                  uuid primary key default gen_random_uuid(),
  conexao_id          uuid not null references public.cex_conexoes(id) on delete cascade,
  wallet_address      text not null,
  exchange_id         text not null,
  symbol              text not null,

  orcamento_total_usd numeric not null check (orcamento_total_usd > 0),
  por_ciclo_usd       numeric not null check (por_ciclo_usd > 0),
  ciclos_total        int     not null check (ciclos_total between 1 and 365),
  intervalo           text    not null check (intervalo in ('hourly','daily','weekly','monthly')),

  -- ⚠️ O relógio. Avança do horário AGENDADO, nunca de now() — senão um plano
  -- diário anda alguns minutos por dia e em um mês está em outro horário.
  next_run_at         timestamptz not null,

  -- ⚠️ TRÊS CONTADORES, NÃO DOIS. `pulado` ≠ `feito` ≠ `falhou`: somar os três
  -- daria um plano "completo" que comprou metade. Mesma disciplina do
  -- `expired` ≠ win/loss no flywheel.
  ciclos_feitos       int not null default 0 check (ciclos_feitos  >= 0),
  ciclos_pulados      int not null default 0 check (ciclos_pulados >= 0),
  gasto_acumulado_usd numeric not null default 0 check (gasto_acumulado_usd >= 0),

  status              text not null default 'ativo'
                      check (status in ('ativo','pausado','completo','encerrado')),
  -- ⚠️ Distingue COMPLETO de MORTO. Um plano que parou porque a conexão
  -- expirou não é um plano que terminou, e o dono precisa ver a diferença.
  encerrado_por       text,

  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

-- A consulta que o cron faz a cada passada: planos ativos com janela vencida.
create index if not exists dca_planos_vencidos_idx
  on public.dca_planos (next_run_at) where status = 'ativo';
create index if not exists dca_planos_carteira_idx
  on public.dca_planos (wallet_address, status);

alter table public.dca_planos enable row level security;

-- ── os ciclos ────────────────────────────────────────────────────────
create table if not exists public.dca_ciclos (
  id            uuid primary key default gen_random_uuid(),
  plano_id      uuid not null references public.dca_planos(id) on delete cascade,
  ciclo_numero  int  not null check (ciclo_numero >= 1),

  status        text not null check (status in ('reservado','feito','pulado','falhou')),
  motivo        text,
  agendado_para timestamptz not null,
  executado_em  timestamptz,

  order_id      text,
  preco         numeric,
  quantidade    numeric,
  custo_usd     numeric,

  criado_em     timestamptz not null default now(),

  /**
   * ⚠️⚠️ ESTA LINHA É A GARANTIA CONTRA COMPRAR DUAS VEZES.
   *
   * O risco que mata este recurso não é o cron falhar — é disparar duas vezes.
   * O lock por sessão tem TTL: uma passada que trave, expire o lock e volte a
   * si compraria de novo. Lock é otimização; a garantia é do BANCO.
   *
   * E a ordem das operações é INEGOCIÁVEL:
   *   1. insert desta linha como `reservado` — conflito aqui significa que
   *      outra passada já pegou o ciclo, e ABORTA SEM COMPRAR
   *   2. só então coloca a ordem na corretora
   *   3. update com o resultado real
   *
   * Se o passo 3 falhar, a linha fica `reservado` com uma ordem que EXISTE.
   * É ruim, e é muito melhor que o inverso: o ciclo não repete, e um alerta
   * alto pede reconciliação humana. Na dúvida, falha para o lado que não gasta.
   */
  unique (plano_id, ciclo_numero)
);

create index if not exists dca_ciclos_plano_idx
  on public.dca_ciclos (plano_id, ciclo_numero desc);
-- Para o painel: o que foi executado hoje, por carteira (via join no plano).
create index if not exists dca_ciclos_executados_idx
  on public.dca_ciclos (executado_em desc) where status = 'feito';

alter table public.dca_ciclos enable row level security;
