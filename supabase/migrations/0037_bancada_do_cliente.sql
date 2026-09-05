-- ── A BANCADA DO CLIENTE — as primeiras tabelas COM DONO ────────────
--
-- Fase 1 de docs/PLANO-BANCADA-DO-CLIENTE.md.
--
-- Tudo que este banco guardava até aqui era NOSSO: velas, medições, agentes do
-- Celeiro, mesas do laboratório. A service key bastava porque não havia
-- ninguém de quem separar. Estas quatro linhas mudam isso: elas guardam a
-- estratégia que o CLIENTE escreveu e o resultado que ele mediu.
--
-- ══════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ POR QUE NÃO HÁ POLICY DE JWT AQUI — leia antes de "consertar".
-- ══════════════════════════════════════════════════════════════════════
--
-- O plano (§4.1) prometia "RLS de verdade, policy amarrando a carteira à
-- sessão". Ao ir escrever, a promessa não sobreviveu à arquitetura, e escrever
-- assim mesmo teria sido pior do que não escrever.
--
-- Uma policy `using (dono = auth.jwt() ->> 'sub')` precisa que o POSTGRES saiba
-- quem é o usuário. Aqui ele nunca sabe, por duas razões independentes:
--
--   1. A sessão desta casa NÃO é do Supabase Auth. É um JWT nosso (HS256,
--      `AUTH_JWT_SECRET`), verificado no Node, guardado em cookie httpOnly —
--      ver `src/lib/auth/session.ts`. Ele nunca chega ao Postgres, e o
--      `auth.jwt()` do banco devolveria NULL para toda linha.
--
--   2. Quem fala com o banco é `src/lib/supabase/server.ts`, com a SERVICE
--      KEY. Ela ignora RLS por definição. Mesmo que a policy existisse e
--      estivesse certa, ela não seria consultada em nenhuma leitura real.
--
-- Uma policy assim seria "uma trava que existe, parece certa, e está desligada
-- do caminho que decide" — a classe exata de defeito que esta base já pagou
-- caro seis vezes (ver docs/ESTADO-ATUAL.md §5). Ela daria a sensação de
-- isolamento sem isolar nada, e a próxima pessoa a auditar leria a policy e
-- pararia de procurar.
--
-- ⚠️ ENTÃO O ISOLAMENTO É REAL, SÓ QUE EM OUTRA CAMADA, e a camada está
-- declarada aqui para que ninguém precise adivinhar onde ela mora:
--
--   | camada                                   | o que ela impede                |
--   |------------------------------------------|---------------------------------|
--   | RLS ligada, ZERO policies                | o anon key (exposto no browser  |
--   |                                          | para o realtime) não lê nada    |
--   | `dono` é o 1º parâmetro OBRIGATÓRIO de   | esquecer o filtro vira erro de  |
--   | toda função de `lib/bancada/store.ts`     | tipo, não vazamento             |
--   | `Dono` é tipo MARCADO, construído só a    | o ataque real — o cliente       |
--   | partir da sessão verificada               | mandar `{dono:"0xoutra"}` no    |
--   |                                          | corpo — não compila             |
--   | teste com banco falso que grava os        | prova COMPORTAMENTO, não        |
--   | filtros aplicados                         | transcrição de código           |
--
-- O dia em que o cliente falar com o Supabase direto (anon key + Supabase
-- Auth), a policy passa a fazer sentido e entra numa migration própria. Hoje
-- ela seria enfeite.

-- ── A estratégia do cliente ─────────────────────────────────────────
--
-- ⚠️ PARÂMETROS, NUNCA CÓDIGO (§4.2). `params` é jsonb sobre um vocabulário
-- fechado validado em `lib/bancada/`. Cliente executando código no nosso
-- servidor é uma superfície de ataque que não vamos abrir.

