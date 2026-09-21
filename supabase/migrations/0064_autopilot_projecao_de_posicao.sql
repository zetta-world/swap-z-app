-- ═══════════════════════════════════════════════════════════════════════════
-- 0064 — A PROJEÇÃO IDEMPOTENTE DO EFEITO DE UM INTENT NA POSIÇÃO (A131-C)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️⚠️⚠️ POR QUE O ESQUEMA ATUAL NÃO BASTAVA.
--
-- `autopilot_positions` tem `unique (session_id, base)`. Isso garante UMA
-- linha por par sessão/moeda — e não diz nada sobre QUAIS execuções já estão
-- dobradas dentro dela. A pergunta que a reconciliação precisa responder é
-- outra:
--
--     "quanto DESTE intent já foi aplicado nesta posição?"
--
-- Sem essa resposta, reconciliar o mesmo intent duas vezes soma a mesma compra
-- duas vezes, e um preenchimento que cresce de 0,010 para 0,015 aplica 0,015
-- em cima dos 0,010 que já estavam lá. `cex_fills` é deduplicado por
-- `(exchange_id, dedupe_key)` — isso protege o LIVRO de execuções, não a
-- PROJEÇÃO dele na posição. São dois fatos diferentes, e o segundo não tinha
-- onde morar.
--
-- ⚠️ E NÃO PODE SER MEMÓRIA DE PROCESSO. Recovery acontece depois de restart,
-- em outra invocação serverless, em outro deployment. Um `Set` em memória ou
-- "já rodei nesta função" é exatamente o que não sobrevive ao caso que a
-- reconciliação existe para atender.
--
-- ⚠️ MIGRATION CRIADA E NUNCA APLICADA (Round 9, §24). Nenhuma das anteriores
-- foi tocada para encaixá-la.

