-- ── QUAL PISCINA O TERMINAL DEVE MOSTRAR ─────────────────────────────
--
-- ⚠️ POR QUE ESTAS TABELAS (31/08).
--
-- `PRO_PAIRS` aponta `bnb-usdt` para a PancakeSwap V3 0,05%. Ninguém escolheu
-- isso: os endereços foram escritos à mão quando o terminal nasceu e nunca
-- foram medidos contra alternativa nenhuma. O dono abriu o gráfico de 1 minuto
-- e disse "o gráfico nem se mexe" — e estava certo.
--
-- ⚠️ E A MEDIÇÃO NÃO RODA NESTA MÁQUINA. O contêiner desta sessão não alcança a
-- api.geckoterminal.com; a Vercel alcança. Então quem mede é uma rota do admin,
-- disparada por um botão, e o resultado desce para cá — porque medição que
-- vive só na tela de quem clicou não é medição, é impressão.
--
-- ⚠️ DUAS TABELAS, E A SEGUNDA NÃO É REDUNDÂNCIA. `pro_piscina_medicao` guarda
-- o que foi LIDO de cada piscina; `pro_piscina_veredito` guarda o que foi
-- CONCLUÍDO sobre o par. Fundir as duas obrigaria a reconstituir o julgamento
-- por consulta, e o critério de julgamento muda com o código — a mesma razão
-- pela qual `lab_runs` é separada de `lab_results`.

-- ── O QUE FOI LIDO DE CADA PISCINA ───────────────────────────────────
create table if not exists public.pro_piscina_medicao (
  id             uuid primary key default gen_random_uuid(),
  -- Agrupa um clique no botão. Sem isto, duas rodadas viram uma amostra só.
  rodada         uuid        not null,
  medida_em      timestamptz not null default now(),
  par            text        not null,
  rede           text        not null,
  piscina        text        not null,
  rotulo         text        not null,
  -- É o endereço que o /pro usa hoje. Sem esta coluna, saber contra o que a
  -- alternativa está sendo comparada exigiria consultar o código daquele dia.
  atual          boolean     not null default false,
  janela_min     int         not null,

  -- ⚠️ TUDO ABAIXO É NULLABLE, e a distinção é o ponto inteiro desta tabela.
  -- NULL = a GeckoTerminal recusou (ver `porque_nao_leu`). 0 = ela respondeu e
  -- o valor era zero. Um default de 0 apagaria a diferença entre "não medimos
  -- esta piscina" e "esta piscina está morta" — a primeira é uma lacuna, a
  -- segunda é uma condenação, e foi exatamente esse par de estados que fez
  -- /pools?chain=polygon anunciar "nenhuma pool" durante um 429.
  velas_lidas          int,
  velas_paradas        int,     -- high == low: houve trade, a um preço só
  minutos_com_vela     int,
  cobertura_pct        numeric, -- minutos com vela / janela — a queixa, medida
  amplitude_media_pct  numeric,
  atraso_min           numeric, -- minutos desde a vela mais recente
  tvl_usd              numeric,
  volume24h_usd        numeric,
  trocas24h            int,
  preco_usd            numeric,

  -- NULL quando leu. Texto quando não leu — nunca vazio-em-silêncio.
  porque_nao_leu text,

  -- Uma leitura por piscina por rodada: a mesma piscina medida duas vezes no
  -- mesmo clique seria a mesma evidência contada em dobro.
  constraint pro_piscina_uma_por_rodada unique (rodada, piscina)
);

create index if not exists pro_piscina_medicao_par_idx
  on public.pro_piscina_medicao (par, medida_em desc);
create index if not exists pro_piscina_medicao_rodada_idx
  on public.pro_piscina_medicao (rodada);

-- ── O QUE FOI CONCLUÍDO SOBRE O PAR ──────────────────────────────────
create table if not exists public.pro_piscina_veredito (
  id            uuid primary key default gen_random_uuid(),
  rodada        uuid        not null,
  julgado_em    timestamptz not null default now(),
  par           text        not null,
  rede          text        not null,

  -- ⚠️ DUAS COLUNAS DE VENCEDOR, DE PROPÓSITO. Cobertura de vela e TVL são
  -- réguas diferentes e podem apontar para piscinas diferentes: uma V3
  -- concentrada dá gráfico vivo com menos TVL; uma V2 gorda dá execução melhor
  -- com gráfico picotado. Uma coluna só de "vencedor" exigiria compor as duas
  -- num score, e o score esconderia justamente a informação que decide.
  melhor_para_o_grafico text,
  maior_liquidez        text,
  atual                 text,

  -- atual_e_a_melhor | trocar | conflito | inconclusiva
  veredito      text not null,
  porque        text not null,
  lidas         int  not null,
  candidatas    int  not null,

  constraint pro_piscina_um_veredito_por_rodada unique (rodada, par)
);

create index if not exists pro_piscina_veredito_par_idx
  on public.pro_piscina_veredito (par, julgado_em desc);

-- ── RLS: default-deny, ZERO policies (o padrão desta casa) ───────────
-- Habilitada sem nenhuma policy: o anon key não lê nada, e a service key
-- ignora RLS. Quem escreve e lê aqui é a rota do admin, server-side.
alter table public.pro_piscina_medicao  enable row level security;
alter table public.pro_piscina_veredito enable row level security;

comment on table public.pro_piscina_medicao is
  'Leitura crua de cada piscina candidata do /pro. NULL = fonte recusou (ver porque_nao_leu); 0 = fonte respondeu zero. Ver src/lib/pro/escolha-da-piscina.ts';
comment on table public.pro_piscina_veredito is
  'Julgamento por par. melhor_para_o_grafico e maior_liquidez sao reguas distintas — quando discordam o veredito e conflito e nada e escolhido.';