create table if not exists public.bancada_estrategia (
  id uuid primary key default gen_random_uuid(),

  -- ⚠️ A CARTEIRA VERBATIM, como veio do `sub` da sessão verificada — do mesmo
  -- jeito que `operations.wallet_address` e `cex_conexoes` já guardam.
  --
  -- ⚠️ E NÃO EM MINÚSCULAS. `quotaBucket` faz `toLowerCase()` porque uma chave
  -- de contagem pode perder informação; uma coluna de DONO não pode. Endereço
  -- Solana é base58, ONDE MAIÚSCULA E MINÚSCULA SÃO CARACTERES DIFERENTES:
  -- baixar a caixa devolve uma string que não é mais um endereço válido, e
  -- duas carteiras distintas podem colidir na mesma chave.
  dono  text not null,
  chain text not null check (chain in ('evm','solana')),

  nome   text not null,
  params jsonb not null default '{}'::jsonb,

  -- Onde ela seria executada — decide o pedágio (`celeiro/taxas.ts`).
  praca text not null check (praca in ('spot_gate','futuros_gate','dex')),
  papel text not null check (papel in ('maker','taker')),

  -- ⚠️ ARQUIVAR, NÃO APAGAR. Uma rodada aponta para a estratégia que a gerou;
  -- deletar a estratégia transformaria um resultado medido em resultado órfão,
  -- e o cliente perderia o histórico do que ele mesmo testou.
  arquivada_em timestamptz,

  criada_em    timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);

-- A cota de "estratégias próprias salvas" (§6.2) conta por dono; este índice é
-- o que faz essa contagem ser barata.
create index if not exists bancada_estrategia_dono_idx
  on public.bancada_estrategia (dono, criada_em desc);

-- ── A rodada — com a janela DECLARADA ANTES ─────────────────────────
--
-- ⚠️⚠️ OS PARÂMETROS SÃO CONGELADOS NA LINHA, não referenciados.
--
-- É a mesma lição de `lab/store.ts:startRun`: se a rodada só apontasse para a
-- estratégia, editar a estratégia depois reescreveria o passado — o resultado
-- de ontem passaria a se descrever com os parâmetros de hoje. `params` aqui é
-- uma CÓPIA, e é ela que vale para sempre.

create table if not exists public.bancada_rodada (
  id uuid primary key default gen_random_uuid(),

  dono  text not null,
  chain text not null check (chain in ('evm','solana')),

  -- ⚠️ NULO É LEGÍTIMO: rodar uma estratégia DA CASA (§5, fase 5) não cria
  -- linha em `bancada_estrategia`. `estrategia_id` nulo + `origem` diz qual.
  estrategia_id uuid references public.bancada_estrategia(id) on delete set null,
  origem text not null default 'propria' check (origem in ('propria','casa')),

  capital_usd numeric not null check (capital_usd > 0),
  simbolos    text[]  not null,
  intervalo   text    not null,

  -- A janela, em unix ms, declarada ANTES de qualquer resultado existir.
  janela_de  bigint not null,
  janela_ate bigint not null,

  praca text not null check (praca in ('spot_gate','futuros_gate','dex')),
  papel text not null check (papel in ('maker','taker')),

  params jsonb not null default '{}'::jsonb,

  -- ⚠️ O CUSTO REAL DA RODADA É TRABALHO, NÃO CONTAGEM (§6.2). "Dez testes por
  -- dia" sozinho deixa um free pedir 3 símbolos × 1 ano dez vezes e consumir
  -- mais que um trader disciplinado. `símbolos × velas` é o que gasta CPU, e é
  -- o que a cota soma.
  custo_velas integer not null default 0 check (custo_velas >= 0),

  -- ⚠️ `recusada` É UM DESFECHO, não um erro. O portão do pedágio
  -- (`genomaAbre`) recusa uma configuração que nunca poderia abrir, e o cliente
  -- recebe o motivo NA HORA — foi assim que o Maker ficou dois dias sem operar
  -- sem ninguém notar.
  status text not null default 'rodando'
    check (status in ('rodando','concluida','recusada','falhou')),
  porque text,

  criada_em    timestamptz not null default now(),
  terminada_em timestamptz,

  constraint bancada_rodada_janela_coerente check (janela_ate > janela_de)
);

create index if not exists bancada_rodada_dono_idx
  on public.bancada_rodada (dono, criada_em desc);

-- ── O resultado — e o LÍQUIDO é o número do meio ────────────────────
--
-- ⚠️⚠️ TODO BACKTESTER DO MERCADO MOSTRA RETORNO BRUTO, e é por isso que todo
-- backtester do mercado mente. O Maker de Faixa acertou 70,4% em 23/08 e
-- PERDEU: entregou 121% do ganho de preço em taxa.
--
-- Por isso `bruto`, `taxa` e `derrapagem` são colunas separadas do `liquido`, e
-- não um número só já somado: o cliente precisa ver o pedágio como parcela.

