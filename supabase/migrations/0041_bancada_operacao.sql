-- ── AS OPERAÇÕES QUE GERARAM O NÚMERO ───────────────────────────────
--
-- ⚠️⚠️ O DEFEITO QUE O DONO VIU (06/09): *"não aparece em lugar nenhum o que
-- ele está rodando, não aparece as entradas feitas, não aparece nada."*
--
-- Estava certo. O motor produzia `Operacao[]` — entrada, saída, desfecho,
-- bruto, líquido, de qual playbook —, `resumir()` colapsava tudo num veredito,
-- e as operações eram **jogadas fora**.
--
-- ⚠️ Um veredito sem as operações é exatamente o que esta casa passou a sessão
-- inteira combatendo: um número sem como conferir. O cliente lê "−1,85%" e não
-- tem como saber se foram quatro entradas ruins ou uma catástrofe; não vê
-- QUANDO entrou, a QUE preço, nem por que saiu. E numa mesa da casa ele nem
-- sabe qual playbook abriu.
--
-- ⚠️ E ISTO NÃO É SÓ TELA. Sem a linha, ninguém — nem nós — consegue auditar
-- depois por que uma rodada deu o que deu.

create table if not exists public.bancada_operacao (
  id uuid primary key default gen_random_uuid(),

  rodada_id uuid not null references public.bancada_rodada(id) on delete cascade,
  -- ⚠️ O dono repetido evita join numa leitura de cliente: join esquecido é
  -- vazamento, coluna ausente é erro de compilação (ver a nota da 0037).
  dono text not null,

  simbolo text not null,

  -- Instantes da vela de abertura e do fechamento, unix ms.
  abriu_em  bigint not null,
  fechou_em bigint not null,

  entrada numeric not null check (entrada > 0),
  saida   numeric not null check (saida > 0),

  -- ⚠️ TRÊS CLASSES, e `expirada` NÃO é ganho nem perda. Contá-la como derrota
  -- infla o custo, como vitória infla a borda — cicatriz do flywheel.
  desfecho text not null check (desfecho in ('alvo','stop','expirada')),

  bruto_pct   numeric not null,
  -- Já com o pedágio da praça E do papel do cliente descontado.
  liquido_pct numeric not null,

  -- ⚠️ QUAL PLAYBOOK ABRIU, no modo mesa. Nulo numa estratégia própria, onde o
  -- gatilho é o que o cliente escolheu. Sem isto, "a mesa operou" e "a mesa
  -- operou por reversão de faixa" ficam indistinguíveis.
  playbook text,

  criada_em timestamptz not null default now()
);

-- A tela lê "as operações desta rodada, em ordem".
create index if not exists bancada_operacao_rodada_idx
  on public.bancada_operacao (rodada_id, abriu_em);
-- E o dono lê "as minhas operações", sem passar pela rodada.
create index if not exists bancada_operacao_dono_idx
  on public.bancada_operacao (dono, criada_em desc);

-- ⚠️ RLS ligada, ZERO policies — o mesmo desenho da 0037. O isolamento vive em
-- `bancada/store.ts`, com o tipo marcado `Dono`; a razão inteira de não haver
-- policy de JWT está no cabeçalho daquela migration.
alter table public.bancada_operacao enable row level security;

comment on table public.bancada_operacao is
  'As operacoes que geraram o veredito de uma rodada. Sem elas o cliente le um numero sem como conferir — e nem nos conseguimos auditar depois. playbook e NULO em estrategia propria.';
