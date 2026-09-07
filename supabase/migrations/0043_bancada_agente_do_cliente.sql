-- ═══════════════════════════════════════════════════════════════════════
-- O AGENTE DO INVESTIDOR — uma INSTÂNCIA dele, não o placar da casa (07/09)
--
-- ⚠️⚠️ O DONO, DEPOIS DE VER A BANCADA: *"apenas estamos pegando os resultados
-- das mesas do painel e Admin e repetindo para o investidor... eu falei que
-- tinha que ser isolado... o investidor roda estratégia/agente e o mesmo começa
-- a trabalhar e gerar resultado dali"*.
--
-- Ele tem razão, e o defeito era de arquitetura, não de tela. O que existia:
--
--   · `bancada_estrategia` + `bancada_posicao` + `tique.ts` — papel adiante DO
--     CLIENTE, isolado por dono, mas capaz de rodar SÓ o vocabulário fechado
--     (`media | canal | rsi`) com alvo e stop em percentual fixo;
--   · as mesas da casa (FREYJA, VÖLUNDR...) — presentes apenas como VITRINE,
--     com números agregados de `zion_suggestions`, que é o livro do ADMIN.
--     Isto é literalmente o resultado do painel repetido para o investidor.
--   · o botão "rodar esta mesa" — um BACKTEST histórico. Passado obedecendo,
--     não um agente trabalhando a partir de agora.
--
-- O que falta é a INSTÂNCIA: o investidor contrata o agente, ele passa a tickar
-- na conta dele, e o número que ele lê nasce do ZERO naquele instante.
--
-- ⚠️ E É UMA COLUNA, NÃO UMA TABELA NOVA. Uma `bancada_agente` paralela teria
-- de duplicar dono, símbolos, intervalo, praça, papel, o interruptor, a cota e
-- o índice do cron — e as posições teriam de apontar para uma de duas tabelas.
-- Duas fontes para "o que este cliente tem ligado" é a receita para as duas
-- discordarem. `bancada_estrategia` JÁ é "o que este dono tem ligado"; o que
-- faltava era ela poder dizer que a regra não é dele, é de uma mesa nossa.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.bancada_estrategia
  -- ⚠️ NULO = ESTRATÉGIA PRÓPRIA (o vocabulário fechado do cliente).
  -- PREENCHIDO = instância de um agente da casa, e o valor é o `source` da mesa
  -- (`strat_dex`, `strat_mech`...). O cron bifurca por esta coluna: com `mesa`
  -- ele roda o seletor real (`computeIndicators` + `candidateAttempts`); sem
  -- ela, `sinais()` do vocabulário.
  --
  -- ⚠️ SEM FK e sem `check` de lista: as mesas vivem em `zion/desks.ts`, em
  -- código, e um `check` aqui envelheceria em silêncio na primeira mesa nova.
  -- Quem valida é `mesaPodeRodar()`, na rota, com teste.
  add column if not exists mesa text;

comment on column public.bancada_estrategia.mesa is
  'NULO = estrategia propria do cliente. Preenchido = instancia de um agente da casa (o `source` do desk). O cron bifurca por aqui.';

create index if not exists bancada_estrategia_mesa_idx
  on public.bancada_estrategia (mesa) where mesa is not null;

-- ── A POSIÇÃO PRECISA DIZER O QUE A ABRIU ───────────────────────────
--
-- ⚠️ O agente escolhe entre DEZ playbooks por regime de mercado. Sem gravar
-- qual deles abriu, o extrato do investidor volta a ser um número sem como
-- conferir — exatamente o que a migration 0041 corrigiu no backtest. E aqui é
-- pior: no backtest ele pode rodar de novo; a posição viva aconteceu uma vez.
--
-- ⚠️ NULO em estratégia própria: lá o gatilho é o do cliente e já está na regra.
alter table public.bancada_posicao
  add column if not exists playbook text;

comment on column public.bancada_posicao.playbook is
  'Qual playbook do seletor abriu esta posicao. NULO em estrategia propria — la o gatilho e o do cliente.';

-- ⚠️⚠️ E O HORIZONTE VAI PARA A LINHA, junto do alvo e do stop.
--
-- O bracket de um agente é VARIÁVEL: sai da volatilidade daquele instante
-- (`stopFloorPct = max(ATR% × 1,5, piso)`, alvo ≤ `ATR% × √horas × 2,0`), e o
-- horizonte sai do playbook. Duas posições da MESMA instância têm brackets
-- diferentes, e `expira_em` sozinho não permite recalcular nada.
--
-- ⚠️ E ISSO CONSERTA UM DEFEITO LATENTE DO CAMINHO ANTIGO: `decidirFechamento`
-- relia o alvo da ESTRATÉGIA para fechar uma posição já aberta. Editar a
-- estratégia movia, retroativamente, o alvo de posições vivas — o resultado
-- mudava depois do fato. A partir daqui o fechamento lê o bracket DA POSIÇÃO.
alter table public.bancada_posicao
  add column if not exists horas_limite numeric;

comment on column public.bancada_posicao.horas_limite is
  'Horizonte DESTA posicao. O bracket de um agente e variavel: cada posicao carrega o seu.';