create table if not exists public.bancada_resultado (
  rodada_id uuid primary key references public.bancada_rodada(id) on delete cascade,

  -- ⚠️ O dono repetido aqui NÃO é desnormalização preguiçosa: é o que permite
  -- toda leitura filtrar por dono SEM join. Um join esquecido é um vazamento;
  -- uma coluna ausente é erro de compilação.
  dono text not null,

  bruto_pct      numeric not null,
  taxa_pct       numeric not null,
  derrapagem_pct numeric not null,
  liquido_pct    numeric not null,

  n       integer not null check (n >= 0),
  acertos integer not null check (acertos >= 0),

  -- O que a aritmética exigia para empatar: 0,5 + custo/(2 × alvo).
  equilibrio_exigido_pct numeric,

  -- ⚠️ TRÊS ESTADOS, NÃO DOIS (`admin/cor-resultado.ts`): perdeu · ganhou ·
  -- ganhou mas perdeu do índice. E `ruido` quando a amostra não sustenta
  -- veredito nenhum — número pequeno não ganha cor (`admin/sample.ts`).
  veredito text not null
    check (veredito in ('perdeu','ganhou','ganhou_perdendo_do_indice','ruido')),

  -- ⚠️ O QUE NÃO FOI MEDIDO TEM NOME. Uma lista vazia significa "medimos tudo";
  -- ausência de item nunca deve ser lida como ausência de problema. É a quarta
  -- classe de `zion/descartadas.ts`: `nao_medido` ≠ zero.
  nao_medido jsonb not null default '[]'::jsonb,

  criado_em timestamptz not null default now()
);

create index if not exists bancada_resultado_dono_idx
  on public.bancada_resultado (dono, criado_em desc);

-- ── O papel adiante — a única peça com ESTADO ───────────────────────
--
-- ⚠️ É O ÚNICO CUSTO QUE RECORRE (§6.3), e por isso ele começa em `trader`, não
-- em `pro`: pôr o custo permanente no plano pago mais barato inverte a margem.
--
-- Backtest é o passado obedecendo; papel adiante é o presente discordando.

create table if not exists public.bancada_posicao (
  id uuid primary key default gen_random_uuid(),

  dono          text not null,
  estrategia_id uuid not null references public.bancada_estrategia(id) on delete cascade,

  simbolo text    not null,
  lado    text    not null check (lado in ('long','short')),
  entrada numeric not null check (entrada > 0),
  tamanho_usd numeric not null check (tamanho_usd > 0),

  alvo_pct  numeric,
  stop_pct  numeric,
  expira_em timestamptz,

  -- ⚠️ `expirada` NÃO É NEM GANHO NEM PERDA, e essa separação é cicatriz do
  -- flywheel: contá-la como derrota inflava o custo, como vitória inflava a
  -- borda. Ela é uma quarta coluna na contagem.
  status text not null default 'aberta'
    check (status in ('aberta','ganhou','perdeu','expirada')),

  saida       numeric,
  resultado_pct numeric,

  aberta_em  timestamptz not null default now(),
  fechada_em timestamptz
);

create index if not exists bancada_posicao_dono_idx
  on public.bancada_posicao (dono, aberta_em desc);
-- O cron do papel adiante varre as ABERTAS; sem este índice ele varreria o
-- histórico inteiro a cada 5 minutos.
create index if not exists bancada_posicao_abertas_idx
  on public.bancada_posicao (status, aberta_em) where status = 'aberta';

-- ── RLS ligada, zero policies — ver o bloco do topo ─────────────────
alter table public.bancada_estrategia enable row level security;
alter table public.bancada_rodada     enable row level security;
alter table public.bancada_resultado  enable row level security;
alter table public.bancada_posicao    enable row level security;

comment on table public.bancada_estrategia is
  'Estrategia do CLIENTE: parametros, nunca codigo. Isolamento por dono vive em src/lib/bancada/store.ts (tipo marcado Dono), nao em policy — ver o cabecalho da migration 0037.';
comment on table public.bancada_rodada is
  'Uma execucao da bancada. params sao CONGELADOS na linha: editar a estrategia depois nao pode reescrever o passado. custo_velas = simbolos x velas, a regua real da cota.';
comment on table public.bancada_resultado is
  'bruto/taxa/derrapagem/liquido em colunas SEPARADAS: todo backtester do mercado mostra bruto, e e por isso que todo backtester do mercado mente.';
comment on table public.bancada_posicao is
  'Papel adiante (trader+). expirada NAO e ganho nem perda — contabiliza-la como qualquer um dos dois distorce a borda medida.';