-- ── 1. O MARCADOR ─────────────────────────────────────────────────────────
--
-- Uma linha por intent. `applied_*` é CUMULATIVO: o quanto daquele intent já
-- está dentro da posição. O delta a aplicar é sempre `ledger − applied`.
create table if not exists public.autopilot_position_effects (
  intent_id     uuid primary key
                  references public.cex_execution_intents(id) on delete restrict,
  session_id    uuid        not null
                  references public.autopilot_sessions(id) on delete cascade,
  exchange_id   text        not null,
  base          text        not null,
  side          text        not null check (side in ('buy','sell')),

  -- ⚠️ NUNCA DECRESCEM. O que já entrou na posição, venha da projeção pelo
  -- livro ou da absorção da liquidação da saída armada.
  applied_qty   numeric     not null default 0 check (applied_qty   >= 0),
  applied_quote numeric     not null default 0 check (applied_quote >= 0),

  -- ⚠️⚠️ E ESTES SÃO OUTRA COISA: o que o LIVRO dizia na última projeção.
  --
  -- Sem separá-los, a absorção (que adianta `applied` sem o livro ter
  -- ingerido o fill) viraria "regressão" na chamada seguinte: `filled_qty`
  -- legitimamente menor que `applied_qty`. A regressão que importa — livro
  -- ENCOLHENDO — só pode ser medida contra o próprio livro.
  ledger_qty    numeric     not null default 0 check (ledger_qty    >= 0),
  ledger_quote  numeric     not null default 0 check (ledger_quote  >= 0),

  -- ⚠️⚠️ A RESERVA MORA AQUI, E NÃO NUM CONTADOR AGREGADO — achado A137.
  --
  -- A primeira versão somava `reservado_qty` na POSIÇÃO e
  -- `exposicao_reservada_usd` na SESSÃO, com prazo de validade. Duas coisas
  -- erradas de uma vez:
  --
  --   · o prazo esquecia ordem VIVA. Uma limitada aceita sem preencher, dez
  --     minutos depois, liberava o compromisso — a segunda entrada passava, e
  --     as duas preenchiam: teto de 200 fechando em 210;
  --   · sem dono, a projeção de uma ordem antiga subtraía do agregado e podia
  --     consumir a reserva de OUTRA ordem mais nova.
  --
  -- Agora a reserva tem dono: o intent. O compromisso vivo de um intent é
  -- `greatest(reservado − applied, 0)` enquanto ele puder preencher, e ZERO
  -- quando ele está provadamente morto (`CANCELED`/`FAILED_PRE_SUBMIT`).
  -- Não há prazo: o que encerra um compromisso é o estado do intent.
  reservado_qty numeric     not null default 0 check (reservado_qty >= 0),
  reservado_usd numeric     not null default 0 check (reservado_usd >= 0),

  -- ⚠️⚠️ E O P&L TAMBÉM PRECISA DE EXACTLY-ONCE — achado A138.
  --
  -- A posição tinha marcador e o resultado não: o P&L era gravado numa
  -- chamada separada. Gravando o P&L e falhando a posição, a passada seguinte
  -- somava o MESMO resultado de novo; falhando o P&L e gravando a posição, o
  -- débito sumia sem ninguém para retentá-lo.
  --
  -- ⚠️⚠️⚠️ E A TAXA É CUMULATIVA COMO O RESTO — achado A140.
  --
  -- `fee_total` do intent é a taxa ACUMULADA da ordem (0059: o valor final
  -- independe do número de snapshots). Descontá-la inteira a cada parcial
  -- cobra a mesma taxa duas vezes. Com US$ 600 de custo:
  --
  --     parcial 1: recebido 320, taxa acumulada 1 → +19
  --     parcial 2: recebido 640, taxa acumulada 2 → delta +19 (total 38)
  --
  -- Sem watermark, o segundo parcial subtraía 2 de novo e fechava 37.
  --
  -- ⚠️ O CONTRATO DOS QUATRO CAMPOS, escrito porque quatro watermarks sem
  -- contrato é como se volta a errar:
  --
  --     applied_qty        quanto da QUANTIDADE do intent já está na posição
  --     applied_quote      quanto do RECEBIDO/GASTO já está na posição
  --     fee_aplicada_usd   quanta TAXA (USD) já foi descontada do P&L
  --     custo_removido_usd quanto CUSTO a posição já perdeu por este intent
  --     pnl_aplicado_usd   quanto RESULTADO já entrou no `pnl_today`
  --
  -- Os quatro primeiros são as entradas da conta; o último é o que ela
  -- produziu. A conta é ACUMULADA, não somada por deltas independentes:
  --
  --     realizado_total = applied_quote − custo_removido_usd − fee_aplicada_usd
  --     delta           = realizado_total − pnl_aplicado_usd
  --
  -- É isso que torna a ordem de chegada dos fatos irrelevante — quantidade
  -- primeiro, recebido depois, taxa por último, tudo converge no mesmo número.
  fee_aplicada_usd numeric  not null default 0 check (fee_aplicada_usd >= 0),

  -- ⚠️⚠️⚠️ E O CUSTO REMOVIDO TAMBÉM É WATERMARK — achado A142.
  --
  -- O A140 deu delta próprio à taxa e ninguém deu ao RECEBIDO. `filled_quote`
  -- pode crescer com `filled_qty` PARADO: a corretora nem sempre devolve
  -- `cost` no ACK, o executor manda `cumulativeQuote = 0`, e só quando
  -- `cex_ingest_trades` traz os trades reais o recebido aparece. O P&L estava
  -- atrás de `v_delta_quote > 0`, então:
  --
  --     1ª projeção: qty 0,01 · quote 0 → posição FECHADA, custo 600 sai do
  --                  livro, e ZERO entra no `pnl_today`
  --     2ª projeção: quote 640 chega, qty parada → `sem_delta`
  --
  -- Resultado: US$ 600 de custo somem e nenhum resultado é contado. Com o
  -- preço para o outro lado, é o PREJUÍZO que some — e o stop de perda nunca
  -- dispara.
  --
  -- O conserto é parar de somar deltas independentes e passar a calcular o
  -- resultado ACUMULADO, comparando-o com o que já foi contado:
  --
  --     realizado_total = applied_quote − custo_removido_usd − fee_aplicada_usd
  --     delta do P&L    = realizado_total − pnl_aplicado_usd
  --
  -- ⚠️ E O P&L SÓ É CONTADO QUANDO O RECEBIDO EXISTE. Enquanto `applied_quote`
  -- for zero, a redução da posição fica registrada aqui e o resultado espera —
  -- senão fechar a posição sem saber por quanto viraria um prejuízo de
  -- `−custo` inteiro, que foi exatamente o segundo defeito deste achado.
  custo_removido_usd numeric not null default 0 check (custo_removido_usd >= 0),

  pnl_aplicado_usd numeric  not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_autopilot_effects_por_posicao
  on public.autopilot_position_effects (session_id, base);

comment on table public.autopilot_position_effects is
  'A131-C: quanto de cada intent ja foi projetado em autopilot_positions. '
  'Marcador durable de exactly-once; o delta e sempre ledger - applied.';

-- ⚠️ RLS LIGADA, ZERO POLICIES — o padrão desta casa. Só o cliente
-- service-role (que passa por cima de RLS) enxerga a tabela.
alter table public.autopilot_position_effects enable row level security;

-- ── 2. POSIÇÕES LEGADAS (§38) ─────────────────────────────────────────────
--
-- ⚠️ NENHUM BACKFILL. Marcar intents antigos como "já aplicados" sem prova
-- seria inventar história: não existe registro de quais fills entraram nas
-- posições que já estão lá. As posições existentes continuam valendo como
-- ESTADO DE ABERTURA, e o marcador só descreve o que a projeção fez a partir
-- daqui. A consequência declarada: um intent antigo, ainda não terminal, que
-- for reconciliado depois desta migration aplica o preenchimento dele sobre a
-- posição atual — o que é o comportamento correto para um fill que ninguém
-- tinha projetado, e não dá para distinguir do caso já contado sem inventar
-- dado. Por isso a projeção nasce junto com a leitura do livro (Round 9) e
-- não é retroativa.

-- ══════════════════════════════════════════════════════════════════════════
-- INVARIANTE F — P&L INCOMPLETO NÃO AUTORIZA ENTRADA
--
-- ⚠️⚠️⚠️ `autopilot_taxa_do_intent_em_usd` DEVOLVE NULL quando a taxa está numa
-- moeda que não dá para precificar sem inventar cotação (a política do A140,
-- e ela está certa: não se inventa preço). O que estava errado era o que
-- acontecia DEPOIS:
--
--     v_taxa_opaca := true;
--     v_taxa_total := v_e.fee_aplicada_usd;     -- na prática, ZERO
--     ... realizado := recebido − custo − 0
--
-- e o resultado entrava em `pnl_today` como se fosse exato. A bandeira
-- `taxa_nao_precificada` subia para quem chamava, virava um evento — e o cron
-- seguia para a seção de entrada e COMPRAVA. Para um autopilot real isso é
-- FAIL-OPEN: o stop de perda diária passa a ser calculado sobre um prejuízo
-- menor do que o verdadeiro, e ninguém segura nada.
--
-- ⚠️ O FATO FINANCEIRO É PRESERVADO. A venda aconteceu, a posição reduziu, o
-- custo saiu do livro, o P&L parcial (sem a taxa) entrou. O que NÃO se afirma
-- é que aquele número está completo — e é por isso que ele deixa de autorizar
-- risco NOVO.
--
-- ⚠️⚠️ O BLOQUEIO É DURÁVEL, e tem de ser: uma bandeira da passada do cron não
-- alcança o navegador, que fala com a MESMA sessão pela `/api/cex/order`. É a
-- família do A113 outra vez — a peça certa obedecida num canal e ignorada no
-- outro. Por isso o estado mora no banco e os dois canais o leem pela mesma
-- função (`entradaAutorizadaNaSessao`).
--
-- ⚠️ POR QUE NÃO REUSAR `quarentena_em`. Ela significa "a conta derivou do
-- livro" e é conserto de outra natureza (reconciliação de inventário).
-- Empilhar os dois num campo só faria o operador ler "deriva" onde há taxa
-- opaca, e limpar um limparia o outro. São duas colunas porque são dois
-- fatos; o bloqueio que produzem é o mesmo.
--
-- ⚠️ E A LIBERAÇÃO É DETERMINÁVEL, não temporizada: a bandeira por intent é
-- recalculada a cada projeção/liquidação. Quando os trades reais trazem a
-- taxa numa moeda precificável, `taxa_opaca` cai para false e a sessão
-- destrava sozinha. Intervenção explícita = zerar a coluna da sessão à mão.
-- ══════════════════════════════════════════════════════════════════════════

-- ── F-1. A BANDEIRA POR INTENT ────────────────────────────────────────────
--
-- ⚠️ Por INTENT, não por sessão, porque é o intent que tem (ou não) taxa
-- precificável. A sessão é DERIVADA disto — sem o marcador por intent,
-- destravar por causa de um intent destravaria com outro ainda opaco.
alter table public.autopilot_position_effects
  add column if not exists taxa_opaca boolean not null default false;

comment on column public.autopilot_position_effects.taxa_opaca is
  'Invariante F: a taxa deste intent nao pode ser precificada em USD, entao o '
  'P&L realizado dele NAO e exato. Enquanto houver um assim na sessao, zero '
  'entrada autonoma nova.';

-- ── F-2. O BLOQUEIO DURÁVEL DA SESSÃO ─────────────────────────────────────
alter table public.autopilot_sessions
  add column if not exists contabilidade_incompleta_em timestamptz;

comment on column public.autopilot_sessions.contabilidade_incompleta_em is
  'Invariante F: quando a contabilidade da sessao deixou de ser afirmavel — '
  'taxa nao precificavel OU custo removido sem recebido para precifica-lo. '
  'Bloqueia COMPRA autonoma nos dois canais; saidas e recovery seguem. '
  'Derivada das linhas de autopilot_position_effects — some sozinha.';

-- ── F-1-BIS. A DIVERGÊNCIA QUE NÃO PODE SER ESQUECIDA (CR-2) ──────────────
--
-- ⚠️⚠️⚠️ DETECTADA UMA VEZ, ESQUECIDA PARA SEMPRE.
--
-- A projeção devolvia `ok:false` com `regressao_de_quote`/`regressao`/
-- `regressao_de_taxa` e ia embora. O retest independente reproduziu o preço
-- disso: o livro regrediu, a projeção recusou, e `pnl_today`, `freeze`,
-- `contabilidade_incompleta_em` e a lista de pendências ficaram todos como
-- estavam. A sessão seguiu comprando com uma divergência conhecida e
-- descartada — um erro financeiro que o sistema VIU e deixou cair no chão.
--
-- Agora a recusa GRAVA. A transação que recusa aplicar também marca o efeito,
-- e a marca alimenta a mesma definição de contabilidade incompleta que
-- bloqueia a COMPRA e relista o intent no recovery.
alter table public.autopilot_position_effects
  add column if not exists divergencia text;

comment on column public.autopilot_position_effects.divergencia is
  'CR-2: o motivo da ultima recusa por divergencia (regressao de qty/quote/ '
  'taxa). Enquanto existir, a sessao NAO compra e o intent segue pendente — '
  'detectar e esquecer era o defeito.';

-- ── F-2-BIS. O QUE É "CONTABILIDADE INCOMPLETA" — UMA DEFINIÇÃO SÓ ────────
--
-- ⚠️⚠️⚠️ ESTA PERGUNTA ERA RESPONDIDA EM DOIS LUGARES, e essa é a forma exata
-- do A113: a mesma regra escrita duas vezes diverge na primeira correção. Ela
-- decide (a) se a sessão pode COMPRAR e (b) se o intent entra no recovery
-- financeiro. As duas respostas TÊM de ser a mesma, senão existe um estado em
-- que a sessão está presa e nada vai buscar o que falta — que foi exatamente a
-- limitação declarada no HEAD anterior.
--
-- Dois motivos, e os dois significam "não sei afirmar o P&L realizado":
--
--   · TAXA OPACA — a venda realizou e a taxa não dá para precificar em USD,
--     por estar ausente (a venue não reportou) ou em moeda sem cotação.
--   · CUSTO REMOVIDO SEM RECEBIDO — a posição reduziu, o custo saiu do livro,
--     e a corretora ainda não disse por quanto. O A142 manda guardar e
--     esperar; nessa janela o dia não contém o resultado de um trade FECHADO.
--
-- ⚠️⚠️⚠️ CR-1: A COMPRA TAMBÉM TEM CONTABILIDADE INCOMPLETA.
--
-- A primeira versão só descrevia a VENDA, e o retest independente mostrou o
-- buraco: uma BUY que executou QUANTIDADE com o custo ainda desconhecido
-- (`filled_quote` 0) não era "incompleta" para ninguém. Ela sumia do
-- recovery, o compromisso dela caía a zero, e a entrada seguinte entrava como
-- se aquele capital não existisse — 190 + 10 (custo que chega depois) + 10
-- (reserva nova) = 210 num teto de 200.
--
-- Uma compra com quantidade aplicada e custo zero é exatamente o estado "o
-- bot tem a bolsa e não sabe quanto pagou". Isso é contabilidade incompleta
-- pela mesma razão que a taxa desconhecida é.
drop function if exists public.autopilot_efeito_incompleto(text, boolean, numeric, numeric);
create or replace function public.autopilot_efeito_incompleto(
  p_side text, p_taxa_opaca boolean,
  p_custo_removido numeric, p_applied_quote numeric,
  p_applied_qty numeric, p_divergencia text
) returns boolean
language sql immutable as $$
  select coalesce(p_taxa_opaca, false)
      -- ⚠️ CR-2: divergência vista é divergência que fica.
      or nullif(coalesce(p_divergencia, ''), '') is not null
      -- venda: reduziu a posição e o recebido ainda não chegou
      or (p_side = 'sell'
          and coalesce(p_custo_removido, 0) > 0
          and coalesce(p_applied_quote, 0) <= 0)
      -- ⚠️ CR-1 — compra: entrou quantidade e o custo segue desconhecido
      or (p_side = 'buy'
          and coalesce(p_applied_qty, 0) > 0
          and coalesce(p_applied_quote, 0) <= 0)
$$;

comment on function public.autopilot_efeito_incompleto(text, boolean, numeric, numeric, numeric, text) is
  'Round 9 (fechamento) + CR-1/CR-2: a UNICA definicao de contabilidade '
  'incompleta — taxa opaca, divergencia registrada, venda com custo removido '
  'sem recebido, e COMPRA com quantidade aplicada e custo desconhecido. '
  'Decide o bloqueio de COMPRA da sessao E a elegibilidade ao recovery: as '
  'duas respostas tem de ser a mesma.';

-- ⚠️ O recovery financeiro varre por esta coluna sem janela de tempo (o
-- conjunto é pequeno por construção: são sessões PRESAS). O índice parcial é
-- o que torna isso barato.
create index if not exists idx_autopilot_effects_incompletos
  on public.autopilot_position_effects (session_id)
  where taxa_opaca;

-- ── F-2-TER. O ÚNICO ESCRITOR DE `pnl_today` — COM A VIRADA DENTRO (CR-5) ─
--
-- ⚠️⚠️⚠️ A VIRADA DO DIA APAGAVA UM RESULTADO DE HOJE.
--
-- O retest independente reproduziu: sessão com `last_reset_day = ontem`, o
-- recovery roda ANTES do laço de sessões e aplica −53 com freeze de hoje; o
-- laço então recebe o snapshot VELHO (`last_reset_day` ainda ontem), executa
-- a virada, e zera `pnl_today` e `frozen_until_day`. Pior: o marcador
-- (`pnl_aplicado_usd`) continua −53, então o replay devolve zero — a perda
-- fica apagada DE FORMA PERSISTENTE, e a COMPRA seguinte passa.
--
-- Ordenar as duas coisas no TypeScript seria mais um acordo de cavalheiros
-- entre dois caminhos que já provaram divergir. A virada passou para DENTRO
-- da transação que aplica o resultado: quem escreve o P&L também carimba o
-- dia. Depois disso, qualquer virada posterior vê `last_reset_day = hoje` e
-- não tem o que zerar.
--
-- ⚠️ E É UM ESCRITOR SÓ. Os quatro `update autopilot_sessions set pnl_today`
-- espalhados pela projeção e pela liquidação viraram chamadas daqui — §14.
create or replace function public.autopilot_aplicar_pnl(
  p_session_id uuid, p_realizado numeric
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoje text := (current_timestamp at time zone 'UTC')::date::text;
  v_s record;
  v_base numeric;
begin
  if p_realizado is null then return; end if;

  select * into v_s from public.autopilot_sessions where id = p_session_id for update;
  if not found then return; end if;

  -- ⚠️ A BASE DO DIA: se a linha ainda é de ontem, o dia começa em zero AQUI,
  -- na mesma transação — nunca por um caminho que roda depois com um
  -- snapshot velho na mão.
  v_base := case when v_s.last_reset_day is distinct from v_hoje
                 then 0 else coalesce(v_s.pnl_today, 0) end;

  if p_realizado = 0 and v_s.last_reset_day is not distinct from v_hoje then
    return;   -- nada a fazer, e não se toca na linha à toa
  end if;

  update public.autopilot_sessions
     set pnl_today    = v_base + p_realizado,
         trades_today = case when v_s.last_reset_day is distinct from v_hoje
                             then 0 else trades_today end,
         last_reset_day = v_hoje,
         frozen_until_day = case
           when (v_base + p_realizado) <= -daily_loss_stop_usd then v_hoje
           -- ⚠️ Virou o dia: o congelamento de ONTEM não vale hoje.
           when v_s.last_reset_day is distinct from v_hoje then null
           else frozen_until_day end,
         updated_at = now()
   where id = p_session_id;
end; $$;

comment on function public.autopilot_aplicar_pnl(uuid, numeric) is
  'CR-5: o UNICO escritor de pnl_today/frozen_until_day. A virada do dia '
  'acontece DENTRO desta transacao, entao nenhuma virada posterior pode '
  'apagar um resultado ja aplicado hoje.';

revoke all on function public.autopilot_aplicar_pnl(uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.autopilot_aplicar_pnl(uuid, numeric)
  to service_role;

-- ── F-3. MARCAR E DERIVAR, NUMA TRANSAÇÃO SÓ ──────────────────────────────
--
-- ⚠️ Chamada de dentro das RPCs de projeção e liquidação, na MESMA transação
-- que move o dinheiro. Um `update` separado depois seria mais uma escrita sem
-- amarra — exatamente o que o A136 já custou caro.
--
-- ⚠️ `coalesce(contabilidade_incompleta_em, now())` preserva o INSTANTE
-- original: a bandeira não se renova a cada passada, para que "desde quando"
-- continue sendo uma informação verdadeira para quem for olhar.
create or replace function public.autopilot_marcar_contabilidade(
  p_intent_id uuid, p_session_id uuid, p_opaca boolean
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.autopilot_position_effects
     set taxa_opaca = coalesce(p_opaca, false), updated_at = now()
   where intent_id = p_intent_id;

  /**
   * ⚠️⚠️⚠️ SÃO DOIS MOTIVOS PARA A CONTA NÃO FECHAR, e o segundo foi achado
   * rodando a matriz final (item 11).
   *
   *   1. TAXA OPACA — a venda realizou e a taxa não dá para precificar.
   *   2. CUSTO REMOVIDO SEM RECEBIDO — a venda realizou, a posição reduziu, o
   *      custo saiu do livro, e a corretora ainda não disse POR QUANTO. O A142
   *      manda guardar o custo em `custo_removido_usd` e esperar o quote, o
   *      que está certo: sem recebido não se inventa resultado. Só que, nessa
   *      janela, `pnl_today` NÃO contém o prejuízo de um trade JÁ FECHADO.
   *
   * Medido: sessão em −49 com stop 50, venda com base de custo 100 e a venue
   * reportando `filled` sem `cost` → `pnl_today` seguia −49, `frozen_until_day`
   * null, portão de entrada ABERTO. O stop de perda estava frouxo por um
   * prejuízo que o próprio livro já sabia existir.
   *
   * ⚠️ OS DOIS SÃO DETERMINÁVEIS e derivados das LINHAS, nunca de um sinal de
   * quem chamou: a taxa vira precificável, o recebido chega — e a bandeira
   * some sozinha na mesma transação.
   */
  update public.autopilot_sessions s
     set contabilidade_incompleta_em = case
           when exists (
             select 1 from public.autopilot_position_effects e
              where e.session_id = p_session_id
                and public.autopilot_efeito_incompleto(
                      e.side, e.taxa_opaca, e.custo_removido_usd, e.applied_quote,
                      e.applied_qty, e.divergencia))
             then coalesce(s.contabilidade_incompleta_em, now())
           else null end,
         updated_at = now()
   where s.id = p_session_id;
end; $$;

comment on function public.autopilot_marcar_contabilidade(uuid, uuid, boolean) is
  'Invariante F: grava a opacidade da taxa DESTE intent e deriva o bloqueio da '
  'sessao, na mesma transacao que aplicou o efeito.';

revoke all on function public.autopilot_marcar_contabilidade(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.autopilot_marcar_contabilidade(uuid, uuid, boolean)
  to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- INVARIANTE Q — O RECEBIDO TARDIO TEM DE ENTRAR NO LIVRO
--
-- ⚠️⚠️⚠️ A 0059 ESCREVEU A SUPOSIÇÃO ERRADA, POR EXTENSO:
--
--     "fill sem qty só existe para carregar correção de fee, nunca quote"
--     check (qty > 0 or (qty = 0 and quote_amount = 0))
--
-- Ela vale para o mundo em que quantidade e dinheiro chegam juntos. O mundo
-- real da ordem limitada não é esse: o ACK traz `filled` e NÃO traz `cost` (a
-- venue só materializa o dinheiro quando os trades aparecem). A sequência
-- honesta é
--
--     snapshot 1:  qty = 0,01   quote = (ausente)
--     snapshot 2:  qty = 0,01   quote = 600
--
-- e o segundo caía no ramo "qty não cresceu", que só sabia tratar fee. O
-- recebido era DESCARTADO: `filled_quote` ficava 0 para sempre. Todo o A143
-- (assentar antes de liquidar) e todo o A145 (custo tardio da compra) leem
-- `filled_quote` — os dois liam um zero que não é zero, é "não medido que
-- virou medido e ninguém gravou".
--
-- ⚠️ A 0059 NÃO É ALTERADA. Ela já pode ter sido aplicada; a 0064 nunca foi.
-- As duas RPCs são REDEFINIDAS aqui, com a mesma assinatura, e a constraint é
-- refeita — é o que a 0064 pode fazer sem reescrever história.
--
-- ⚠️⚠️ "AUSENTE" NÃO É "ZERO", e aqui isso deixou de ser só um princípio:
-- `p_cumulative_quote` agora é NULLABLE. Um ACK sem `cost` manda NULL e não
-- move nada; um snapshot que manda 0 está AFIRMANDO zero recebido, e um livro
-- com 600 tratará isso como REGRESSÃO. Quem chama traduz ausência em null —
-- `Number.isFinite(custo) && custo > 0 ? custo : null`, nos três call sites.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Q-1. A CONSTRAINT QUE PROIBIA O FATO ──────────────────────────────────
--
-- ⚠️ Um fill de qty ZERO passa a poder carregar quote. Ele continua exigindo
-- `price > 0` (a coluna é `not null check (price > 0)`), e o preço gravado é
-- o médio da ordem — para uma linha de ajuste ele é referência, não uma
-- divisão de quote por qty que seria divisão por zero.
alter table public.cex_fills drop constraint if exists cex_fills_qty_check;
alter table public.cex_fills
  add constraint cex_fills_qty_check check (qty >= 0);

comment on constraint cex_fills_qty_check on public.cex_fills is
  'Invariante Q: fill de qty zero carrega ajuste de fee E/OU de quote. A 0059 '
  'proibia o segundo, e o recebido tardio da ordem limitada era descartado.';

-- ── Q-2. SNAPSHOT: O RAMO "QTY NÃO CRESCEU" TAMBÉM VÊ O RECEBIDO ──────────
--
-- Redefinição integral da RPC da 0059. O que MUDOU, e só isto:
--   · `p_cumulative_quote` NULL = não medido (antes, `coalesce(...,0)` fazia
--     ausência virar afirmação de zero);
--   · o ramo sem crescimento de qty calcula delta de QUOTE além do de fee, e
--     grava UMA linha de ajuste com os dois;
--   · a dedupe key do ajuste ganha prefixo próprio (`ordadj:`) e inclui o
--     quote — replay idêntico é no-op, recebido corrigido é fato novo;
--   · `regrediu` passa a cobrir a regressão de QUOTE medido, nos dois ramos.
-- Tudo o mais (dedupe, fee cumulativa, guarda de moeda, regressão de qty,
-- atomicidade) é a 0059 letra por letra.
create or replace function public.cex_ingest_order_snapshot(
  p_intent_id uuid,
  p_external_order_id text,
  p_cumulative_qty numeric,
  p_avg_price numeric,
  p_cumulative_quote numeric,
  p_fee numeric,
  p_fee_currency text,
  p_executed_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_intent public.cex_execution_intents%rowtype;
  v_ja numeric; v_delta numeric; v_quote numeric; v_preco numeric;
  v_fee_ja numeric; v_fee_delta numeric; v_moeda_livro text; v_incomp integer;
  v_chave text; v_ajuste boolean := false;
  v_quote_delta numeric; v_regrediu boolean;
begin
  select * into v_intent from public.cex_execution_intents
   where id = p_intent_id for update;
  if not found then raise exception 'intent % nao existe', p_intent_id; end if;
  if v_intent.state in ('CREATED','AUTHORIZED','RESERVED','FAILED_PRE_SUBMIT') then
    raise exception 'snapshot contra intent em % — estado pre-envio nao admite execucao', v_intent.state;
  end if;

  -- ⚠️ MOEDA DE FEE INCOMPATÍVEL É EXCEÇÃO, não conversão — e o NULL também
  -- fecha (0059, sem mudança).
  if p_fee is not null or p_fee_currency is not null then
    select count(*), min(f.fee_currency) into v_incomp, v_moeda_livro
      from public.cex_fills f
     where f.intent_id = p_intent_id
       and (f.external_order_id is not distinct from p_external_order_id
            or f.external_order_id is null)
       and f.fee is not null
       and f.fee_currency is distinct from p_fee_currency;
    if v_incomp > 0 then
      raise exception 'fee_currency incompativel na ordem %: livro tem %, snapshot traz % — sem conversao inventada',
        p_external_order_id, coalesce(v_moeda_livro, '(null)'), coalesce(p_fee_currency, '(null)');
    end if;
  end if;

  select coalesce(sum(qty),0), coalesce(sum(quote_amount),0)
    into v_ja, v_quote from public.cex_fills where intent_id = p_intent_id;

  select coalesce(sum(f.fee),0) into v_fee_ja
    from public.cex_fills f
   where f.intent_id = p_intent_id
     and (f.external_order_id is not distinct from p_external_order_id
          or f.external_order_id is null)
     and f.fee_currency is not distinct from p_fee_currency;
  v_fee_delta := case when p_fee is null then null
                      else greatest(p_fee - v_fee_ja, 0) end;

  /**
   * ⚠️⚠️ O DELTA DO RECEBIDO — e `null` NÃO É ZERO.
   *
   * Não medido não move nada e não acusa nada. Medido abaixo do livro é
   * REGRESSÃO: ninguém "desrecebe" dinheiro, e o `greatest()` que a
   * esconderia deixaria o P&L da venda otimista (a mesma família do
   * `regressao_de_quote` das RPCs do autopilot, só que uma camada antes).
   */
  v_quote_delta := case when p_cumulative_quote is null then 0
                        else greatest(p_cumulative_quote - v_quote, 0) end;
  v_regrediu := (p_cumulative_qty is not null and p_cumulative_qty < v_ja - 1e-9)
             or (p_cumulative_quote is not null and p_cumulative_quote < v_quote - 1e-9);

  if p_cumulative_qty is null or p_cumulative_qty <= v_ja + 1e-12 then
    /**
     * ⚠️⚠️⚠️ AQUI ESTAVA O INVARIANTE Q. Este ramo só sabia tratar fee.
     *
     * A qty parou, mas o RECEBIDO e a TAXA podem ter sido descobertos depois
     * — e a ordem limitada faz exatamente isso. Os dois entram numa linha só
     * de ajuste (qty zero), porque são o MESMO fato: "a venue contou o resto
     * da história desta ordem".
     */
    if p_cumulative_qty is not null and p_cumulative_qty > v_ja - 1e-9
       and ((v_fee_delta is not null and v_fee_delta > 0) or v_quote_delta > 0) then
      v_preco := case when p_avg_price > 0 then p_avg_price
                      when p_cumulative_quote > 0 and p_cumulative_qty > 0
                        then p_cumulative_quote / p_cumulative_qty
                      else (select f.price from public.cex_fills f
                             where f.intent_id = p_intent_id
                               and f.external_order_id is not distinct from p_external_order_id
                             order by f.created_at desc limit 1) end;
      if v_preco is null or v_preco <= 0 then
        raise exception 'ajuste sem preco utilizavel para a ordem %', p_external_order_id;
      end if;
      -- ⚠️ Prefixo próprio: o ajuste nunca colide com a chave do crescimento,
      -- e o quote entra na chave para que um recebido CORRIGIDO seja fato novo.
      v_chave := 'ordadj:' || coalesce(p_external_order_id,'?')
                 || ':' || p_cumulative_qty::text
                 || ':' || coalesce(p_fee::text,'-')
                 || ':' || coalesce(p_cumulative_quote::text,'-');
      insert into public.cex_fills (
        intent_id, exchange_id, external_order_id, external_trade_id, client_order_id,
        symbol, side, qty, price, quote_amount, fee, fee_currency, executed_at,
        sintetico, dedupe_key
      ) values (
        p_intent_id, v_intent.exchange_id, p_external_order_id, null, v_intent.client_order_id,
        v_intent.symbol, v_intent.side,
        0, v_preco, v_quote_delta, v_fee_delta, p_fee_currency, p_executed_at,
        true, v_chave
      )
      on conflict (intent_id, dedupe_key) do nothing;
      v_ajuste := found;
    end if;
    perform public.cex_recalcular_intent(p_intent_id);
    select * into v_intent from public.cex_execution_intents where id = p_intent_id;
    return jsonb_build_object('inseridos', case when v_ajuste then 1 else 0 end,
      'regrediu', v_regrediu, 'filled_qty', v_intent.filled_qty,
      'filled_quote', v_intent.filled_quote, 'state', v_intent.state);
  end if;

  v_delta := p_cumulative_qty - v_ja;
  v_preco := case when p_avg_price > 0 then p_avg_price
                  when p_cumulative_quote > 0 and p_cumulative_qty > 0
                    then p_cumulative_quote / p_cumulative_qty
                  else null end;
  if v_preco is null or v_preco <= 0 then
    raise exception 'snapshot sem preco utilizavel para a ordem %', p_external_order_id;
  end if;

  -- ⚠️ A chave do CRESCIMENTO continua a da 0059.
  v_chave := 'ordercum:' || coalesce(p_external_order_id,'?')
             || ':' || p_cumulative_qty::text || ':' || coalesce(p_fee::text,'-');
  insert into public.cex_fills (
    intent_id, exchange_id, external_order_id, external_trade_id, client_order_id,
    symbol, side, qty, price, quote_amount, fee, fee_currency, executed_at,
    sintetico, dedupe_key
  ) values (
    p_intent_id, v_intent.exchange_id, p_external_order_id, null, v_intent.client_order_id,
    v_intent.symbol, v_intent.side,
    v_delta, v_preco, v_quote_delta,
    v_fee_delta, p_fee_currency, p_executed_at,
    true, v_chave
  )
  on conflict (intent_id, dedupe_key) do nothing;

  if p_external_order_id is not null and v_intent.external_order_id is null then
    update public.cex_execution_intents set external_order_id = p_external_order_id
     where id = p_intent_id;
  end if;

  perform public.cex_recalcular_intent(p_intent_id);
  select * into v_intent from public.cex_execution_intents where id = p_intent_id;
  return jsonb_build_object('inseridos', 1, 'filled_qty', v_intent.filled_qty,
                            'filled_quote', v_intent.filled_quote,
                            'state', v_intent.state, 'regrediu', v_regrediu);
end; $$;

comment on function public.cex_ingest_order_snapshot(uuid, text, numeric, numeric, numeric, numeric, text, timestamptz) is
  'Invariante Q (0064): o ramo sem crescimento de qty grava o delta de QUOTE '
  'alem do de fee, e p_cumulative_quote NULL significa nao medido.';

-- ── Q-3. TRADES: O SINTÉTICO QUE CARREGA RECEBIDO TAMBÉM É FATO ───────────
--
-- ⚠️⚠️ SEM ISTO, O CONSERTO ACIMA VAZARIA NA SUBSTITUIÇÃO.
--
-- A cobertura de quantidade da 0059 mede `sum(qty)` dos sintéticos. Um ajuste
-- de quote tem qty ZERO: `v_sint = 0`, e um lote todo dedupado (`v_novos = 0`)
-- passava na cobertura, apagava o ajuste e `filled_quote` desabava de 600
-- para 0 — sem um único trade novo. É exatamente o buraco que a 0059 já havia
-- tapado para a FEE (achado a, round 4); aqui ele é tapado para o RECEBIDO,
-- com a MESMA forma: o gate dispara pela EXISTÊNCIA do sintético com quote, e
-- o que libera a substituição é evidência nova explícita, não um número maior.
--
-- ⚠️ E O REAL MENOR CONTINUA SUBSTITUINDO. Trades novos que somam menos quote
-- que o sintético são FATO e entram — a regressão resultante de
-- `filled_quote` é pega pelas guardas `regressao_de_quote` da projeção e da
-- liquidação, que falham fechado com o dinheiro já correto no livro de
-- execuções. Recusar aqui deixaria o livro MENTINDO para sempre.
create or replace function public.cex_ingest_trades(
  p_intent_id uuid,
  p_external_order_id text,
  p_trades jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_intent public.cex_execution_intents%rowtype;
  v_t jsonb; v_inseridos integer := 0;
  v_sint numeric; v_novos numeric; v_qtd_novos integer;
  v_lote jsonb; v_sem_id boolean;
begin
  select * into v_intent from public.cex_execution_intents
   where id = p_intent_id for update;
  if not found then raise exception 'intent % nao existe', p_intent_id; end if;

  if v_intent.state in ('CREATED','AUTHORIZED','RESERVED','FAILED_PRE_SUBMIT') then
    raise exception 'fill contra intent em % — estado pre-envio nao admite execucao', v_intent.state;
  end if;

  select coalesce(jsonb_agg(u.t order by u.ord)
                  filter (where u.t->>'order' is null or u.t->>'order' = p_external_order_id),
                  '[]'::jsonb),
         coalesce(bool_or(nullif(u.t->>'trade_id','') is null), false)
    into v_lote, v_sem_id
    from jsonb_array_elements(coalesce(p_trades,'[]'::jsonb)) with ordinality as u(t, ord);
  if v_sem_id then
    return jsonb_build_object('ok', false, 'porque', 'trade_sem_id');
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_lote) a
      join jsonb_array_elements(v_lote) b
        on a->>'trade_id' = b->>'trade_id'
     where (a->>'qty')::numeric   is distinct from (b->>'qty')::numeric
        or (a->>'price')::numeric is distinct from (b->>'price')::numeric
        or (a->>'quote')::numeric is distinct from (b->>'quote')::numeric
        or nullif(a->>'fee','')::numeric
           is distinct from nullif(b->>'fee','')::numeric
        or nullif(a->>'fee_currency','')
           is distinct from nullif(b->>'fee_currency','')
        or coalesce(nullif(a->>'order',''), p_external_order_id)
           is distinct from coalesce(nullif(b->>'order',''), p_external_order_id)
        or nullif(a->>'executed_at','')
           is distinct from nullif(b->>'executed_at','')) then
    return jsonb_build_object('ok', false, 'porque', 'trade_id_conflitante');
  end if;

  select coalesce(jsonb_agg(d.t order by d.ord), '[]'::jsonb) into v_lote
    from (select distinct on (e.t->>'trade_id') e.t as t, e.ord as ord
            from jsonb_array_elements(v_lote) with ordinality as e(t, ord)
           order by e.t->>'trade_id', e.ord) d;

  select coalesce(sum(qty),0) into v_sint from public.cex_fills
   where intent_id = p_intent_id and sintetico
     and (external_order_id is not distinct from p_external_order_id
          or external_order_id is null)
     and exchange_id = v_intent.exchange_id;

  select coalesce(sum((t->>'qty')::numeric),0), count(*) into v_novos, v_qtd_novos
    from jsonb_array_elements(v_lote) t
   where not exists (select 1 from public.cex_fills f
          where f.intent_id = p_intent_id
            and f.dedupe_key = 'trade:' || (t->>'trade_id'));

  if v_sint > 0 and v_novos < v_sint - 1e-12 then
    return jsonb_build_object('ok', false, 'porque', 'cobertura_incompleta',
                              'novos', v_novos, 'sintetico', v_sint);
  end if;

  -- Cobertura de FEE (A121) — inalterada.
  if exists (select 1 from public.cex_fills f
         where f.intent_id = p_intent_id and f.sintetico
           and (f.external_order_id is not distinct from p_external_order_id
                or f.external_order_id is null)
           and f.exchange_id = v_intent.exchange_id
           and f.fee is not null) then
    if v_qtd_novos = 0 or exists (
        select 1 from jsonb_array_elements(v_lote) t
         where not exists (select 1 from public.cex_fills f
                where f.intent_id = p_intent_id
                  and f.dedupe_key = 'trade:' || (t->>'trade_id'))
           and nullif(t->>'fee','') is null) then
      return jsonb_build_object('ok', false, 'porque', 'cobertura_fee_incompleta',
                                'novos', v_novos, 'sintetico', v_sint);
    end if;
    if exists (
        with novos as (
          select nullif(t->>'fee_currency','') as moeda
            from jsonb_array_elements(v_lote) t
           where not exists (select 1 from public.cex_fills f
                  where f.intent_id = p_intent_id
                    and f.dedupe_key = 'trade:' || (t->>'trade_id'))
        ), moedas_sint as (
          select distinct f.fee_currency as moeda from public.cex_fills f
           where f.intent_id = p_intent_id and f.sintetico
             and (f.external_order_id is not distinct from p_external_order_id
                  or f.external_order_id is null)
             and f.exchange_id = v_intent.exchange_id
             and f.fee is not null
        )
        select 1 from novos n
         where not exists (select 1 from moedas_sint m
                where m.moeda is not distinct from n.moeda)) then
      return jsonb_build_object('ok', false, 'porque', 'fee_currency_incompativel',
                                'novos', v_novos, 'sintetico', v_sint);
    end if;
  end if;

  /**
   * ⚠️⚠️ COBERTURA DE QUOTE (invariante Q) — a que faltava.
   *
   * Mesma forma do gate de fee: dispara pela EXISTÊNCIA de sintético com
   * recebido, INDEPENDENTE de `v_sint > 0`, porque um ajuste de quote tem qty
   * zero e não aparece naquela soma. Sem trade novo único, NADA é deletado e
   * nada é inserido — o recebido é preservado até haver evidência substituta.
   */
  if v_qtd_novos = 0 and exists (
       select 1 from public.cex_fills f
        where f.intent_id = p_intent_id and f.sintetico
          and (f.external_order_id is not distinct from p_external_order_id
               or f.external_order_id is null)
          and f.exchange_id = v_intent.exchange_id
          and f.quote_amount > 0) then
    return jsonb_build_object('ok', false, 'porque', 'cobertura_quote_incompleta',
                              'novos', v_novos, 'sintetico', v_sint);
  end if;

  delete from public.cex_fills
   where intent_id = p_intent_id and sintetico
     and (external_order_id is not distinct from p_external_order_id
          or external_order_id is null);

  for v_t in select * from jsonb_array_elements(v_lote) loop
    insert into public.cex_fills (
      intent_id, exchange_id, external_order_id, external_trade_id, client_order_id,
      symbol, side, qty, price, quote_amount, fee, fee_currency, executed_at,
      sintetico, dedupe_key
    ) values (
      p_intent_id, v_intent.exchange_id, p_external_order_id,
      v_t->>'trade_id', v_intent.client_order_id,
      v_intent.symbol, v_intent.side,
      (v_t->>'qty')::numeric, (v_t->>'price')::numeric, (v_t->>'quote')::numeric,
      nullif(v_t->>'fee','')::numeric, nullif(v_t->>'fee_currency',''),
      nullif(v_t->>'executed_at','')::timestamptz,
      false, 'trade:' || (v_t->>'trade_id')
    )
    on conflict (intent_id, dedupe_key) do nothing;
    if found then v_inseridos := v_inseridos + 1; end if;
  end loop;

  if p_external_order_id is not null and v_intent.external_order_id is null then
    update public.cex_execution_intents set external_order_id = p_external_order_id
     where id = p_intent_id;
  end if;

  perform public.cex_recalcular_intent(p_intent_id);
  select * into v_intent from public.cex_execution_intents where id = p_intent_id;
  return jsonb_build_object('ok', true, 'inseridos', v_inseridos,
                            'filled_qty', v_intent.filled_qty,
                            'filled_quote', v_intent.filled_quote,
                            'state', v_intent.state);
end; $$;

comment on function public.cex_ingest_trades(uuid, text, jsonb) is
  'Invariante Q (0064): sintetico que carrega RECEBIDO tambem e fato — sem '
  'trade novo unico, a substituicao nao apaga o ajuste de quote.';

-- ── 3. A PROJEÇÃO ─────────────────────────────────────────────────────────
create or replace function public.autopilot_projetar_efeito_do_intent(
  -- ⚠️⚠️ NÃO RECEBE MAIS TAXA NEM DIA — achado A140.
  --
  -- A taxa vinha de quem chamava, e a varredura de pendências não tinha como
  -- saber dela: o mesmo preenchimento rendia P&L diferente conforme quem o
  -- descobrisse. O dia vinha de quem chamava, e `null` fazia o freeze do stop
  -- de perda simplesmente não acontecer. Os dois agora saem do banco, que é
  -- a única autoridade que todos os caminhos compartilham.
  p_intent_id         uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_i             record;
  v_e             record;
  v_pos           record;
  v_base          text;
  v_delta_qty     numeric;
  v_delta_quote   numeric;
  v_restante      numeric;
  v_custo_restante numeric;
  v_custo_removido numeric;
  v_fechou        boolean := false;
  v_realizado     numeric := 0;
  v_taxa_total    numeric;
  v_taxa_delta    numeric := 0;
  v_taxa_opaca    boolean := false;
  v_custo_acum    numeric := 0;
  v_quote_novo    numeric := 0;
  v_realizado_total numeric := 0;
  v_hoje          text;
  v_quote_mudou   boolean := false;
  v_eps  constant numeric := 1e-12;
  -- Ruído relativo de ponto flutuante ao vender "tudo": 0,1 − 0,1 pode deixar
  -- 1e-17. Mesma convenção de `oQueSobrou` em venda-limitada.ts.
  v_ruido constant numeric := 1e-9;
begin
  -- ⚠️⚠️ TUDO NUMA TRANSAÇÃO, COM LOCK. Duas reconciliações simultâneas do
  -- MESMO intent não podem calcular o mesmo delta: a segunda espera o lock do
  -- intent, relê o marcador já atualizado e encontra delta zero.
  select * into v_i from public.cex_execution_intents where id = p_intent_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'intent_inexistente');
  end if;

  -- ── ORIGEM (§31): patrimônio manual não vira posse do bot ───────────────
  if v_i.simulated then
    return jsonb_build_object('ok', false, 'motivo', 'simulado');
  end if;
  if v_i.origin not in ('autopilot_browser', 'autopilot_cron') or v_i.autonomous is not true then
    return jsonb_build_object('ok', false, 'motivo', 'origem_nao_autonoma',
                              'origin', v_i.origin);
  end if;
  if v_i.session_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;

  -- ⚠️ `BTC-USDT` E `BTC/USDT` SÃO O MESMO ATIVO. A rota aceita os dois
  -- separadores (`split(/[\/\-]/)`), e derivar a base só por `/` criaria uma
  -- linha `base = 'BTC-USDT'` que a checagem de posse nunca encontraria: o bot
  -- ficaria com uma bolsa que não consegue vender, e duas linhas para o mesmo
  -- ativo somando na exposição.
  v_base := upper(split_part(replace(v_i.symbol, '-', '/'), '/', 1));

  insert into public.autopilot_position_effects
    (intent_id, session_id, exchange_id, base, side)
  values
    (p_intent_id, v_i.session_id, v_i.exchange_id, v_base, v_i.side)
  on conflict (intent_id) do nothing;

  select * into v_e from public.autopilot_position_effects
   where intent_id = p_intent_id for update;

  /**
   * ⚠️⚠️ A ABSORÇÃO SAIU DAQUI (A136/A139).
   *
   * Havia dois parâmetros para a liquidação da saída armada registrar o que
   * ela tinha aplicado direto. Eles existiam porque a liquidação escrevia a
   * posição por fora; hoje ela tem transação própria
   * (`autopilot_liquidar_saida_armada`), e esta função não precisa acreditar
   * em número nenhum de quem chama: ela lê `filled_qty`/`filled_quote` da
   * linha do intent.
   *
   * ⚠️ E as duas marcas d'água (`applied` × `ledger`) continuam, porque a
   * liquidação ainda pode adiantar `applied` antes de os fills serem
   * ingeridos — só que agora por uma transação que também move a posição.
   */

  -- ── REGRESSÃO (§28): fail-closed, sem corromper a posição ──────────────
  -- ⚠️ CONTRA `ledger_qty`, não contra `applied_qty`: a absorção adianta o
  -- segundo de propósito, e compará-la com o livro acusaria regressão onde há
  -- apenas uma liquidação que chegou antes da ingestão dos fills.
  if v_i.filled_qty < v_e.ledger_qty - v_eps then
    -- ⚠️ CR-2: a recusa GRAVA. Detectar e esquecer era o defeito.
    update public.autopilot_position_effects
       set divergencia = 'regressao_de_quantidade', updated_at = now()
     where intent_id = p_intent_id;
    perform public.autopilot_marcar_contabilidade(p_intent_id, v_i.session_id,
      v_taxa_opaca and v_i.side = 'sell' and coalesce(v_i.filled_qty, 0) > 0);
    return jsonb_build_object('ok', false, 'motivo', 'regressao',
      'aplicado', v_e.ledger_qty, 'no_livro', v_i.filled_qty);
  end if;

  /**
   * ⚠️⚠️⚠️ A REGRESSÃO DO RECEBIDO — auditoria SINTÉTICO → REAL do A145.
   *
   * `cex_ingest_trades` SUBSTITUI os fills sintéticos da ordem pelos reais
   * (0059). Quando o sintético estimou ALTO — ACK diz `cost = 600`, os trades
   * somam 580 — `filled_quote` CAI, com `filled_qty` parado.
   *
   * Nenhum `greatest()` desta função reclamava disso, e dois deles escondiam:
   *
   *     v_delta_quote := greatest(filled_quote − applied_quote, 0)   → 0
   *     v_quote_novo  := greatest(applied_quote, filled_quote)       → 600
   *
   * Na VENDA o segundo é o estrago: o resultado do dia segue calculado sobre
   * um recebido que não existiu, US$ 20 OTIMISTA — e é exatamente o número
   * que alimenta o stop de perda diária. Um freio calibrado por um recebido
   * inflado é um freio que não freia.
   *
   * ⚠️ POR QUE FAIL-CLOSED E NÃO CORREÇÃO AUTOMÁTICA. A conta acumulada do
   * A142 saberia aplicar um delta negativo de P&L; a POSIÇÃO não sabe
   * desfazer. Na compra, `cost_usd` já somou os 600 — devolvê-los exigiria
   * saber quanto daquele custo ainda está na linha depois de vendas
   * parciais, e a linha pode já ter sido apagada. Corrigir metade da conta é
   * pior que parar: vira lucro artificial com aparência de conserto.
   *
   * O livro de EXECUÇÕES continua certo (é ele que regrediu, para a verdade).
   * O que para é a PROJEÇÃO daquele intent, com evento de severidade alta —
   * reconciliação de mão humana, como a regressão de quantidade e a de taxa.
   */
  /**
   * ⚠️⚠️⚠️ CR-2 — A REGRESSÃO DO RECEBIDO TEM DOIS DESFECHOS, E O ANTIGO
   * ERA O ERRADO PARA O CASO COMUM.
   *
   * Antes, QUALQUER queda de `filled_quote` fechava a porta e ia embora. O
   * retest reproduziu o preço: sintético dizia 100, os trades reais disseram
   * 80, a projeção recusou — e `pnl_today` ficou nos −32 de antes, sem
   * freeze, sem bandeira, fora da lista de pendências. O resultado econômico
   * verdadeiro era −52, e o stop de perda deveria ter disparado.
   *
   * ⚠️ NA VENDA A CORREÇÃO É ARITMÉTICA, e a conta acumulada do A142 já sabe
   * fazê-la: o custo removido NÃO muda quando o recebido cai — só a receita
   * muda. `realizado_total = recebido − custo − taxa` recalculado com o
   * recebido MENOR produz um delta NEGATIVO, que é exatamente a correção.
   * Recusar ali era preservar um lucro otimista em silêncio.
   *
   * ⚠️ NA COMPRA NÃO É. O recebido virou `cost_usd` na posição, e devolvê-lo
   * exigiria saber quanto daquele custo ainda está na linha depois de vendas
   * parciais — e a linha pode já ter sido apagada. Aí sim: fail-closed, com a
   * divergência GRAVADA para não sumir do sistema.
   */
  if v_i.filled_quote < v_e.ledger_quote - v_eps and v_i.side = 'buy' then
    update public.autopilot_position_effects
       set divergencia = 'regressao_de_quote', updated_at = now()
     where intent_id = p_intent_id;
    perform public.autopilot_marcar_contabilidade(p_intent_id, v_i.session_id, false);
    return jsonb_build_object('ok', false, 'motivo', 'regressao_de_quote',
      'aplicado', v_e.ledger_quote, 'no_livro', v_i.filled_quote);
  end if;

  -- ⚠️ O DELTA É CONTRA `applied`: o que já está DENTRO da posição, tenha
  -- entrado pela projeção ou pela liquidação.
  v_delta_qty   := greatest(v_i.filled_qty   - v_e.applied_qty,   0);
  v_delta_quote := greatest(v_i.filled_quote - v_e.applied_quote, 0);

  /**
   * ⚠️⚠️⚠️ A TAXA TEM DELTA PRÓPRIO — achado A140.
   *
   * `fee_total` é CUMULATIVA (0059). Descontá-la inteira a cada parcial cobra
   * duas vezes. E ela pode crescer SEM quantidade nova: a 0059 permite ajuste
   * de taxa depois, quando os trades reais substituem o sintético. Nesse caso
   * `delta_qty` é zero e o P&L ainda precisa mudar — por isso o `sem_delta`
   * abaixo confere as DUAS coisas.
   */
  v_taxa_total := public.autopilot_taxa_do_intent_em_usd(
    v_i.fee_total, v_i.fee_currency, v_i.symbol, v_i.filled_qty, v_i.filled_quote);
  if v_taxa_total is null then
    -- ⚠️ Moeda não precificável: não se inventa preço, e não se finge que é
    -- zero exato. A taxa não entra, e quem chama recebe a bandeira.
    v_taxa_opaca := true;
    v_taxa_total := v_e.fee_aplicada_usd;
  end if;
  v_taxa_delta := v_taxa_total - v_e.fee_aplicada_usd;
  if v_taxa_delta < -v_eps then
    -- ⚠️ REGRESSÃO DE TAXA: aplicar um delta negativo viraria LUCRO
    -- artificial. Fail-closed, como a regressão de quantidade — e, desde o
    -- CR-2, GRAVADA: uma divergência vista não pode cair no chão.
    update public.autopilot_position_effects
       set divergencia = 'regressao_de_taxa', updated_at = now()
     where intent_id = p_intent_id;
    perform public.autopilot_marcar_contabilidade(p_intent_id, v_i.session_id, false);
    return jsonb_build_object('ok', false, 'motivo', 'regressao_de_taxa',
      'aplicado', v_e.fee_aplicada_usd, 'no_livro', v_taxa_total);
  end if;

  -- ⚠️⚠️ A142: o RECEBIDO entra na decisão. Ele cresce com a quantidade
  -- parada (ACK sem `cost`, trades reais depois), e sem isto a chegada dele
  -- caía em `sem_delta` — o resultado inteiro ia embora.
  /**
   * ⚠️⚠️ CR-2: O RECEBIDO QUE CAIU TAMBÉM É DELTA.
   *
   * `v_delta_quote` é `greatest(livro − aplicado, 0)`: uma QUEDA vira zero e
   * o atalho `sem_delta` engolia a correção antes de qualquer conta. Na venda,
   * qualquer diferença entre o livro e o aplicado é resultado a acertar — nos
   * dois sentidos.
   */
  v_quote_mudou := v_i.side = 'sell'
    and abs(coalesce(v_i.filled_quote, 0) - coalesce(v_e.applied_quote, 0)) > v_eps;
  if v_delta_qty <= v_eps and v_taxa_delta <= v_eps and v_delta_quote <= v_eps
     and not v_quote_mudou then
    -- ⚠️ O LIVRO AVANÇOU SEM DELTA? Ainda assim é o novo piso da regressão.
    update public.autopilot_position_effects
       set ledger_qty   = greatest(ledger_qty,   v_i.filled_qty),
           ledger_quote = greatest(ledger_quote, v_i.filled_quote),
           updated_at   = now()
     where intent_id = p_intent_id;
    -- ⚠️⚠️ INVARIANTE F: a opacidade da taxa DESTE intent e o bloqueio
    -- derivado da sessão entram na MESMA transação que aplicou o efeito.
    perform public.autopilot_marcar_contabilidade(p_intent_id, v_i.session_id,
      v_taxa_opaca and v_i.side = 'sell' and coalesce(v_i.filled_qty, 0) > 0);
    return jsonb_build_object('ok', true, 'motivo', 'sem_delta',
      'aplicado_qty', 0, 'aplicado_quote', 0, 'fechou', false,
      'pnl_realizado', 0, 'taxa_nao_precificada', v_taxa_opaca);
  end if;

  /**
   * ⚠️⚠️ AJUSTE SEM QUANTIDADE NOVA (A140 §7 e A142): o livro descobriu o
   * RECEBIDO ou a TAXA depois, e o resultado do dia muda sem que nada tenha
   * sido vendido a mais. Este ramo existe porque o caminho normal exige
   * `delta_qty > 0` para tocar a posição, e aqui não há posição a tocar.
   */
  if v_delta_qty <= v_eps then
    if v_i.side = 'sell' then
      -- ⚠️ CR-2: o LIVRO manda, inclusive quando cai. `greatest` aqui
      -- preservaria a receita antiga e com ela um lucro que não existiu.
      v_quote_novo := v_i.filled_quote;
      v_custo_acum := v_e.custo_removido_usd;
      -- ⚠️ Sem recebido não se conta resultado: a redução já está guardada em
      -- `custo_removido_usd` e espera o quote chegar.
      if v_quote_novo > 0 then
        v_realizado_total := v_quote_novo - v_custo_acum - v_taxa_total;
        v_realizado := v_realizado_total - v_e.pnl_aplicado_usd;
      end if;
    -- ⚠️ CR-5: um escritor só, e a virada do dia mora nele.
    perform public.autopilot_aplicar_pnl(v_i.session_id, v_realizado);
    /**
     * ⚠️⚠️⚠️ ACHADO A145 — O CUSTO DA COMPRA QUE CHEGOU ATRASADO.
     *
     * Este ramo tratava só a venda. Na compra ele avançava
     * `applied_quote = greatest(applied_quote, filled_quote)` e ia embora:
     * o marcador dizia "600 aplicados" e `autopilot_positions.cost_usd`
     * continuava ZERO. É o caso comum, não o exótico — uma ordem aceita sem
     * `cost` no ACK (a venue responde a quantidade e o dinheiro só aparece
     * nos trades depois) entra no livro com `filled_qty` já cheio e
     * `filled_quote` zerado. O `delta_qty` da passada seguinte é zero, e o
     * recebido cai exatamente aqui.
     *
     * O estrago é PERMANENTE e silencioso: base de custo perdida para
     * sempre. A exposição do teto conta menos capital do que existe (e o bot
     * compra mais do que pode), e a venda futura calcula
     * `recebido − 0 − taxa` — LUCRO INVENTADO do tamanho da compra.
     *
     * ⚠️ QUANTIDADE NÃO SE TOCA AQUI. `delta_qty` é zero por definição deste
     * ramo; somar base seria inventar moeda.
     *
     * ⚠️⚠️ E SEM POSIÇÃO NÃO SE MARCA NADA COMO APLICADO. Se o custo não
     * tiver onde entrar, avançar `applied_quote` faria a varredura de
     * pendências responder `sem_delta` para sempre — o mesmo erro do A136,
     * absorver antes da escrita. Fail-closed VISÍVEL, na mesma transação.
     */
    elsif v_i.side = 'buy' and v_delta_quote > v_eps then
      select * into v_pos from public.autopilot_positions
       where session_id = v_i.session_id and base = v_base for update;
      if not found then
        return jsonb_build_object('ok', false, 'motivo', 'sem_posicao_para_custo',
          'base', v_base, 'delta_quote', v_delta_quote);
      end if;
      update public.autopilot_positions
         set cost_usd    = cost_usd + v_delta_quote,
             entry_price = case when base_amount > 0
                                then (cost_usd + v_delta_quote) / base_amount
                                else entry_price end,
             updated_at  = now()
       where id = v_pos.id;
    end if;
    update public.autopilot_position_effects
       set fee_aplicada_usd = v_taxa_total,
           -- ⚠️ CR-2: acompanha o livro nos dois sentidos.
           applied_quote    = case when v_i.side = 'sell' then v_i.filled_quote
                                   else greatest(applied_quote, v_i.filled_quote) end,
           pnl_aplicado_usd = pnl_aplicado_usd + v_realizado,
           divergencia      = null,
           ledger_qty       = greatest(ledger_qty,   v_i.filled_qty),
           ledger_quote     = greatest(ledger_quote, v_i.filled_quote),
           updated_at       = now()
     where intent_id = p_intent_id;
    -- ⚠️⚠️ INVARIANTE F: a opacidade da taxa DESTE intent e o bloqueio
    -- derivado da sessão entram na MESMA transação que aplicou o efeito.
    perform public.autopilot_marcar_contabilidade(p_intent_id, v_i.session_id,
      v_taxa_opaca and v_i.side = 'sell' and coalesce(v_i.filled_qty, 0) > 0);
    return jsonb_build_object('ok', true, 'motivo', 'ajuste_sem_quantidade',
      'aplicado_qty', 0, 'aplicado_quote', greatest(v_delta_quote, 0),
      'fechou', false, 'pnl_realizado', v_realizado, 'taxa_delta', v_taxa_delta,
      'taxa_nao_precificada', v_taxa_opaca);
  end if;

  select * into v_pos from public.autopilot_positions
   where session_id = v_i.session_id and base = v_base for update;

  /**
   * ⚠️⚠️ POSIÇÃO JÁ FECHADA POR ESTE MESMO INTENT — achado A142 (P1-4).
   *
   * A liquidação fecha a posição com o que a CORRETORA disse ter saído; os
   * trades reais podem trazer um pouco mais depois. A quantidade a mais não
   * tem posição para reduzir — o custo inteiro já saiu — e voltar
   * `sem_posicao` relistava o intent a cada cinco minutos por três dias, com
   * evento de severidade alta, até a janela fechar sem nunca contar o
   * resultado.
   *
   * O que sobra é receita sem custo novo, e a conta acumulada sabe lidar com
   * isso. Só vale quando ESTE intent já aplicou algo — sem isso, `sem_posicao`
   * continua sendo fail-closed de verdade.
   */
  if not found and v_i.side = 'sell' and v_e.applied_qty > 0 then
    v_quote_novo := v_i.filled_quote;   -- ⚠️ CR-2: o livro manda
    if v_quote_novo > 0 then
      v_realizado_total := v_quote_novo - v_e.custo_removido_usd - v_taxa_total;
      v_realizado := v_realizado_total - v_e.pnl_aplicado_usd;
    end if;
    -- ⚠️ CR-5: um escritor só, e a virada do dia mora nele.
    perform public.autopilot_aplicar_pnl(v_i.session_id, v_realizado);
    update public.autopilot_position_effects
       set applied_qty      = greatest(applied_qty,  v_i.filled_qty),
           -- ⚠️ CR-2: na venda acompanha o livro nos DOIS sentidos.
           applied_quote    = case when v_i.side = 'sell' then v_i.filled_quote
                                   else greatest(applied_quote, v_i.filled_quote) end,
           ledger_qty       = greatest(ledger_qty,    v_i.filled_qty),
           ledger_quote     = greatest(ledger_quote,  v_i.filled_quote),
           fee_aplicada_usd = greatest(fee_aplicada_usd, v_taxa_total),
           pnl_aplicado_usd = pnl_aplicado_usd + v_realizado,
           updated_at       = now()
     where intent_id = p_intent_id;
    -- ⚠️⚠️ INVARIANTE F: a opacidade da taxa DESTE intent e o bloqueio
    -- derivado da sessão entram na MESMA transação que aplicou o efeito.
    perform public.autopilot_marcar_contabilidade(p_intent_id, v_i.session_id,
      v_taxa_opaca and v_i.side = 'sell' and coalesce(v_i.filled_qty, 0) > 0);
    return jsonb_build_object('ok', true, 'motivo', 'posicao_ja_encerrada',
      'aplicado_qty', v_delta_qty, 'aplicado_quote', v_delta_quote,
      'custo_removido', 0, 'fechou', false, 'pnl_realizado', v_realizado,
      'taxa_delta', v_taxa_delta, 'taxa_nao_precificada', v_taxa_opaca);
  end if;

  if v_i.side = 'buy' then
    if found then
      /**
       * ⚠️⚠️ A COMPRA NÃO MEXE NO `status` NEM EM `exit_order_id` — achado da
       * revisão adversarial.
       *
       * A primeira versão punha `status = 'open'` ("uma compra nova reabre"),
       * e deixava `exit_order_id`/`exit_armed_at` apontando para uma ordem de
       * VENDA que continua viva na corretora. `settleArmedExits` filtra por
       * `status = 'exit_armed'`: a ordem virava órfã, ninguém a liquidava, e o
       * P&L dela nunca seria realizado.
       *
       * A saída armada cobre a quantidade que ela cobria; a nova entra por
       * cima e o resto continua sendo liquidado por quem já o acompanha.
       */
      update public.autopilot_positions
         set base_amount = base_amount + v_delta_qty,
             cost_usd    = cost_usd + v_delta_quote,
             entry_price = case when (base_amount + v_delta_qty) > 0
                                then (cost_usd + v_delta_quote) / (base_amount + v_delta_qty)
                                else entry_price end,
             updated_at  = now()
       where id = v_pos.id;
    else
      insert into public.autopilot_positions
        (session_id, wallet_address, exchange_id, base, pair,
         entry_price, base_amount, cost_usd, status, entry_ts, updated_at)
      values
        (v_i.session_id, coalesce(v_i.wallet_address, ''), v_i.exchange_id, v_base,
         upper(v_i.symbol),
         case when v_delta_qty > 0 then v_delta_quote / v_delta_qty else 0 end,
         v_delta_qty, v_delta_quote, 'open', now(), now());
    end if;
    v_custo_removido := 0;
  else
    -- ── VENDA ──────────────────────────────────────────────────────────
    if not found then
      -- ⚠️ Não se inventa posição negativa nem se marca como aplicado: sem
      -- posição, esta venda não descreve inventário do bot. Fail-closed
      -- VISÍVEL — quem chama registra e um humano olha.
      return jsonb_build_object('ok', false, 'motivo', 'sem_posicao',
        'base', v_base, 'delta_qty', v_delta_qty);
    end if;
    /**
     * ⚠️⚠️⚠️ SAÍDA ARMADA PERTENCE À LIQUIDAÇÃO — achado da revisão adversarial.
     *
     * `settleArmedExits` é o ÚNICO lugar do produto que realiza P&L de uma
     * saída limitada: ele lê a ordem na corretora, chama `realizedFromSell`
     * contra a posição AINDA INTEIRA e alimenta `apply_session_pnl` (que puxa
     * o stop de perda diária). Se a projeção reduzir ou apagar a posição
     * antes, a liquidação não a encontra mais — e o prejuízo do dia
     * simplesmente não é contado. O dono descobre pelo extrato.
     *
     * ⚠️ E O PARCIAL ERA PIOR. A versão anterior limpava `status`/
     * `exit_order_id` em TODA venda projetada, inclusive num
     * `PARTIALLY_FILLED` cuja ordem continua trabalhando o restante: a passada
     * seguinte via a posição `open` e armava uma SEGUNDA venda da mesma bolsa,
     * com a primeira viva. É exatamente o desfecho que `markServerExitArmed`
     * teme por escrito.
     *
     * Enquanto houver saída armada, a projeção NÃO TOCA na posição. A
     * liquidação aplica a redução e ABSORVE o valor aqui — e o marcador
     * continua sendo a prova de exactly-once.
     */
    if v_pos.status = 'exit_armed' and v_pos.exit_order_id is not null then
      return jsonb_build_object('ok', true, 'motivo', 'saida_em_liquidacao',
        'aplicado_qty', 0, 'aplicado_quote', 0, 'fechou', false,
        'base', v_base, 'ordem_armada', v_pos.exit_order_id);
    end if;
    v_restante := v_pos.base_amount - v_delta_qty;
    if v_restante <= v_pos.base_amount * v_ruido then
      -- Saída total: a mesma semântica de `closeServerPosition` (a linha sai).
      v_custo_removido := v_pos.cost_usd;
      v_fechou := true;
      delete from public.autopilot_positions where id = v_pos.id;
    else
      -- ⚠️ CUSTO SAI EM PROPORÇÃO — a mesma convenção de `oQueSobrou`, para o
      -- P&L realizado e o custo que fica não contarem a mesma moeda duas vezes.
      v_custo_restante := v_pos.cost_usd * (v_restante / v_pos.base_amount);
      v_custo_removido := v_pos.cost_usd - v_custo_restante;
      /**
       * ⚠️ O PARCIAL NÃO DESARMA NADA. Só a quantidade e o custo mudam. Quem
       * chegou aqui com posição armada já voltou lá em cima; e limpar o elo
       * com uma ordem que pode estar viva é como nasce a segunda venda da
       * mesma bolsa.
       */
      update public.autopilot_positions
         set base_amount   = v_restante,
             cost_usd      = v_custo_restante,
             updated_at    = now()
       where id = v_pos.id;
    end if;
  end if;

  /**
   * ⚠️⚠️ O P&L REALIZADO ENTRA AQUI, NA MESMA TRANSAÇÃO — achado A138.
   *
   * Ele era uma segunda escrita (`apply_session_pnl`), e por isso não tinha
   * exactly-once: gravando o P&L e falhando a posição, a passada seguinte
   * somava o mesmo resultado; gravando a posição e falhando o P&L, o débito
   * sumia sem ninguém para retentá-lo. `pnl_aplicado_usd` é o quanto DESTE
   * intent já entrou no `pnl_today`, e só o delta é aplicado.
   *
   * ⚠️ A conta é a de sempre: recebido − custo removido − taxa. Nenhum modelo
   * contábil novo.
   */
  if v_i.side = 'sell' then
    /**
     * ⚠️⚠️ A CONTA É ACUMULADA (A142), não uma soma de deltas independentes.
     *
     * Era `v_delta_quote − custo_removido − taxa_delta`, atrás de um
     * `v_delta_quote > 0`. Quando o ACK não trazia `cost`, a posição era
     * reduzida e o resultado NÃO entrava — e a chegada do recebido, depois,
     * caía em `sem_delta`. O custo sumia da conta do dia.
     *
     * Com o acumulado, a ordem de chegada dos fatos deixa de importar: o que
     * falta é sempre `realizado_total − pnl_aplicado`.
     */
    v_custo_acum := v_e.custo_removido_usd + coalesce(v_custo_removido, 0);
    v_quote_novo := greatest(v_e.applied_quote, v_i.filled_quote);
    -- ⚠️ Sem recebido não se conta resultado — fechar a posição sem saber por
    -- quanto viraria um prejuízo de `−custo` inteiro.
    if v_quote_novo > 0 then
      v_realizado_total := v_quote_novo - v_custo_acum - v_taxa_total;
      v_realizado := v_realizado_total - v_e.pnl_aplicado_usd;
    end if;
    if v_realizado <> 0 then
      /**
       * ⚠️⚠️ O DIA É DO BANCO — achado A140 §11.
       *
       * Ele vinha do caller, e `null` fazia o `case` cair no
       * `frozen_until_day` antigo: o stop de perda cruzava e NÃO congelava. A
       * varredura de pendências chamava exatamente assim. Agora fill imediato,
       * fill tardio e recovery usam a mesma autoridade temporal.
       */
      -- ⚠️ CR-5: um escritor só, e a virada do dia mora nele.
      perform public.autopilot_aplicar_pnl(v_i.session_id, v_realizado);
    end if;
  end if;

  -- ⚠️ A RESERVA NÃO PRECISA SER "SOLTA": o compromisso vivo é
  -- `greatest(reservado − applied, 0)`, e `applied` acabou de crescer. Era o
  -- contador agregado que exigia uma subtração — e era ela que podia comer a
  -- reserva de outro intent (A137).
  update public.autopilot_position_effects
     set applied_qty        = greatest(applied_qty,  v_i.filled_qty),
         -- ⚠️ CR-2: na venda acompanha o livro nos DOIS sentidos.
         applied_quote    = case when v_i.side = 'sell' then v_i.filled_quote
                                 else greatest(applied_quote, v_i.filled_quote) end,
         ledger_qty         = greatest(ledger_qty,    v_i.filled_qty),
         ledger_quote       = greatest(ledger_quote,  v_i.filled_quote),
         -- ⚠️ A140: a taxa também é watermark. Sem isto, o próximo parcial
         -- desconta a acumulada inteira outra vez.
         fee_aplicada_usd   = greatest(fee_aplicada_usd, v_taxa_total),
         -- ⚠️ A142: e o custo que saiu da posição, para o resultado poder ser
         -- calculado quando o recebido chegar.
         custo_removido_usd = custo_removido_usd + coalesce(v_custo_removido, 0),
         pnl_aplicado_usd   = pnl_aplicado_usd + v_realizado,
         updated_at         = now()
   where intent_id = p_intent_id;

  -- ⚠️⚠️ INVARIANTE F: a opacidade da taxa DESTE intent e o bloqueio
  -- derivado da sessão entram na MESMA transação que aplicou o efeito.
  perform public.autopilot_marcar_contabilidade(p_intent_id, v_i.session_id,
    v_taxa_opaca and v_i.side = 'sell' and coalesce(v_i.filled_qty, 0) > 0);

  return jsonb_build_object(
    'ok', true, 'motivo', 'aplicado',
    'side', v_i.side, 'base', v_base,
    'aplicado_qty', v_delta_qty, 'aplicado_quote', v_delta_quote,
    'custo_removido', coalesce(v_custo_removido, 0), 'fechou', v_fechou,
    'pnl_realizado', v_realizado, 'taxa_delta', v_taxa_delta,
    'taxa_nao_precificada', v_taxa_opaca);
end; $$;

comment on function public.autopilot_projetar_efeito_do_intent(uuid) is
  'A131-C: projeta em autopilot_positions o efeito AINDA NAO APLICADO de um '
  'intent autonomo, numa transacao, por delta cumulativo (ledger - applied). '
  'Idempotente por intent; regressao e venda sem posicao falham FECHADO.';

-- ── 3-BIS. AS RESERVAS DE INVENTÁRIO (A134 / A135) ────────────────────────
--
-- ⚠️⚠️⚠️ CONFERIR NÃO É RESERVAR.
--
-- A posse e a exposição eram lidas, conferidas, e só depois a ordem saía —
-- READ-THEN-ACT puro. Duas requisições simultâneas leem o MESMO estado e as
-- duas passam:
--
--     posição do bot = 0,01 · duas vendas de 0,01 → saem 0,02, e 0,01 é do dono
--     exposição 190, teto 200 · duas compras de 10 → 210 > 200
--
-- O teto DIÁRIO já era atômico (compare-and-swap, A132), e isso não substitui
-- nada: havendo duas vagas no dia, as duas ordens passam pelo contador e se
-- atropelam no inventário. São perguntas diferentes.
--
-- A reserva mora onde o dado mora, e é tomada DENTRO da transação que a
-- confere — `for update` na linha, escrita no mesmo comando. Lock em memória
-- não serve: cada invocação serverless é outro processo.
-- ⚠️⚠️⚠️ A SAÍDA ARMADA PRECISA DE IDENTIDADE HISTÓRICA — achado A139.
--
-- A posição guardava só `exit_order_id`, e a liquidação redescobria o intent
-- por `(exchange_id, external_order_id)`. Dois problemas:
--
--   · `external_order_id` NÃO é identificador global da exchange — duas contas
--     da mesma corretora podem trazer o mesmo número, e a busca atribuiria a
--     ordem de uma à posição da outra;
--   · a liquidação consultava a venue com a credencial ATUAL da sessão. Uma
--     sessão rearmada de C1 para C2 iria perguntar a C2 por uma ordem que
--     nasceu em C1 — exatamente o que o A127 existe para impedir.
--
-- O elo passa a ser o intent, que já carrega `conexao_id` histórico.
alter table public.autopilot_positions
  add column if not exists exit_intent_id uuid
    references public.cex_execution_intents(id) on delete set null;

comment on column public.autopilot_positions.exit_intent_id is
  'A139: o intent EXATO da ordem de saida armada. A liquidacao carrega a '
  'credencial por intent.conexao_id (A127), nunca pela sessao atual.';

-- ⚠️⚠️ NÃO EXISTE MAIS PRAZO DE RESERVA, e a ausência é o conserto.
--
-- A versão anterior expirava a reserva em 10 minutos "para não trancar a
-- posição". Só que o que ela trancava não era um fantasma: era uma ordem
-- possivelmente VIVA. Quem encerra um compromisso é o estado do intent —
-- `UNKNOWN`, `SUBMITTED` e `PARTIALLY_FILLED` não provam nada e seguram o
-- remanescente reservado.
--
-- ⚠️ E O ESTADO TERMINAL NÃO ZERA SOZINHO (A144): só `FAILED_PRE_SUBMIT`
-- prova que nada saiu. `CANCELED` e `FILLED` provam que nada mais SAI — o que
-- já executou e ainda não foi projetado continua comprometido.

-- ── 3-PRE. A TAXA ACUMULADA EM USD, DERIVADA DO LIVRO (A140) ──────────────
--
-- ⚠️⚠️⚠️ A RECUPERAÇÃO NÃO PODE TER MEMÓRIA DA REQUISIÇÃO ORIGINAL.
--
-- A taxa em USD era calculada em TypeScript e passada como parâmetro. Quem
-- chamava do caminho imediato tinha a resposta da corretora na mão; quem
-- chamava da varredura de pendências, cinco minutos depois, não tinha — e
-- projetava com taxa ZERO. O mesmo preenchimento produzia P&L diferente
-- conforme QUEM o descobriu.
--
-- Agora a conversão mora aqui, sobre fatos duráveis (`fee_total`,
-- `fee_currency`, `filled_qty`, `filled_quote` do intent). Fill imediato,
-- fill tardio e recovery chegam ao mesmo número porque leem a mesma linha.
--
-- ⚠️ A SEMÂNTICA É A MESMA DO `taxaEmUsd` DE SEMPRE, inclusive a limitação:
--   · moeda estável           → o valor é o próprio;
--   · moeda BASE do par       → converte pelo preço médio do próprio fill;
--   · qualquer outra          → NÃO se inventa preço. Devolve `null`, e quem
--                               chama registra — o P&L sai otimista e o stop
--                               afrouxa, que é a política declarada.
--
-- ⚠️⚠️⚠️ PATCH FINAL DA MATRIZ (item 11) — `NULL` NÃO É TAXA ZERO.
--
-- A primeira linha desta função dizia:
--
--     when p_fee is null or p_fee <= 0 then 0
--
-- e juntava dois fatos que não são o mesmo. `p_fee = 0` é uma taxa
-- CONHECIDA e nula. `p_fee IS NULL` é uma taxa AINDA NÃO CONHECIDA — a
-- corretora não reportou. Devolver 0 para o segundo caso é a regra nº 33
-- desta casa violada no ponto mais caro: "não medimos" virando "medimos
-- zero", dentro do número que alimenta o stop de perda diária.
--
-- A 0059 preserva a semântica certa do outro lado (`p_fee` null não inventa
-- fee, não soma nada, não fecha a guarda de moeda). Quem a perdia era esta
-- conversão — e ela é a última coisa que o P&L realizado lê.
--
-- ⚠️ O EFEITO É EXATAMENTE O INVARIANTE F. Com `null` devolvido, quem chama
-- levanta `v_taxa_opaca`, o resultado NÃO é afirmado como exato, e
-- `autopilot_marcar_contabilidade` prende a COMPRA autônoma nos dois canais.
-- Quando a taxa chega (`fee_total = 2`, `USDT`), a conversão devolve 2, o
-- delta de −2 entra no dia, e a bandeira some sozinha.
--
-- ⚠️⚠️ CONSEQUÊNCIA DECLARADA, E ELA É REAL: hoje `cex_recalcular_intent`
-- grava `fee_total = nullif(sum(coalesce(fee,0)), 0)`. Uma ordem com taxa
-- genuinamente ZERO chega aqui como NULL, indistinguível de "ainda não
-- sei" — e passa a prender entradas novas até alguém intervir. É a direção
-- FECHADA da falha, e é de propósito: o oposto (tratar desconhecido como
-- zero) foi o que produziu este achado. Distinguir os dois exigiria mexer no
-- `cex_recalcular_intent` da 0051/0059, que está fora do escopo deste patch.
create or replace function public.autopilot_taxa_do_intent_em_usd(
  p_fee numeric, p_moeda text, p_symbol text,
  p_filled_qty numeric, p_filled_quote numeric
) returns numeric
language sql immutable as $$
  select case
    -- ⚠️ NÃO MEDIDA. Nada a converter, e nada a afirmar.
    when p_fee is null then null
    -- ⚠️ MEDIDA E NULA — fato conhecido, entra como zero de verdade.
    when p_fee <= 0 then 0
    when p_moeda is null or p_moeda = '' then null
    when upper(p_moeda) in ('USDT','USDC','USD','BUSD','DAI','TUSD','FDUSD') then p_fee
    when upper(p_moeda) = upper(split_part(replace(p_symbol, '-', '/'), '/', 1))
         and coalesce(p_filled_qty, 0) > 0 and coalesce(p_filled_quote, 0) > 0
      then p_fee * (p_filled_quote / p_filled_qty)
    else null
  end
$$;

comment on function public.autopilot_taxa_do_intent_em_usd(numeric, text, text, numeric, numeric) is
  'A140 + item 11: taxa acumulada do intent em USD, derivada do livro. NULL = '
  'taxa AINDA NAO CONHECIDA (fee_total null) OU moeda nao precificavel — nos '
  'dois casos o P&L nao e afirmado como exato e a COMPRA autonoma fica presa. '
  'Zero so quando a taxa e conhecida e nula.';

-- ── 3-BIS-a. O COMPROMISSO VIVO DE UM INTENT (A137 / A144) ────────────────
--
-- ⚠️ É a peça que substitui o prazo. Enquanto o intent puder preencher, o que
-- ele reservou e ainda não virou posição continua comprometido. Provado morto,
-- o compromisso é zero na mesma hora — sem esperar relógio nenhum.
--
-- ⚠️⚠️⚠️ ACHADO A144 — `CANCELED` NÃO QUER DIZER "NADA EXECUTOU".
--
-- A primeira versão mandava `CANCELED` e `FAILED_PRE_SUBMIT` para ZERO, os
-- dois juntos, como se cancelar fosse desfazer. Uma ordem limitada que vendeu
-- 0,004 de 0,01 e DEPOIS foi cancelada é terminal com fill — e o compromisso
-- dela desabava para zero antes de a projeção aplicar aquele 0,004:
--
--     posição 0,01 · A reservou 0,01, preencheu 0,004, applied 0, CANCELED
--     → compromisso 0 → B via 0,01 disponível → B vendia 0,01
--     → 0,004 + 0,01 = 0,014 vendidos de uma bolsa de 0,01.
--
-- Do lado da compra o mesmo buraco furava o TETO: reserva de 40 com 30
-- preenchido e cancelada liberava os 40 inteiros, e a entrada seguinte
-- somava exposição sobre um capital que já saiu.
--
-- ⚠️ A REGRA CERTA TEM TRÊS FAIXAS, e a diferença entre elas é o que se
-- PROVOU:
--
--   · `FAILED_PRE_SUBMIT` → a requisição não chegou à corretora. Zero, e é o
--     único zero incondicional.
--   · terminal (`FILLED`, `CANCELED`) → nada mais sai. A verdade final é o que
--     EXECUTOU: `greatest(executado − aplicado, 0)`. Cancelada sem fill dá
--     zero pela própria conta; `FILLED` já projetado, idem.
--   · qualquer outro estado → ainda pode preencher, e o RESERVADO continua
--     comprometido: `greatest(reservado − aplicado, 0)`.
--
-- ⚠️ `p_executado` é `filled_qty` na venda e `filled_quote` na compra — a
-- mesma unidade de `p_aplicado` (`applied_qty` / `applied_quote`). Misturar
-- as duas unidades aqui seria comparar BTC com dólar.
--
-- ⚠️⚠️⚠️ CR-1 — TERMINAL COM O NÚMERO AINDA DESCONHECIDO NÃO LIBERA NADA.
--
-- A faixa "terminal mede o EXECUTADO" estava certa para a venda, onde o
-- executado é QUANTIDADE e a quantidade é conhecida assim que há fill. Na
-- COMPRA o executado é DINHEIRO (`filled_quote`), e ele chega DEPOIS: o
-- retest independente reproduziu uma BUY `FILLED` com `filled_qty > 0` e
-- `filled_quote` ainda 0, cujo compromisso desabou para zero. A entrada
-- seguinte passou, o custo tardio chegou, e o teto de 200 virou 210.
--
-- Regra: terminal mede o executado SÓ quando o executado é conhecido. Com o
-- número ainda desconhecido, o compromisso segue sendo o RESERVADO — que é a
-- estimativa conservadora que já estava lá.
drop function if exists public.autopilot_compromisso_vivo(numeric, numeric, text);
drop function if exists public.autopilot_compromisso_vivo(numeric, numeric, text, numeric);
create or replace function public.autopilot_compromisso_vivo(
  p_reservado numeric, p_aplicado numeric, p_estado text,
  p_executado numeric,
  -- ⚠️ `true` quando o executado desta unidade JÁ é conhecido. Na venda é
  -- sempre (há fill ⇒ há quantidade); na compra, só depois do recebido.
  p_executado_conhecido boolean
) returns numeric
language sql immutable as $$
  select case
    when p_estado = 'FAILED_PRE_SUBMIT' then 0
    when p_estado in ('FILLED', 'CANCELED') and coalesce(p_executado_conhecido, true)
      then greatest(coalesce(p_executado, 0) - coalesce(p_aplicado, 0), 0)
    else greatest(coalesce(p_reservado, 0) - coalesce(p_aplicado, 0), 0)
  end
$$;

comment on function public.autopilot_compromisso_vivo(numeric, numeric, text, numeric, boolean) is
  'A144: terminal com fill ainda compromete o que EXECUTOU e nao foi projetado. '
  'CANCELED nao desfaz preenchimento parcial.';

-- ── 3-BIS-b. RESERVAR QUANTIDADE PARA VENDA AUTÔNOMA (A134/A137) ──────────
--
-- ⚠️ RECEBE O INTENT, não a sessão solta: o executor grava o intent ANTES da
-- costura de reserva, então a reserva nasce com dono. É o que impede a
-- projeção de uma ordem antiga de consumir o compromisso de uma nova.
create or replace function public.autopilot_reservar_venda_do_intent(
  p_intent_id uuid, p_qty numeric
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_i record; v_pos record; v_base text;
  v_comprometido numeric; v_disponivel numeric; v_conceder numeric;
begin
  if p_qty is null or not (p_qty > 0) then
    return jsonb_build_object('ok', false, 'motivo', 'quantidade_invalida');
  end if;
  select * into v_i from public.cex_execution_intents where id = p_intent_id for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'intent_inexistente'); end if;
  if v_i.simulated then return jsonb_build_object('ok', false, 'motivo', 'simulado'); end if;
  if v_i.side <> 'sell' then return jsonb_build_object('ok', false, 'motivo', 'intent_nao_e_venda'); end if;
  if v_i.origin not in ('autopilot_browser', 'autopilot_cron') or v_i.autonomous is not true then
    return jsonb_build_object('ok', false, 'motivo', 'origem_nao_autonoma');
  end if;
  if v_i.session_id is null then return jsonb_build_object('ok', false, 'motivo', 'sem_sessao'); end if;

  v_base := upper(split_part(replace(v_i.symbol, '-', '/'), '/', 1));

  select * into v_pos from public.autopilot_positions
   where session_id = v_i.session_id and base = v_base for update;
  if not found or v_pos.status = 'closed' or not (v_pos.base_amount > 0) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_posicao');
  end if;
  if v_pos.status = 'exit_armed' then
    return jsonb_build_object('ok', false, 'motivo', 'saida_ja_armada',
      'ordem_armada', v_pos.exit_order_id);
  end if;

  -- ⚠️ O QUE OUTROS INTENTS JÁ PROMETERAM. A linha da posição está travada, e
  -- esta soma roda dentro da mesma transação: duas reservas concorrentes se
  -- enfileiram, e a segunda vê a primeira.
  -- ⚠️ A144: na venda a unidade é BASE — `filled_qty` contra `applied_qty`.
  select coalesce(sum(public.autopilot_compromisso_vivo(
           e.reservado_qty, e.applied_qty, i.state::text, i.filled_qty,
           -- na venda o executado é quantidade, conhecida junto com o fill
           true)), 0)
    into v_comprometido
    from public.autopilot_position_effects e
    join public.cex_execution_intents i on i.id = e.intent_id
   where e.session_id = v_i.session_id and e.base = v_base and e.side = 'sell'
     and e.intent_id <> p_intent_id;

  v_disponivel := v_pos.base_amount - v_comprometido;
  if v_disponivel <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'quantidade_ja_reservada',
      'na_posicao', v_pos.base_amount, 'comprometido', v_comprometido);
  end if;

  -- ⚠️ LIMITA em vez de recusar (A131): vender só o que é do bot.
  v_conceder := least(p_qty, v_disponivel);

  insert into public.autopilot_position_effects
    (intent_id, session_id, exchange_id, base, side, reservado_qty)
  values (p_intent_id, v_i.session_id, v_i.exchange_id, v_base, 'sell', v_conceder)
  on conflict (intent_id) do update set reservado_qty = excluded.reservado_qty,
                                        updated_at = now();

  return jsonb_build_object('ok', true, 'qtd', v_conceder,
    'limitada', (v_conceder < p_qty), 'na_posicao', v_pos.base_amount);
end; $$;

-- ── 3-BIS-c. RESERVAR CAPITAL PARA ENTRADA AUTÔNOMA (A135/A137) ───────────
create or replace function public.autopilot_reservar_exposicao_do_intent(
  p_intent_id uuid, p_usd numeric, p_teto numeric
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_i record; v_s record; v_comprometido numeric; v_exposicao numeric;
begin
  if p_usd is null or not (p_usd > 0) then
    return jsonb_build_object('ok', false, 'motivo', 'nocional_nao_mensuravel');
  end if;
  if p_teto is null or not (p_teto > 0) then
    return jsonb_build_object('ok', false, 'motivo', 'teto_invalido');
  end if;
  select * into v_i from public.cex_execution_intents where id = p_intent_id for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'intent_inexistente'); end if;
  if v_i.simulated then return jsonb_build_object('ok', false, 'motivo', 'simulado'); end if;
  if v_i.side <> 'buy' then return jsonb_build_object('ok', false, 'motivo', 'intent_nao_e_compra'); end if;
  if v_i.origin not in ('autopilot_browser', 'autopilot_cron') or v_i.autonomous is not true then
    return jsonb_build_object('ok', false, 'motivo', 'origem_nao_autonoma');
  end if;
  if v_i.session_id is null then return jsonb_build_object('ok', false, 'motivo', 'sem_sessao'); end if;

  -- ⚠️ A LINHA DA SESSÃO É O PONTO DE SERIALIZAÇÃO das entradas concorrentes.
  select * into v_s from public.autopilot_sessions where id = v_i.session_id for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sessao_inexistente'); end if;

  select coalesce(sum(cost_usd), 0) into v_exposicao
    from public.autopilot_positions
   where session_id = v_i.session_id and status <> 'closed';

  -- ⚠️ A144: na compra a unidade é QUOTE — `filled_quote` contra
  -- `applied_quote`. É o capital que já saiu e ainda não virou custo no livro.
  select coalesce(sum(public.autopilot_compromisso_vivo(
           e.reservado_usd, e.applied_quote, i.state::text, i.filled_quote,
           -- ⚠️ CR-1: na COMPRA o executado é dinheiro, e ele pode não ter
           -- chegado. Executou quantidade sem recebido = custo DESCONHECIDO.
           not (coalesce(i.filled_qty, 0) > 0 and coalesce(i.filled_quote, 0) <= 0)
         )), 0)
    into v_comprometido
    from public.autopilot_position_effects e
    join public.cex_execution_intents i on i.id = e.intent_id
   where e.session_id = v_i.session_id and e.side = 'buy'
     and e.intent_id <> p_intent_id;

  if v_exposicao + v_comprometido + p_usd > p_teto then
    return jsonb_build_object('ok', false, 'motivo', 'teto_estourado',
      'exposicao', v_exposicao, 'comprometido', v_comprometido, 'teto', p_teto);
  end if;

  insert into public.autopilot_position_effects
    (intent_id, session_id, exchange_id, base, side, reservado_usd)
  values (p_intent_id, v_i.session_id, v_i.exchange_id,
          upper(split_part(replace(v_i.symbol, '-', '/'), '/', 1)), 'buy', p_usd)
  on conflict (intent_id) do update set reservado_usd = excluded.reservado_usd,
                                        updated_at = now();

  return jsonb_build_object('ok', true, 'exposicao', v_exposicao,
    'comprometido', v_comprometido + p_usd, 'teto', p_teto);
end; $$;

-- ── 3-BIS-d. DEVOLVER (só na recusa PROVADA) ──────────────────────────────
--
-- ⚠️ ZERA O COMPROMISSO DESTE INTENT, e de nenhum outro — era isso que o
-- contador agregado não sabia fazer.
create or replace function public.autopilot_liberar_reserva_do_intent(
  p_intent_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.autopilot_position_effects
     set reservado_qty = 0, reservado_usd = 0, updated_at = now()
   where intent_id = p_intent_id;
  return jsonb_build_object('ok', true);
end; $$;

-- ── 3-TER. A LIQUIDAÇÃO DA SAÍDA ARMADA, NUMA TRANSAÇÃO (A136) ────────────
--
-- ⚠️⚠️⚠️ ERAM DUAS ESCRITAS, E QUALQUER ORDEM DELAS PERDIA.
--
-- `settleArmedExits` lê a ordem na corretora e aplica a redução direto, porque
-- o P&L realizado é calculado contra a posição AINDA INTEIRA. Ela precisava
-- registrar isso no marcador para a reconciliação não reduzir de novo — e as
-- duas escritas eram separadas:
--
--   marcador OK + posição falha  → marcador diz "aplicado", a posição continua
--                                  cheia, e a reconciliação vê delta zero para
--                                  sempre: a venda nunca entra no livro;
--   posição OK + marcador falha  → a posição já reduziu e o marcador ficou
--                                  atrás: a reconciliação reduz DE NOVO.
--
-- Inverter a ordem só troca qual dos dois cenários acontece. Telemetria alta
-- não conserta exactly-once. Aqui as duas viram uma.
--
-- ⚠️ E ELA PODE TOCAR NUMA POSIÇÃO ARMADA — é a única que pode. A projeção
-- pela reconciliação devolve `saida_em_liquidacao` justamente para deixar esta
-- função ser a dona daquela redução.
create or replace function public.autopilot_liquidar_saida_armada(
  p_intent_id uuid,
  -- ⚠️ O que a CORRETORA disse que saiu. É a única entrada de quantidade que
  -- não vem do livro, e existe porque a liquidação acontece ANTES de os fills
  -- serem ingeridos.
  p_qty_vendida numeric,
  p_quote_recebido numeric
  -- ⚠️ A140: taxa e dia saíram dos parâmetros. Ela é derivada do livro e ele
  -- do relógio do banco — o mesmo para liquidação, projeção e recovery.
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_i record; v_e record; v_pos record; v_base text;
  v_delta numeric; v_delta_quote numeric; v_realizado numeric := 0;
  v_restante numeric; v_custo_restante numeric; v_custo_removido numeric := 0;
  v_fechou boolean := false;
  v_taxa_total numeric; v_taxa_delta numeric := 0; v_taxa_opaca boolean := false;
  v_custo_acum numeric := 0; v_quote_novo numeric := 0;
  v_realizado_total numeric := 0; v_hoje text;
  v_eps constant numeric := 1e-12;
  v_ruido constant numeric := 1e-9;
begin
  if p_qty_vendida is null or not (p_qty_vendida > 0) then
    return jsonb_build_object('ok', false, 'motivo', 'quantidade_invalida');
  end if;

  select * into v_i from public.cex_execution_intents where id = p_intent_id for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'intent_inexistente'); end if;
  if v_i.simulated then return jsonb_build_object('ok', false, 'motivo', 'simulado'); end if;
  if v_i.side <> 'sell' then return jsonb_build_object('ok', false, 'motivo', 'intent_nao_e_venda'); end if;
  if v_i.origin not in ('autopilot_browser', 'autopilot_cron') or v_i.autonomous is not true then
    return jsonb_build_object('ok', false, 'motivo', 'origem_nao_autonoma');
  end if;
  if v_i.session_id is null then return jsonb_build_object('ok', false, 'motivo', 'sem_sessao'); end if;

  v_base := upper(split_part(replace(v_i.symbol, '-', '/'), '/', 1));

  /**
   * ⚠️ O MARCADOR VEM ANTES DA POSIÇÃO, e a ordem importa: repetir uma
   * liquidação já aplicada é NO-OP, não erro. Depois que ela reduz, a posição
   * deixa de estar armada — conferir o armamento primeiro faria a segunda
   * chamada (uma retentativa legítima) parecer divergência.
   */
  insert into public.autopilot_position_effects
    (intent_id, session_id, exchange_id, base, side)
  values (p_intent_id, v_i.session_id, v_i.exchange_id, v_base, v_i.side)
  on conflict (intent_id) do nothing;
  select * into v_e from public.autopilot_position_effects
   where intent_id = p_intent_id for update;

  v_delta := p_qty_vendida - v_e.applied_qty;
  -- ⚠️ A140: a taxa acumulada vem do LIVRO, e tem delta próprio.
  v_taxa_total := public.autopilot_taxa_do_intent_em_usd(
    v_i.fee_total, v_i.fee_currency, v_i.symbol, v_i.filled_qty, v_i.filled_quote);
  if v_taxa_total is null then
    v_taxa_opaca := true;
    v_taxa_total := v_e.fee_aplicada_usd;
  end if;
  v_taxa_delta := v_taxa_total - v_e.fee_aplicada_usd;
  if v_taxa_delta < -v_eps then
    return jsonb_build_object('ok', false, 'motivo', 'regressao_de_taxa',
      'aplicado', v_e.fee_aplicada_usd, 'no_livro', v_taxa_total);
  end if;
  /**
   * ⚠️⚠️ A MESMA GUARDA DO RECEBIDO (auditoria sintético→real). Desde o A143
   * `p_quote_recebido` vem do LIVRO, e o livro pode REGREDIR quando os trades
   * reais substituem o sintético superestimado. Os dois `greatest(applied,
   * recebido)` abaixo manteriam o P&L no valor antigo — otimista — e o stop
   * de perda com ele. Divergência não se absorve: fail-closed.
   */
  -- ⚠️ CR-2: a guarda de regressão de quote saiu daqui. A liquidação é de
  -- VENDA, e na venda a queda do recebido é CORRIGIDA pela conta acumulada
  -- (o custo removido não muda; só a receita muda). Fechar a porta aqui era
  -- preservar receita que não existiu.
  if v_delta <= v_eps and v_taxa_delta <= v_eps then
    -- ⚠️⚠️ INVARIANTE F (a liquidação é sempre de VENDA — conferido acima).
    perform public.autopilot_marcar_contabilidade(p_intent_id, v_i.session_id,
      v_taxa_opaca and coalesce(v_i.filled_qty, 0) > 0);
    return jsonb_build_object('ok', true, 'motivo', 'sem_delta',
      'aplicado_qty', 0, 'custo_removido', 0, 'fechou', false, 'pnl_realizado', 0,
      'taxa_nao_precificada', v_taxa_opaca);
  end if;
  if v_delta <= v_eps then
    -- ⚠️ Ajuste sem quantidade (A140 §7 / A142): nada a reduzir, e o P&L muda.
    v_quote_novo := v_i.filled_quote;   -- ⚠️ CR-2: o livro manda
    if v_quote_novo > 0 then
      v_realizado_total := v_quote_novo - v_e.custo_removido_usd - v_taxa_total;
      v_realizado := v_realizado_total - v_e.pnl_aplicado_usd;
    end if;
    -- ⚠️ CR-5: um escritor só, e a virada do dia mora nele.
    perform public.autopilot_aplicar_pnl(v_i.session_id, v_realizado);
    update public.autopilot_position_effects
       set fee_aplicada_usd = v_taxa_total,
           -- ⚠️ CR-2: o LIVRO manda — `p_quote_recebido` é vestigial.
           applied_quote    = v_i.filled_quote,
           pnl_aplicado_usd = pnl_aplicado_usd + v_realizado,
           updated_at       = now()
     where intent_id = p_intent_id;
    -- ⚠️⚠️ INVARIANTE F (a liquidação é sempre de VENDA — conferido acima).
    perform public.autopilot_marcar_contabilidade(p_intent_id, v_i.session_id,
      v_taxa_opaca and coalesce(v_i.filled_qty, 0) > 0);
    return jsonb_build_object('ok', true, 'motivo', 'ajuste_sem_quantidade',
      'aplicado_qty', 0, 'custo_removido', 0, 'fechou', false,
      'pnl_realizado', v_realizado, 'taxa_delta', v_taxa_delta,
      'taxa_nao_precificada', v_taxa_opaca);
  end if;
  v_delta_quote := greatest(coalesce(p_quote_recebido, 0) - v_e.applied_quote, 0);

  select * into v_pos from public.autopilot_positions
   where session_id = v_i.session_id and base = v_base for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sem_posicao', 'base', v_base);
  end if;

  /**
   * ⚠️⚠️⚠️ A IDENTIDADE DA SAÍDA É CONFERIDA AQUI — achado A139.
   *
   * A liquidação redescobria o intent por `(exchange_id, external_order_id)`,
   * e `external_order_id` NÃO é identificador global: duas contas da mesma
   * corretora podem trazer o mesmo número, e a ordem de uma seria atribuída à
   * posição da outra. Agora o elo é o intent gravado ao ARMAR, e cada peça é
   * conferida contra ele. Qualquer divergência: FALHA FECHADA.
   *
   * ⚠️ LEGADO SEM `exit_intent_id` NÃO É ADIVINHADO. Uma posição armada antes
   * desta migration não tem elo — e procurar por número de ordem é exatamente
   * o que o achado proíbe. Ela vira caso de reconciliação humana.
   */
  if v_pos.status <> 'exit_armed' then
    return jsonb_build_object('ok', false, 'motivo', 'posicao_nao_armada',
      'status', v_pos.status);
  end if;
  if v_pos.exit_intent_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'saida_sem_identidade',
      'base', v_base, 'ordem_armada', v_pos.exit_order_id);
  end if;
  if v_pos.exit_intent_id <> p_intent_id then
    return jsonb_build_object('ok', false, 'motivo', 'intent_nao_e_a_saida_armada',
      'esperado', v_pos.exit_intent_id);
  end if;
  if v_i.exchange_id <> v_pos.exchange_id then
    return jsonb_build_object('ok', false, 'motivo', 'corretora_divergente');
  end if;
  /**
   * ⚠️⚠️ NULL TAMBÉM É DIVERGÊNCIA — hardening do A139.
   *
   * A condição exigia que os DOIS fossem não-nulos para comparar. Uma posição
   * armada em `ABC` com o intent sem `external_order_id` passava — e é
   * exatamente o estado de quem ainda não sabe qual ordem está lá fora. Uma
   * saída ARMADA tem identidade ou não é liquidada: `is distinct from` cobre
   * null↔valor nos dois sentidos.
   */
  if v_i.external_order_id is distinct from v_pos.exit_order_id then
    return jsonb_build_object('ok', false, 'motivo', 'ordem_externa_divergente',
      'na_posicao', v_pos.exit_order_id, 'no_intent', v_i.external_order_id);
  end if;

  v_restante := v_pos.base_amount - v_delta;
  if v_restante <= v_pos.base_amount * v_ruido then
    v_custo_removido := v_pos.cost_usd;
    v_fechou := true;
    delete from public.autopilot_positions where id = v_pos.id;
  else
    v_custo_restante := v_pos.cost_usd * (v_restante / v_pos.base_amount);
    v_custo_removido := v_pos.cost_usd - v_custo_restante;
    update public.autopilot_positions
       set base_amount    = v_restante,
           cost_usd       = v_custo_restante,
           -- ⚠️ A ordem armada ACABOU de ser resolvida por quem chama (ela leu
           -- a corretora). O remanescente precisa poder armar de novo — e este
           -- é o único caminho que tem essa prova.
           status         = 'open',
           exit_order_id  = null,
           exit_armed_at  = null,
           exit_intent_id = null,
           updated_at     = now()
     where id = v_pos.id;
  end if;

  /**
   * ⚠️⚠️ A138/A140/A142: conta ACUMULADA, e o dia vem do banco.
   *
   * Era `v_delta_quote − v_custo_removido − v_taxa_delta`, INCONDICIONAL. A
   * liquidação recebe o recebido da corretora, e ele chega `0` quando o ACK
   * não traz `cost` (`order.cost` → `Number.isFinite(quote) ? quote : 0`).
   * A conta virava `0 − 600 − 0` e a sessão levava um prejuízo de US$ 600 que
   * não existiu — congelando o dia inteiro pelo stop de perda.
   *
   * Sem recebido, o custo removido fica GUARDADO e o resultado espera o livro.
   */
  v_custo_acum := v_e.custo_removido_usd + v_custo_removido;
  v_quote_novo := v_i.filled_quote;   -- ⚠️ CR-2: o livro manda
  if v_quote_novo > 0 then
    v_realizado_total := v_quote_novo - v_custo_acum - v_taxa_total;
    v_realizado := v_realizado_total - v_e.pnl_aplicado_usd;
  end if;
    -- ⚠️ CR-5: um escritor só, e a virada do dia mora nele.
    perform public.autopilot_aplicar_pnl(v_i.session_id, v_realizado);

  update public.autopilot_position_effects
     set applied_qty        = greatest(applied_qty, p_qty_vendida),
         -- ⚠️ CR-2: o LIVRO manda — `p_quote_recebido` é vestigial.
         applied_quote      = v_i.filled_quote,
         fee_aplicada_usd   = greatest(fee_aplicada_usd, v_taxa_total),
         custo_removido_usd = custo_removido_usd + v_custo_removido,
         pnl_aplicado_usd   = pnl_aplicado_usd + v_realizado,
         updated_at         = now()
   where intent_id = p_intent_id;

  -- ⚠️⚠️ INVARIANTE F (a liquidação é sempre de VENDA — conferido acima).
  perform public.autopilot_marcar_contabilidade(p_intent_id, v_i.session_id,
    v_taxa_opaca and coalesce(v_i.filled_qty, 0) > 0);

  return jsonb_build_object('ok', true, 'motivo', 'aplicado',
    'aplicado_qty', v_delta, 'aplicado_quote', v_delta_quote,
    'custo_removido', v_custo_removido, 'fechou', v_fechou, 'base', v_base,
    'pnl_realizado', v_realizado, 'taxa_delta', v_taxa_delta,
    'taxa_nao_precificada', v_taxa_opaca);
end; $$;

comment on function public.autopilot_liquidar_saida_armada(uuid, numeric, numeric) is
  'A136: reduz/fecha a posicao de uma saida armada E avanca o marcador na MESMA '
  'transacao. Antes eram duas escritas, e qualquer ordem delas quebrava '
  'exactly-once.';

-- ══════════════════════════════════════════════════════════════════════════
-- A FRONTEIRA FINAL — O ESTADO FINANCEIRO NA MESMA TRANSAÇÃO DO SUBMITTING
--
-- ⚠️⚠️⚠️ BLOCKER DO RETEST INDEPENDENTE (I11/I12).
--
-- `cex_autorizar_e_submeter` era a autoridade final antes do efeito externo —
-- ela trava o intent, confere o certificado inteiro e vira `SUBMITTING` numa
-- transação só. Só que ela NÃO conhecia o estado financeiro da sessão.
--
-- O precheck (`autorizarAumentoDeExposicao`) lê o banco imediatamente antes
-- das reservas, nos dois canais. Entre aquele `select` e esta transação ainda
-- cabe um writer financeiro comitando:
--
--     T0  precheck: pnl −49, sem freeze → PASSA
--     T1  recovery COMITA: pnl −51, freeze = hoje
--     T2  cex_autorizar_e_submeter  ← não olhava nada disso
--     T3  SUBMITTING
--     T4  createOrder
--
-- A janela ficou pequena depois das correções anteriores. Pequena não é
-- fechada, e a propriedade que um autopilot com dinheiro real precisa é
-- categórica: se o loss-stop já foi atingido e COMITADO antes da autorização
-- final, nenhuma COMPRA nova sai. Isso só é demonstrável se o estado
-- financeiro for lido na MESMA transação que autoriza.
--
-- ⚠️ A 0060 NÃO É ALTERADA (ela pode já ter sido aplicada). A função é
-- REDEFINIDA aqui, com a mesma assinatura — o mesmo padrão que a 0064 já usa
-- para as RPCs da 0059.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.cex_autorizar_e_submeter(
  p_intent_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_intent public.cex_execution_intents%rowtype;
  v_cert   public.strategy_certificates%rowtype;
  v_teto   numeric;
  v_s      public.autopilot_sessions%rowtype;
  v_hoje   text;
  v_virou  boolean;
  v_pnl    numeric;
  v_freeze text;
begin
  -- ⚠️⚠️ O INTENT É A AUTORIDADE SOBRE TUDO. A RPC não acredita em parâmetro
  -- NENHUM sobre a ordem: lê `autonomous`, `side`, `simulated`, `strategy_id`,
  -- `strategy_version`, `certificate_id`, `exchange_id` (venue), `symbol`,
  -- `requested_notional_usd` (nocional) e `strategy_hash` da própria linha,
  -- sob lock. O caller não tem COMO mentir: a assinatura não recebe nada além
  -- do id.
  select * into v_intent from public.cex_execution_intents
   where id = p_intent_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'porque', 'intent nao existe');
  end if;

  if v_intent.state not in ('AUTHORIZED', 'RESERVED') then
    return jsonb_build_object('ok', false,
      'porque', 'estado ' || v_intent.state || ' nao admite submissao');
  end if;

  -- ── A VALIDAÇÃO — só entrada autônoma com dinheiro de verdade ─────────
  -- Manual tem um humano como sujeito; simulado não move dinheiro; SELL é a
  -- exceção documentada no cabeçalho. Todo o resto deste caminho exige
  -- certificado VIVO e COERENTE, conferido aqui, não na rota.
  if v_intent.autonomous and v_intent.side = 'buy' and not v_intent.simulated then
    /**
     * ⚠️⚠️⚠️ O ESTADO FINANCEIRO ENTRA NA AUTORIZAÇÃO FINAL — blocker do
     * retest independente.
     *
     * O precheck financeiro (`autorizarAumentoDeExposicao`, nos dois canais)
     * lê o banco imediatamente antes das reservas. Entre esse `select` e ESTA
     * transação ainda cabe um writer financeiro: o recovery aplica P&L e
     * congela o dia, a projeção levanta `contabilidade_incompleta_em`, a
     * reconciliação grava quarentena. Tudo isso COMITA antes do SUBMITTING —
     * e a autorização final não sabia de nada disso.
     *
     * A janela era pequena. Pequena não é fechada: a propriedade que o
     * produto precisa é "se o loss-stop já foi atingido e COMITADO antes da
     * autorização final, nenhuma BUY nova sai". Só dá para afirmar isso se o
     * estado financeiro for lido na MESMA transação que vira RESERVED →
     * SUBMITTING.
     *
     * ⚠️ ORDEM DOS LOCKS: intent (acima) → sessão. É a mesma ordem de
     * `autopilot_reservar_exposicao_do_intent` e da cadeia
     * projeção/liquidação → `autopilot_aplicar_pnl`. Inverter aqui criaria
     * deadlock com elas.
     *
     * ⚠️ E O LOCK NÃO ATRAVESSA HTTP: esta transação COMMITA antes de o
     * executor chamar `createOrder`.
     *
     * ⚠️ ESCOPO: só as origens do autopilot. DCA é `autonomous` também e não
     * tem linha em `autopilot_sessions` — o gate financeiro dele é outro, e
     * prendê-lo aqui seria quebrar um produto para consertar o outro.
     */
    if v_intent.origin in ('autopilot_browser', 'autopilot_cron') then
      if v_intent.session_id is null then
        return jsonb_build_object('ok', false,
          'porque', 'compra autonoma do autopilot sem sessao — sem ela nao se afirma limite nenhum');
      end if;
      select * into v_s from public.autopilot_sessions
       where id = v_intent.session_id for update;
      if not found then
        return jsonb_build_object('ok', false, 'porque', 'sessao do piloto inexistente');
      end if;

      -- ⚠️ Contador e congelamento de ONTEM não valem hoje. Quem carimba o
      -- dia é `autopilot_aplicar_pnl`, junto do resultado.
      v_hoje   := (current_timestamp at time zone 'UTC')::date::text;
      v_virou  := v_s.last_reset_day is not distinct from v_hoje;
      v_pnl    := case when v_virou then coalesce(v_s.pnl_today, 0) else 0 end;
      v_freeze := case when v_virou then v_s.frozen_until_day else null end;

      if not v_s.is_active then
        return jsonb_build_object('ok', false, 'porque', 'sessao do piloto PARADA');
      end if;
      if v_s.expires_at is null or v_s.expires_at <= now() then
        return jsonb_build_object('ok', false, 'porque', 'sessao do piloto expirada');
      end if;
      if v_freeze is not distinct from v_hoje then
        return jsonb_build_object('ok', false,
          'porque', 'sessao congelada hoje pelo stop de perda diaria');
      end if;
      -- ⚠️ O NÚMERO, não só a marca: o freeze pode ter ficado para trás.
      if coalesce(v_s.daily_loss_stop_usd, 0) > 0
         and v_pnl <= -v_s.daily_loss_stop_usd then
        return jsonb_build_object('ok', false,
          'porque', 'stop de perda ja atingido: pnl_today ' || v_pnl::text
                    || ' contra ' || v_s.daily_loss_stop_usd::text);
      end if;
      if v_s.contabilidade_incompleta_em is not null then
        return jsonb_build_object('ok', false,
          'porque', 'contabilidade incompleta desde '
                    || v_s.contabilidade_incompleta_em::text
                    || ' — o P&L realizado nao e afirmavel');
      end if;
      if v_s.quarentena_em is not null then
        return jsonb_build_object('ok', false,
          'porque', 'sessao em quarentena por deriva de inventario');
      end if;
    end if;

    if v_intent.certificate_id is null then
      return jsonb_build_object('ok', false,
        'porque', 'compra autonoma sem certificate_id — a constraint falhou ou foi contornada');
    end if;

    select * into v_cert from public.strategy_certificates
     where id = v_intent.certificate_id;
    if not found then
      return jsonb_build_object('ok', false, 'porque', 'certificado inexistente');
    end if;
    -- ⚠️ INVARIANTE 14, agora no limiar: revogar fecha a torneira NA HORA,
    -- não na próxima passada da rota.
    if v_cert.revoked_at is not null then
      return jsonb_build_object('ok', false,
        'porque', 'certificado revogado em ' || v_cert.revoked_at::text);
    end if;
    if v_cert.valid_from > now() then
      return jsonb_build_object('ok', false, 'porque', 'certificado ainda nao vigente');
    end if;
    if v_cert.valid_until is not null and v_cert.valid_until <= now() then
      return jsonb_build_object('ok', false,
        'porque', 'certificado expirou em ' || v_cert.valid_until::text);
    end if;
    -- ⚠️ O certificado é da MESMA estratégia/versão do intent? A FK garante
    -- que o id existe; NÃO garante que aponta para a estratégia certa.
    if v_cert.strategy_id is distinct from v_intent.strategy_id
       or v_cert.strategy_version is distinct from v_intent.strategy_version then
      return jsonb_build_object('ok', false,
        'porque', 'certificado de outra estrategia ou versao');
    end if;
    -- ⚠️ O hash amarra o certificado ao conteúdo dos parâmetros. Agora ele
    -- vem DO INTENT (gravado na criação, do ctx do caller legítimo) — ausente
    -- ou divergente, a evidência é de outra hipótese, e não medimos não passa.
    if v_intent.strategy_hash is null or v_intent.strategy_hash <> v_cert.strategy_hash then
      return jsonb_build_object('ok', false, 'porque', 'strategy_hash nao confere');
    end if;
    -- ⚠️ VENUE E SÍMBOLO VÊM DO INTENT. O certificado é conferido contra o
    -- que foi gravado antes de qualquer efeito externo — não contra o que
    -- alguém afirmou no instante da submissão.
    if not (v_intent.exchange_id = any(v_cert.allowed_venues)) then
      return jsonb_build_object('ok', false,
        'porque', 'venue ' || coalesce(v_intent.exchange_id, '?') || ' fora do certificado');
    end if;
    if not (v_intent.symbol = any(v_cert.allowed_symbols)) then
      return jsonb_build_object('ok', false,
        'porque', 'simbolo ' || coalesce(v_intent.symbol, '?') || ' fora do certificado');
    end if;
    -- ⚠️ O teto é o envelope da evidência, contra o nocional DURÁVEL do
    -- intent. Com teto definido, nocional desconhecido NÃO passa — "não
    -- medimos" nunca vira "cabe".
    v_teto := nullif(v_cert.risk_limits ->> 'maxTradeUsd', '')::numeric;
    if v_teto is not null and (v_intent.requested_notional_usd is null
       or v_intent.requested_notional_usd > v_teto) then
      return jsonb_build_object('ok', false,
        'porque', 'nocional ' || coalesce(v_intent.requested_notional_usd::text, 'desconhecido')
                  || ' acima do teto certificado ' || v_teto::text);
    end if;
  end if;

  -- ── A SUBMISSÃO — mesma autoridade da `cex_transicionar` ──────────────
  -- A legalidade da transição continua sendo decidida por UMA função. Esta
  -- RPC não abre um segundo critério de máquina de estados.
  if not public.cex_transicao_permitida(v_intent.state, 'SUBMITTING') then
    return jsonb_build_object('ok', false, 'de', v_intent.state,
      'porque', 'transicao proibida para SUBMITTING');
  end if;

  update public.cex_execution_intents
     set state         = 'SUBMITTING',
         submitting_at = now(),
         updated_at    = now()
   where id = p_intent_id;

  return jsonb_build_object('ok', true, 'de', v_intent.state, 'para', 'SUBMITTING');
end; $$;

comment on function public.cex_autorizar_e_submeter(uuid) is
  'Autorizacao final transacional (A110 round 3) + ESTADO FINANCEIRO DA SESSAO '
  '(Round 9, blocker do retest): trava o intent E a sessao do piloto, confere '
  'certificado, freeze, stop de perda pelo NUMERO, contabilidade incompleta e '
  'quarentena, e so entao vira SUBMITTING. Fecha o TOCTOU entre o precheck '
  'financeiro e o ponto sem volta. DCA/manual/simulado/SELL seguem isentos.';

-- ── 4. AS PENDÊNCIAS — PORQUE `FILLED` É TERMINAL ─────────────────────────
--
-- ⚠️⚠️⚠️ ACHADO DA REVISÃO ADVERSARIAL DO ROUND 9.
--
-- A projeção pode falhar no momento em que o dinheiro se move: banco fora,
-- timeout, RPC ainda não aplicada. O comentário da rota prometia que "a
-- reconciliação chama a MESMA RPC e aplica o delta que faltar" — e isso era
-- FALSO para o caso mais comum: uma compra a mercado que preenche na hora vira
-- `FILLED`, que é TERMINAL. `intentsParaReconciliar` só olha os NÃO-terminais.
-- Ninguém voltava naquele intent. O bot comprava e nunca saberia que possui.
--
-- Esta função é a varredura que faltava: intents autônomos com execução no
-- livro cuja projeção está atrasada (marcador ausente, ou `applied` abaixo do
-- `filled_qty`). O cron chama, projeta cada um, e a idempotência do marcador
-- garante que repetir não some nada.
--
-- ⚠️ JANELA CURTA DE PROPÓSITO: três dias. Mais que isso não é pendência de
-- projeção, é inventário para conferir com mão humana — e varrer o histórico
-- inteiro a cada 5 minutos seria um `seq scan` no caminho do dinheiro.
-- ⚠️⚠️⚠️ TERMINAL DE ORDEM NÃO É TERMINAL DE CONTABILIDADE.
--
-- `autopilot_projecoes_pendentes` (a versão anterior desta função) só sabia
-- comparar o LIVRO com a POSIÇÃO: "o intent executou mais do que já foi
-- projetado?". Ela nunca enxergava o caso em que o próprio LIVRO está
-- incompleto — `fee_total` NULL porque o `fetchOrder` da venue não traz
-- comissão, que é a forma normal de várias corretoras no ccxt.
--
-- O desfecho era um estado ABSORVENTE, e ele contradizia três invariantes de
-- uma vez:
--
--   · o intent vira `FILLED`, que não está em `PRECISAM_RECONCILIAR` — o
--     recuperador de intents nunca volta nele;
--   · `ingerirTrades` (o único caminho que traz a fee real) só é alcançado de
--     dentro daquele recuperador;
--   · esta varredura não o relistava, porque `coalesce(taxa(...), aplicada) >
--     aplicada` é FALSO quando a taxa é desconhecida.
--
-- Resultado: a sessão ficava bloqueada para COMPRA para sempre, e nada no
-- sistema ia buscar o que faltava. Fail-closed sem soltura não é recovery —
-- é uma parada permanente com aparência de segurança.
--
-- ⚠️ A FUNÇÃO AGORA RESPONDE DUAS PERGUNTAS, e a segunda é a que faltava:
--
--   `precisa_venue = false` → a projeção está atrás do livro. Basta projetar;
--                             nenhuma chamada externa é necessária.
--   `precisa_venue = true`  → o LIVRO está incompleto. Projetar de novo não
--                             adianta: é preciso perguntar à corretora (com a
--                             credencial HISTÓRICA do intent) e ingerir.
--
-- ⚠️⚠️ E OS DOIS BRAÇOS TÊM JANELAS DIFERENTES, de propósito. O braço da
-- projeção mantém os três dias de sempre (é volume, e atrasar um dia não
-- prende dinheiro). O braço da contabilidade incompleta NÃO tem janela: ele
-- descreve sessões PRESAS, o conjunto é pequeno por construção, e deixá-lo
-- expirar em três dias seria condenar a sessão ao bloqueio eterno — o mesmo
-- defeito com um relógio em cima.
create or replace function public.autopilot_pendencias_financeiras(
  p_limite int default 50
)
returns table (intent_id uuid, motivo text, precisa_venue boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with candidatos as (
    select i.id,
           i.filled_qty, i.filled_quote, i.fee_total, i.fee_currency, i.symbol,
           i.updated_at,
           e.intent_id      as tem_efeito,
           coalesce(e.applied_qty, 0)       as applied_qty,
           coalesce(e.applied_quote, 0)     as applied_quote,
           coalesce(e.fee_aplicada_usd, 0)  as fee_aplicada,
           coalesce(e.custo_removido_usd,0) as custo_removido,
           coalesce(e.taxa_opaca, false)    as taxa_opaca,
           e.divergencia    as divergencia,
           e.side           as efeito_side
      from public.cex_execution_intents i
      left join public.autopilot_position_effects e on e.intent_id = i.id
     where i.simulated = false
       and i.autonomous = true
       and i.origin in ('autopilot_browser', 'autopilot_cron')
       and i.session_id is not null
       and i.filled_qty > 0
  ), avaliados as (
    select c.*,
           public.autopilot_efeito_incompleto(
             c.efeito_side, c.taxa_opaca, c.custo_removido, c.applied_quote,
             c.applied_qty, c.divergencia
           ) as livro_incompleto,
           coalesce(public.autopilot_taxa_do_intent_em_usd(
             c.fee_total, c.fee_currency, c.symbol, c.filled_qty, c.filled_quote),
             c.fee_aplicada) > c.fee_aplicada + 1e-12 as taxa_pendente
      from candidatos c
  )
  select a.id,
         case
           when a.tem_efeito is null                          then 'sem_marcador'
           when a.filled_qty   > a.applied_qty   + 1e-12      then 'quantidade_pendente'
           when a.filled_quote > a.applied_quote + 1e-12      then 'recebido_pendente'
           when a.taxa_pendente                               then 'taxa_pendente'
           when a.divergencia is not null                     then 'divergencia'
           when a.taxa_opaca                                  then 'taxa_desconhecida'
           when a.efeito_side = 'buy'                         then 'custo_desconhecido'
           else 'resultado_sem_recebido'
         end,
         -- ⚠️ Só o LIVRO incompleto justifica gastar uma chamada na corretora.
         a.livro_incompleto
    from avaliados a
   where
     -- braço 1: a projeção está atrás do livro (janela de três dias)
     ( a.updated_at > now() - interval '3 days'
       and ( a.tem_efeito is null
             or a.filled_qty   > a.applied_qty   + 1e-12
             or a.filled_quote > a.applied_quote + 1e-12
             or a.taxa_pendente ) )
     -- braço 2: o LIVRO está incompleto — sem janela, porque prende dinheiro
     or a.livro_incompleto
   order by a.livro_incompleto desc, a.updated_at asc
   limit greatest(coalesce(p_limite, 50), 0);
$$;

comment on function public.autopilot_pendencias_financeiras(int) is
  'Round 9 (fechamento): intents autonomos com efeito financeiro incompleto. '
  'Substitui autopilot_projecoes_pendentes, que so via projecao atrasada e '
  'nunca o LIVRO incompleto (fee que a venue nao reportou). `precisa_venue` '
  'diz se basta projetar ou se e preciso perguntar a corretora.';

-- ⚠️ A antiga sai de cena explicitamente: um nome vivo com semântica menor é
-- convite para alguém voltar a chamá-la e reintroduzir o buraco.
drop function if exists public.autopilot_projecoes_pendentes(int);

-- ── 5. ACL — NASCE FECHADA (lição A116) ───────────────────────────────────
revoke all on function public.autopilot_projetar_efeito_do_intent(uuid)
  from public, anon, authenticated;
grant execute on function public.autopilot_projetar_efeito_do_intent(uuid)
  to service_role;

revoke all on function public.autopilot_taxa_do_intent_em_usd(numeric, text, text, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.autopilot_taxa_do_intent_em_usd(numeric, text, text, numeric, numeric)
  to service_role;

revoke all on function public.autopilot_pendencias_financeiras(int)
  from public, anon, authenticated;
grant execute on function public.autopilot_pendencias_financeiras(int)
  to service_role;

revoke all on function public.autopilot_efeito_incompleto(text, boolean, numeric, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.autopilot_efeito_incompleto(text, boolean, numeric, numeric, numeric, text)
  to service_role;

revoke all on function public.autopilot_reservar_venda_do_intent(uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.autopilot_reservar_venda_do_intent(uuid, numeric)
  to service_role;

revoke all on function public.autopilot_reservar_exposicao_do_intent(uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.autopilot_reservar_exposicao_do_intent(uuid, numeric, numeric)
  to service_role;

revoke all on function public.autopilot_liberar_reserva_do_intent(uuid)
  from public, anon, authenticated;
grant execute on function public.autopilot_liberar_reserva_do_intent(uuid)
  to service_role;

revoke all on function public.autopilot_liquidar_saida_armada(uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.autopilot_liquidar_saida_armada(uuid, numeric, numeric)
  to service_role;

revoke all on function public.autopilot_compromisso_vivo(numeric, numeric, text, numeric, boolean)
  from public, anon, authenticated;
grant execute on function public.autopilot_compromisso_vivo(numeric, numeric, text, numeric, boolean)
  to service_role;

-- ⚠️ A TABELA TAMBÉM: RLS ligada sem policies já fecha para anon/authenticated,
-- mas o GRANT de tabela é outra porta. Ela nasce sem nenhum.
revoke all on table public.autopilot_position_effects from public, anon, authenticated;
grant select, insert, update on table public.autopilot_position_effects to service_role;
