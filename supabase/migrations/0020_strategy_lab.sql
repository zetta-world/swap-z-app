-- ═══════════════════════════════════════════════════════════════════════════
-- LABORATÓRIO DE ESTRATÉGIAS — cada dado no seu lugar, sem mistura.
--
-- ⚠️ POR QUE ISTO EXISTE (05/08).
--
-- Todas as medições novas — censo de profundidade, perp, maker, funding,
-- what-worked, venue-truth — gravavam em `platform_events.metadata`, jsonb
-- solto. Funcionou para medição pontual e NÃO serve para o que vem:
--
--   · não dá para consultar "todas as rodadas da estratégia X em 3 meses" sem
--     varrer jsonb de uma tabela que também guarda page_view e alerta;
--   · não há vínculo entre ESTRATÉGIA → CAPITAL USADO → JANELA → RESULTADO,
--     e sem ele duas medições não são comparáveis;
--   · a auditoria de 05/08 mostrou o custo disso: o painel exibia PATRIMÔNIO
--     de $20.842 onde o caixa real somava $11.491, porque cada tela calculava
--     o seu número a partir de uma fonte diferente.
--
-- O dono, duas vezes: "todo dado gerado tem que ficar quadrado em nosso banco
-- de dados" e "cada dado quadradinho no banco, sem mistura".
--
-- ─────────────────────────────────────────────────────────────────────────
-- O DESENHO: três tabelas, uma pergunta cada.
--
--   lab_strategies  QUEM é a estratégia, quanto capital ela EXIGE e por quê
--   lab_runs        UMA execução: quando, com que capital, que janela, e se
--                   terminou ou morreu (com o motivo)
--   lab_results     O que a execução PRODUZIU, por símbolo e no agregado
--
-- A separação entre `runs` e `results` não é normalização por esporte: é o que
-- permite gravar uma rodada que FALHOU. Numa tabela só, execução sem resultado
-- não teria onde existir — e "rodou e deu erro" voltaria a ser idêntico a
-- "nunca clicou", que é o defeito que esta semana achou seis vezes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. O REGISTRO DAS ESTRATÉGIAS ─────────────────────────────────────────
create table if not exists lab_strategies (
  id            uuid primary key default gen_random_uuid(),
  -- Chave estável usada no código. Nunca muda: é referência de dados.
  slug          text not null unique,
  name          text not null,
  -- O subtítulo funcional. Nome de guerra sozinho não comunica — decisão do
  -- dono em 05/08, depois de olhar o painel com olhos de leigo.
  subtitle      text not null,
  -- carrego | direcional | estrutura | liquidez | primario | negocio
  family        text not null,

  -- ⚠️ O CAMPO QUE MOTIVOU A TABELA. As 23 mesas antigas recebiam $1.000
  -- independentemente do que a estratégia exige, e mesa sub-capitalizada não
  -- rende menos: rende NEGATIVO por custo fixo. O `why` é obrigatório junto —
  -- número de capital sem justificativa vira constante que ninguém confere.
  capital_required_usd numeric not null check (capital_required_usd > 0),
  capital_why   text not null check (length(capital_why) >= 25),

  -- verde  = medida por nós, positiva
  -- cinza  = NÃO medida — não é aprovação nem reprovação
  -- morta  = medida por nós, negativa
  status        text not null default 'cinza'
                check (status in ('verde', 'cinza', 'morta')),
  -- A hipótese ANTES do dado. Registrada para poder estar errada em público —
  -- é a defesa contra racionalizar o resultado depois que ele aparece.
  hypothesis    text,
  -- Por que foi morta, quando for. Reprovar sem motivo escrito é esquecer.
  killed_why    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── 2. AS EXECUÇÕES ───────────────────────────────────────────────────────
create table if not exists lab_runs (
  id            uuid primary key default gen_random_uuid(),
  strategy_id   uuid not null references lab_strategies(id) on delete cascade,

  -- ⚠️ O CAPITAL DESTA RODADA, gravado no momento. Não é lookup na estratégia:
  -- se o capital exigido mudar amanhã, as rodadas antigas têm que continuar
  -- dizendo com quanto foram feitas. Resultado sem o capital que o produziu
  -- não é comparável com nada.
  capital_usd   numeric not null check (capital_usd > 0),
  -- A janela medida, em dias, e onde ela termina. `window_end` permite medir
  -- períodos passados sem confundir com "hoje".
  window_days   int not null check (window_days > 0),
  window_end    timestamptz not null default now(),
  -- Os parâmetros exatos. Rodada sem parâmetro não é reproduzível.
  params        jsonb not null default '{}'::jsonb,

  -- ok       = terminou e produziu resultado
  -- falhou   = morreu no caminho; `failure_reason` diz onde
  -- rodando  = começou e ainda não voltou
  status        text not null default 'rodando'
                check (status in ('ok', 'falhou', 'rodando')),
  failure_reason text,
  -- Detalhe acionável da falha: status HTTP por fonte, contagem por símbolo.
  -- "Falhou" sem isto é o mesmo que não gravar — foi o que aconteceu com a
  -- primeira rodada do funding, que voltou "nenhum símbolo retornou" e levou
  -- outra rodada inteira só para descobrir que era 451 e 403.
  failure_detail text,

  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  took_ms       int
);
create index if not exists idx_lab_runs_strategy on lab_runs (strategy_id, started_at desc);
create index if not exists idx_lab_runs_status on lab_runs (status) where status <> 'ok';

-- ── 3. OS RESULTADOS ──────────────────────────────────────────────────────
create table if not exists lab_results (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references lab_runs(id) on delete cascade,

  -- ⚠️ O LÍQUIDO DA JANELA e o LÍQUIDO ANUALIZADO viajam juntos, e a razão é
  -- cicatriz de 04/08: o líquido da janela compara um ganho ACUMULADO com um
  -- custo pago UMA VEZ. Numa janela de 30 dias isso cospe "não paga" quando o
  -- que realmente diz é "trinta dias não pagam a entrada". Guardar só um dos
  -- dois obriga o leitor a saber qual — e ele não sabe.
  net_pct               numeric,
  net_annualized_pct    numeric,
  gross_pct             numeric,
  cost_pct              numeric,

  -- ⚠️ AMOSTRA É COLUNA DE PRIMEIRA CLASSE, não metadado. A regra da casa é
  -- que amostra abaixo do limiar NUNCA vira número, e ela só pode ser aplicada
  -- se o `n` estiver ao lado do resultado em toda consulta.
  sample_n              int not null default 0,
  -- Quantas observações INDEPENDENTES existem de verdade. Com correlação de
  -- 0,78 entre símbolos, dez viram 1,2 — e todo intervalo de confiança
  -- calculado sobre `sample_n` fica estreito demais.
  effective_n           numeric,
  correlation_rho       numeric,

  max_drawdown_pct      numeric,
  win_rate_pct          numeric,
  trades                int,
  exposure_pct          numeric,

  -- O que a estratégia rendeu contra COMPRAR-E-SEGURAR na MESMA janela.
  -- Toda mesa é julgada contra isso — sem o denominador, "+18%" não diz se foi
  -- a estratégia ou o mercado.
  benchmark_pct         numeric,

  -- verde | cinza | morta, e a frase que explica. O veredito é gravado junto
  -- do número para que a leitura não dependa de quem está olhando.
  verdict               text check (verdict in ('verde', 'cinza', 'morta')),
  verdict_text          text,

  -- ⚠️ O POR-SÍMBOLO. Agregado sem parcela não é auditável: a discordância de
  -- onze pontos entre duas rotas levou uma hora para ser isolada porque só a
  -- mediana estava gravada, e "a janela é outra" / "a conta é outra" /
  -- "os símbolos são outros" ficavam indistinguíveis.
  per_symbol            jsonb not null default '[]'::jsonb,
  -- O que esta medição NÃO inclui. Omissão que só vive no comentário vira,
  -- semanas depois, um número que alguém leu como completo.
  not_measured          text[] not null default '{}',

  created_at            timestamptz not null default now()
);
create index if not exists idx_lab_results_run on lab_results (run_id);

-- ── 4. O HISTÓRICO DE CAPITAL ─────────────────────────────────────────────
-- Mudar o capital de uma mesa muda o resultado dela. Sem histórico, uma
-- comparação entre duas épocas mede a mudança de capital achando que mede a
-- estratégia — que é exatamente o erro das janelas de 260 e 174 dias.
create table if not exists lab_capital_log (
  id            uuid primary key default gen_random_uuid(),
  strategy_id   uuid not null references lab_strategies(id) on delete cascade,
  from_usd      numeric,
  to_usd        numeric not null check (to_usd > 0),
  reason        text not null check (length(reason) >= 15),
  changed_at    timestamptz not null default now()
);
create index if not exists idx_lab_capital_strategy on lab_capital_log (strategy_id, changed_at desc);

-- ── RLS: default-deny, ZERO policies de propósito ─────────────────────────
-- Padrão da casa (ver as migrações anteriores): habilitada e sem policy
-- nenhuma. O acesso é exclusivamente server-side, pela service key, atrás de
-- `requireAdmin`. Uma policy aqui seria uma porta que ninguém pediu.
alter table lab_strategies   enable row level security;
alter table lab_runs         enable row level security;
alter table lab_results      enable row level security;
alter table lab_capital_log  enable row level security;
