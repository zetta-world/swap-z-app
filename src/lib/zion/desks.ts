/**
 * O REGISTRO DAS MESAS — fonte única de verdade sobre QUEM é cada agente,
 * COMO opera, ONDE opera e O QUE cada um está testando.
 *
 * Por que isto existe: a rodada anterior comparou, na mesma tabela e com a
 * mesma régua, coisas que não se comparam — um sniper de evento contra um
 * scanner de 30 minutos contra uma mesa market-neutral. Julgar day trade com a
 * régua de swing (e vice-versa) é como cronometrar um maratonista na prova dos
 * 100m e concluir que ele é lento. Antes de medir de novo, separa-se.
 *
 * Toda mesa declara aqui: estilo, praça, cérebro, direcionalidade, horizonte e
 * a pergunta que ela existe para responder. Painéis, torneio e carteira paper
 * leem DESTE arquivo — nomes e taxonomia nunca mais divergem entre telas.
 *
 * NOMES: todos os agentes são vikings (menos o ZION, que é a plataforma, não um
 * agente). A casa de Odin dá nome ao torneio de modelos — seus companheiros
 * (os corvos Huginn e Muninn, os lobos Geri e Freki, o cavalo Sleipnir) são os
 * cérebros que competem servindo ao mesmo trono.
 */

/** Como a mesa opera no tempo — day trade e swing NÃO se medem com a mesma régua. */
export type DeskStyle =
  | "scalp"       // minutos–horas, muitos ciclos
  | "day"         // intradiário, fecha no mesmo dia
  | "swing"       // dias, respira o movimento
  | "position"    // semanas, acumulação de ciclo
  | "event";      // sem relógio: só acorda com gatilho

/** Onde o dinheiro seria colocado. */
export type DeskVenue = "cex" | "dex" | "both";

/** Se assume direção do mercado ou é hedgeada. */
export type DeskDirection =
  | "long_only"      // só compra barato e realiza em USDT
  | "long_short"     // aposta nos dois lados (a rodada de Valhalla)
  | "market_neutral";// hedgeada: lucro vem do spread, não da direção

/** Quem decide. `none` = determinístico, sem token gasto. */
export type DeskBrain = "none" | "llm";

/** Como a mesa é julgada. */
export type DeskScoreboard =
  | "paper"       // carteira de USDT — a régua que importa
  | "tournament"  // expectancy do sinal por trade
  | "both";

export type DeskStatus = "live" | "valhalla" | "planned";

/**
 * O SETOR da mesa — a régua pela qual ela é julgada.
 *
 * POR QUE ISTO EXISTE (crítica do dono, 01/08): "temos que separar bem tudo
 * para testar corretamente dessa vez". Sem setor, o painel comparava um scalper
 * market-neutral com um swing direcional na mesma tabela, e o ranking dizia
 * qualquer coisa. Mesas com mandatos diferentes precisam de tabelas diferentes.
 */
export type DeskSector =
  | "A_direcional"   // aposta direção: a TESE do dono está aqui
  | "B_neutro"       // spread/funding: já paga hoje, zero IA — não mexer
  | "C_lancamento"   // pool recém-nascido: terreno e risco próprios
  | "D_arquivo";     // Valhalla — histórico, não compete

/**
 * A FICHA DE CONSTRUÇÃO — "não sei como cada agente novo foi montado".
 *
 * Era uma reclamação literal do dono, e ele tinha razão: a lógica de cada mesa
 * morava espalhada em três arquivos e um comentário. Aqui ela vira declaração:
 * o que a mesa VÊ, o que ela DECIDE, sob que REGRA, contra QUEM ela compete, e
 * quando ela deve ser APOSENTADA.
 *
 * O campo que mais importa é o último. Uma mesa sem critério de aposentadoria
 * vira estimação: continua rodando porque ninguém teve coragem de desligar, e o
 * custo dela some no meio do resto.
 */
export interface DeskSheet {
  /** Os dados que ela lê antes de decidir. */
  sees: string;
  /** A decisão que ela produz. */
  decides: string;
  /** A regra que rege a decisão. */
  rule: string;
  /** Contra quem o resultado dela é lido. `null` = não tem par. */
  comparedTo: string | null;
  /** Quando desligar. Sem isto, mesa ruim vira estimação. */
  retireWhen: string;
}

export interface Desk {
  /** `source` no ledger/carteira — nunca muda (é chave de dados). */
  source: string;
  /** Nome viking de guerra. */
  name: string;
  /** Runa/símbolo curto do painel. */
  sigil: string;
  /** Quem é, em uma linha. */
  who: string;
  /**
   * ⚠️ O SUBTÍTULO FUNCIONAL — decisão do dono, 05/08.
   *
   * "se eu mostrar a um leigo ele não vai saber o que é o quê, qual mesa é, e
   * o que mede o quê." MÍMIR, VÖLUNDR, SKAÐI não dizem nada para quem não
   * construiu o sistema, e o painel inteiro é feito de nomes vikings.
   *
   * A decisão foi manter o nome de guerra COM subtítulo funcional embaixo —
   * preserva a identidade e resolve a legibilidade. O formato é sempre o mesmo,
   * e é o que a tela mostra:
   *
   *   MÍMIR
   *   escolhe estratégia com IA · $1.000 · swing 48h
   *
   * Curto de propósito: cabe embaixo do nome sem quebrar linha no celular.
   */
  subtitle: string;
  /**
   * ⚠️ QUANTO ESTA ESTRATÉGIA PRECISA PARA SER MEDIDA — e o porquê do número.
   *
   * O defeito estrutural achado na auditoria de 05/08: as 23 mesas receberam
   * $1.000 (ou $300) independentemente do que a estratégia exige. Funding
   * precisa de $2.000 para as quatro pernas não dominarem; basis trimestral
   * $5.000; arbitragem estatística $10.000; market making $50.000 e tier.
   *
   * Dar o mesmo capital a todas não é neutro — é medir errado por construção.
   * Mesa sub-capitalizada não rende menos: rende NEGATIVO por custo fixo, e o
   * resultado é lido como "a estratégia não presta". Provavelmente já matamos
   * ideias boas assim.
   *
   * `capitalWhy` é obrigatório junto: número de capital sem justificativa vira
   * constante que ninguém confere, que é como a coluna `priority` nasceu.
   */
  capitalRequiredUsd: number;
  capitalWhy: string;
  style: DeskStyle;
  venue: DeskVenue;
  direction: DeskDirection;
  brain: DeskBrain;
  /** Modelo por trás, quando houver. */
  model?: string;
  /** Horizonte típico em horas (null = definido pelo gatilho). */
  horizonHours: number | null;
  scoreboard: DeskScoreboard;
  status: DeskStatus;
  /** A pergunta que esta mesa existe para responder. */
  tests: string;
  /** Em que tabela ela é julgada. */
  sector: DeskSector;
  /**
   * Como ela foi montada. Obrigatória nas mesas VIVAS — uma mesa em produção
   * sem ficha é uma caixa-preta operando dinheiro simulado, e amanhã real.
   * Opcional no arquivo: reconstruir a ficha de quem já foi aposentado seria
   * arqueologia sem uso.
   */
  sheet?: DeskSheet;
}

// ── A frota ───────────────────────────────────────────────────────────────

export const DESKS: Desk[] = [
  // ── Mesas market-neutral: LUCRAM HOJE. Não mexer na lógica. ──
  {
    source: "arbiter", name: "RATATOSKR", sigil: "ᛉ",
    subtitle: "arbitragem spot entre corretoras · $5.000 · sem direção",
    capitalRequiredUsd: 5000, capitalWhy:
      "os dois bolsos exigem estoque em CADA praça; com menos, o ticket de $50 vira fração grande do livro e o resultado mede a nossa ordem, não o mercado",
    who: "o esquilo que corre entre as praças levando a diferença de preço",
    style: "scalp", venue: "cex", direction: "market_neutral", brain: "none",
    horizonHours: null, scoreboard: "paper", status: "live",
    tests: "arbitragem spot entre corretoras — lucro do spread, sem apostar direção",
    sector: "B_neutro",
    sheet: {
      sees: "preço spot do mesmo par em várias corretoras, ao vivo",
      decides: "se o spread entre duas praças paga o custo de ida e volta",
      rule: "aritmética pura — compra na barata, vende na cara, zero LLM",
      comparedTo: "JÖRMUNGANDR (a outra forma de ser neutro)",
      retireWhen: "o spread médio líquido ficar abaixo do custo por 30 dias seguidos",
    },
  },
  {
    source: "arbiter2", name: "JÖRMUNGANDR", sigil: "ᛇ",
    subtitle: "spot comprado + perpétuo vendido · $2.000 · sem direção",
    capitalRequiredUsd: 2000, capitalWhy:
      "ciclo de 4 pernas a 0,45%: abaixo de $2.000 o custo fixo come o funding antes de ele acumular",
    who: "a serpente que morde o próprio rabo — spot e perpétuo travados",
    style: "scalp", venue: "cex", direction: "market_neutral", brain: "none",
    horizonHours: null, scoreboard: "paper", status: "live",
    tests: "base spot vs futuros (funding + convergência), posição hedgeada",
    sector: "B_neutro",
    sheet: {
      sees: "base entre spot e perpétuo, mais a taxa de funding",
      decides: "abrir par hedgeado quando a base paga o funding até convergir",
      rule: "aritmética pura — a posição é travada, não aposta direção",
      comparedTo: "RATATOSKR (spread simples, sem perna de futuros)",
      retireWhen: "funding acumulado negativo em 30 dias, ou convergência falhando",
    },
  },

  // ── Mesa mecânica long-only (Ragnarök S1/S2) ──
  {
    source: "arbiter2_3x", name: "NÍÐHÖGGR", sigil: "ᚼ",
    subtitle: "o mesmo par, com 3× de alavanca · $2.000 · sem direção",
    capitalRequiredUsd: 2000, capitalWhy:
      "mesmo capital do JÖRMUNGANDR de propósito — a alavanca é a variável isolada, e mudar o capital junto invalidaria o duelo",
    who: "o dragão que rói a raiz — mesma arbitragem, margem 3× menor por ciclo",
    style: "scalp", venue: "cex", direction: "market_neutral", brain: "none",
    horizonHours: null, scoreboard: "paper", status: "live",
    tests: "alavancar 3× a arbitragem hedgeada paga o risco de liquidação que ela cria?",
    sector: "B_neutro",
    sheet: {
      sees: "a mesma matriz de spread spot/perp que o JÖRMUNGANDR",
      decides: "abre o mesmo ciclo, postando 1/3 da margem na perna vendida",
      rule: "aritmética pura; liquidação SIMULADA quando o preço sobe ~33% contra o short",
      comparedTo: "JÖRMUNGANDR (sem alavanca) e FÁFNIR (5×)",
      retireWhen: "render menos que o JÖRMUNGANDR por USDT arriscado, ou uma liquidação apagar o ganho de semanas",
    },
  },
  {
    source: "arbiter2_5x", name: "FÁFNIR", sigil: "ᚠ",
    subtitle: "o mesmo par, com 5× de alavanca · $2.000 · sem direção",
    capitalRequiredUsd: 2000, capitalWhy:
      "mesmo capital do JÖRMUNGANDR de propósito — a alavanca é a variável isolada",
    who: "o dragão que virou dragão de tanto guardar ouro — 5× de margem, 5× de sede",
    style: "scalp", venue: "cex", direction: "market_neutral", brain: "none",
    horizonHours: null, scoreboard: "paper", status: "live",
    tests: "onde a alavancagem deixa de compensar — 5× é ganância ou eficiência?",
    sector: "B_neutro",
    sheet: {
      sees: "a mesma matriz de spread spot/perp que o JÖRMUNGANDR",
      decides: "abre o mesmo ciclo, postando 1/5 da margem na perna vendida",
      rule: "aritmética pura; liquidação SIMULADA quando o preço sobe ~20% contra o short",
      comparedTo: "JÖRMUNGANDR (sem alavanca) e NÍÐHÖGGR (3×)",
      retireWhen: "render menos que o NÍÐHÖGGR por USDT arriscado — aí a alavanca extra só compra risco",
    },
  },

  {
    source: "strat_mech", name: "VÖLUNDR", sigil: "ᚹ",
    subtitle: "escolhe estratégia por regra · $5.000 · swing 48h",
    capitalRequiredUsd: 5000, capitalWhy:
      "5+ posições simultâneas de ~$500 sem que uma domine a carteira; com $1.000 duas posições já são 100% do capital",
    who: "o ferreiro-mestre: nada de adivinhação, só a forja das regras",
    style: "swing", venue: "cex", direction: "long_only", brain: "none",
    horizonHours: 48, scoreboard: "paper", status: "live",
    tests: "escolher o playbook do momento (range/pullback/reversão) sem IA — o CONTROLE",
    sector: "A_direcional",
    sheet: {
      sees: "retrato técnico do símbolo: regime, ADX, RSI, médias, ATR, S/R, volume, OBV",
      decides: "QUAL dos 10 playbooks operar — ou nenhum",
      rule: "prioridade declarada na biblioteca; determinístico, zero LLM",
      comparedTo: "MÍMIR (mesmo cardápio, escolhedor diferente)",
      retireWhen: "expectancy líquida negativa com 100+ decididos, ou perder do buy-and-hold",
    },
  },

  {
    source: "strat_ai", name: "MÍMIR", sigil: "ᛘ",
    subtitle: "escolhe estratégia com IA · $5.000 · swing 48h",
    capitalRequiredUsd: 5000, capitalWhy:
      "mesmo capital do VÖLUNDR — o cérebro é a variável isolada do duelo",
    who: "a cabeça sábia no poço: aconselha o ferreiro — aceita, veta ou corrige",
    style: "swing", venue: "cex", direction: "long_only", brain: "llm",
    model: "papel brain (Mistral)", horizonHours: 48, scoreboard: "paper", status: "live",
    tests: "a IA escolhe a estratégia do momento melhor que o bot determinístico?",
    sector: "A_direcional",
    sheet: {
      sees: "o MESMO retrato do VÖLUNDR, mais o cardápio de candidatos já validados",
      decides: "QUAL candidato tomar — ou nenhum; pode refinar os níveis",
      rule: "o modelo escolhe; o bracket mecânico valida. Sem cérebro, não grava",
      comparedTo: "VÖLUNDR (é ESTE o duelo — a tese do dono)",
      retireWhen: "não bater o VÖLUNDR com 100+ decididos nos dois lados",
    },
  },

  {
    source: "strat_record", name: "URÐR", sigil: "ᚢᚱ",
    subtitle: "escolhe pelo histórico medido · $5.000 · swing 48h",
    capitalRequiredUsd: 5000, capitalWhy:
      "mesmo capital do VÖLUNDR — o critério de escolha é a variável isolada",
    who: "a Norna do passado: não julga o gráfico, obedece ao que já aconteceu",
    style: "swing", venue: "cex", direction: "long_only", brain: "none",
    horizonHours: 48, scoreboard: "paper", status: "live",
    tests: "quanto vale a EVIDÊNCIA sozinha — sem IA, só o histórico medido mandando",
    sector: "A_direcional",
    sheet: {
      sees: "o mesmo cardápio de candidatos do VÖLUNDR, mais o histórico medido de cada um",
      decides: "toma o playbook com melhor líquido MEDIDO no regime atual — ou nenhum",
      rule: "obedece ao registro: descarta o que mediu negativo e fica de fora se todos forem",
      comparedTo: "VÖLUNDR (isola a evidência) e MÍMIR (isola o julgamento da IA sobre ela)",
      retireWhen: "não bater o VÖLUNDR com 100+ decididos — aí a evidência não vale o que custa",
    },
  },
  {
    source: "strat_dex", name: "FREYJA", sigil: "ᚨ",
    subtitle: "a mesma regra, na praça DEX · $5.000 · swing 48h",
    capitalRequiredUsd: 5000, capitalWhy:
      "mesmo capital do VÖLUNDR mais folga para gás; a praça é a variável isolada",
    who: "a senhora da abundância — colhe on-chain, onde o ZION também olha",
    style: "swing", venue: "dex", direction: "long_only", brain: "none",
    horizonHours: 48, scoreboard: "paper", status: "live",
    tests: "a MESMA estratégia paga na DEX como na CEX? (a praça muda o resultado?)",
    sector: "A_direcional",
    sheet: {
      sees: "o mesmo retrato, calculado sobre pools on-chain (GeckoTerminal)",
      decides: "o mesmo playbook do VÖLUNDR, na praça DEX",
      rule: "seletor idêntico ao mecânico — a variável isolada é a PRAÇA",
      comparedTo: "VÖLUNDR (mesma estratégia, mercado diferente)",
      retireWhen: "expectancy negativa com 100+ decididos, ou dado de pool sem confiabilidade",
    },
  },
  {
    source: "strat_day", name: "SKAÐI", sigil: "ᛋ",
    subtitle: "a mesma regra, em 8h · $5.000 · day trade",
    capitalRequiredUsd: 5000, capitalWhy:
      "mesmo capital do VÖLUNDR — o relógio é a variável isolada",
    who: "a caçadora dos esquis: entra e sai no mesmo dia, sem dormir posicionada",
    style: "day", venue: "cex", direction: "long_only", brain: "none",
    horizonHours: 8, scoreboard: "paper", status: "live",
    tests: "o mesmo playbook em horizonte intradiário — day trade vs swing",
    sector: "A_direcional",
    sheet: {
      sees: "o mesmo retrato do VÖLUNDR",
      decides: "o mesmo playbook, com horizonte de 8h em vez de 48h",
      rule: "seletor idêntico ao mecânico — a variável isolada é o RELÓGIO",
      comparedTo: "VÖLUNDR (mesma estratégia, prazo diferente)",
      retireWhen: "expectancy negativa com 100+ decididos, ou perder do swing por margem clara",
    },
  },

  // ── Vigia sem IA (grupo de controle histórico) ──
  {
    source: "radar", name: "HEIMDALL", sigil: "ᚻ",
    subtitle: "varre o mercado e dispara alerta · $5.000 · swing 72h",
    capitalRequiredUsd: 5000, capitalWhy:
      "mesma faixa das direcionais para o resultado ser comparável na mesma tabela",
    who: "o vigia da ponte: enxerga longe e só toca o corno quando algo se move",
    style: "event", venue: "cex", direction: "long_short", brain: "none",
    horizonHours: 72, scoreboard: "both", status: "live",
    tests: "o CONTROLE puro — gatilho de preço sem tratamento nenhum",
    sector: "A_direcional",
    sheet: {
      sees: "movimento bruto de preço nos majors, sem tratamento",
      decides: "registrar um sinal quando o gatilho dispara",
      rule: "gatilho de preço puro — é o piso contra o qual todo o resto se mede",
      comparedTo: "todas — é o CONTROLE de nível zero",
      retireWhen: "nunca: um controle sem tratamento é a linha de base do experimento",
    },
  },

  // ── O arqueiro: caça lançamento on-chain ──
  {
    source: "ullr_launch", name: "ULLR", sigil: "ᚢ",
    subtitle: "compra pool recém-nascido · $1.000 · evento 12h",
    capitalRequiredUsd: 1000, capitalWhy:
      "munição diária contada de propósito: capital alto em pool novo é risco de liquidez, não amostra maior",
    who: "o arqueiro: caça pool recém-nascido, uma flecha por alvo, munição contada",
    style: "event", venue: "dex", direction: "long_only", brain: "none",
    horizonHours: 12, scoreboard: "paper", status: "live",
    tests: "token recém-lançado com chance de pump — comprar e REALIZAR em USDT",
    sector: "C_lancamento",
    sheet: {
      sees: "idade do pool, liquidez travada e fluxo comprador de tokens recém-nascidos",
      decides: "comprar uma flecha, com munição diária contada",
      rule: "regra de idade/liquidez/fluxo; sem LLM (não há estrutura pra ler em pool de horas)",
      comparedTo: null,
      retireWhen: "munição diária consumida sem lucro líquido em 60 dias",
    },
  },
  {
    // O sniper ANTIGO. Caçava os 14 majors por gatilho de preço e podia emitir
    // short — não era o arqueiro de lançamento que o mandato pedia. Substituído
    // por `ullr_launch`; a história fica, o assento não.
    source: "sniper", name: "VEÐRFÖLNIR", sigil: "ᚡ",
    subtitle: "mesa arquivada · rodada encerrada",
    capitalRequiredUsd: 1000, capitalWhy:
      "arquivada — o capital é histórico, não alocação ativa; ver PLANO-ARQUIVO-RODADAS.md",
    who: "o falcão entre os olhos da águia — vigiava os majors, não os nascimentos",
    style: "event", venue: "cex", direction: "long_short", brain: "llm",
    horizonHours: 72, scoreboard: "both", status: "valhalla",
    sector: "D_arquivo",
    tests: "disparo por gatilho de preço nos majors — encerrado: mandato errado",
  },

  // ── A casa de Odin: o torneio de cérebros (formato scanner) ──
  {
    source: "hybrid_scan", name: "ODIN", sigil: "ᚬ",
    subtitle: "mesa arquivada · rodada encerrada",
    capitalRequiredUsd: 1000, capitalWhy:
      "arquivada — o capital é histórico, não alocação ativa; ver PLANO-ARQUIVO-RODADAS.md",
    who: "o Pai de Todos: preside o conselho de modelos e assina a decisão",
    style: "swing", venue: "cex", direction: "long_short", brain: "llm",
    model: "DeepSeek (CEO)", horizonHours: 72, scoreboard: "both", status: "valhalla",
    sector: "D_arquivo",
    tests: "um conselho multi-modelo decide melhor que um modelo só?",
  },
  {
    source: "deepseek_scan", name: "HUGINN", sigil: "ᚺ",
    subtitle: "mesa arquivada · rodada encerrada",
    capitalRequiredUsd: 1000, capitalWhy:
      "arquivada — o capital é histórico, não alocação ativa; ver PLANO-ARQUIVO-RODADAS.md",
    who: "o corvo Pensamento — voa, observa e reporta a Odin",
    style: "swing", venue: "cex", direction: "long_short", brain: "llm",
    model: "DeepSeek", horizonHours: 72, scoreboard: "both", status: "valhalla",
    sector: "D_arquivo",
    tests: "expectancy do modelo puro no formato scanner",
  },
  {
    source: "kimi_scan", name: "MUNINN", sigil: "ᛗ",
    subtitle: "mesa arquivada · rodada encerrada",
    capitalRequiredUsd: 1000, capitalWhy:
      "arquivada — o capital é histórico, não alocação ativa; ver PLANO-ARQUIVO-RODADAS.md",
    who: "o corvo Memória — o outro par de olhos do trono",
    style: "swing", venue: "cex", direction: "long_short", brain: "llm",
    model: "Kimi (Moonshot)", horizonHours: 72, scoreboard: "both", status: "valhalla",
    sector: "D_arquivo",
    tests: "expectancy do modelo puro no formato scanner",
  },
  {
    source: "mistral_scan", name: "GERI", sigil: "ᚷ",
    subtitle: "mesa arquivada · rodada encerrada",
    capitalRequiredUsd: 1000, capitalWhy:
      "arquivada — o capital é histórico, não alocação ativa; ver PLANO-ARQUIVO-RODADAS.md",
    who: "o lobo Faminto que come ao pé da mesa de Odin",
    style: "swing", venue: "cex", direction: "long_short", brain: "llm",
    model: "Mistral", horizonHours: 72, scoreboard: "both", status: "valhalla",
    sector: "D_arquivo",
    tests: "expectancy do modelo puro no formato scanner",
  },
  {
    source: "llama_scan", name: "FREKI", sigil: "ᚠ",
    subtitle: "mesa arquivada · rodada encerrada",
    capitalRequiredUsd: 1000, capitalWhy:
      "arquivada — o capital é histórico, não alocação ativa; ver PLANO-ARQUIVO-RODADAS.md",
    who: "o lobo Voraz, irmão de Geri",
    style: "swing", venue: "cex", direction: "long_short", brain: "llm",
    model: "Llama (Meta)", horizonHours: 72, scoreboard: "both", status: "valhalla",
    sector: "D_arquivo",
    tests: "expectancy do modelo puro no formato scanner",
  },
  {
    source: "grok_scan", name: "SLEIPNIR", sigil: "ᛊ",
    subtitle: "mesa arquivada · rodada encerrada",
    capitalRequiredUsd: 1000, capitalWhy:
      "arquivada — o capital é histórico, não alocação ativa; ver PLANO-ARQUIVO-RODADAS.md",
    who: "o corcel de oito patas — o mais veloz, ainda que hoje corra sem os olhos do X",
    style: "swing", venue: "cex", direction: "long_short", brain: "llm",
    model: "Grok (xAI)", horizonHours: 72, scoreboard: "both", status: "valhalla",
    sector: "D_arquivo",
    tests: "expectancy do modelo puro no formato scanner",
  },

  // ── As videntes: formato analista (tese em prosa) ──
  {
    source: "oracle_deepseek", name: "VÖLVA · DeepSeek", sigil: "ᚦ",
    subtitle: "mesa arquivada · rodada encerrada",
    capitalRequiredUsd: 1000, capitalWhy:
      "arquivada — o capital é histórico, não alocação ativa; ver PLANO-ARQUIVO-RODADAS.md",
    who: "a vidente: lê a saga do mercado e declara a tese com invalidação",
    style: "position", venue: "cex", direction: "long_short", brain: "llm",
    model: "DeepSeek", horizonHours: 240, scoreboard: "both", status: "valhalla",
    sector: "D_arquivo",
    tests: "tese de analista (240h) bate o scanner de 30 minutos?",
  },
  {
    source: "oracle_mistral", name: "VÖLVA · Mistral", sigil: "ᚦ",
    subtitle: "mesa arquivada · rodada encerrada",
    capitalRequiredUsd: 1000, capitalWhy:
      "arquivada — o capital é histórico, não alocação ativa; ver PLANO-ARQUIVO-RODADAS.md",
    who: "a vidente de Midgard",
    style: "position", venue: "cex", direction: "long_short", brain: "llm",
    model: "Mistral", horizonHours: 240, scoreboard: "both", status: "valhalla",
    sector: "D_arquivo",
    tests: "tese de analista (240h) bate o scanner de 30 minutos?",
  },
  {
    source: "oracle_grok", name: "VÖLVA · Grok", sigil: "ᚦ",
    subtitle: "mesa arquivada · rodada encerrada",
    capitalRequiredUsd: 1000, capitalWhy:
      "arquivada — o capital é histórico, não alocação ativa; ver PLANO-ARQUIVO-RODADAS.md",
    who: "a vidente veloz",
    style: "position", venue: "cex", direction: "long_short", brain: "llm",
    model: "Grok (xAI)", horizonHours: 240, scoreboard: "both", status: "valhalla",
    sector: "D_arquivo",
    tests: "tese de analista (240h) bate o scanner de 30 minutos?",
  },
  {
    source: "oracle_kimi", name: "VÖLVA · Kimi", sigil: "ᚦ",
    subtitle: "mesa arquivada · rodada encerrada",
    capitalRequiredUsd: 1000, capitalWhy:
      "arquivada — o capital é histórico, não alocação ativa; ver PLANO-ARQUIVO-RODADAS.md",
    who: "a vidente da memória longa",
    style: "position", venue: "cex", direction: "long_short", brain: "llm",
    model: "Kimi (Moonshot)", horizonHours: 240, scoreboard: "both", status: "valhalla",
    sector: "D_arquivo",
    tests: "tese de analista (240h) bate o scanner de 30 minutos?",
  },

  // ── Aposentados de vez (sem gasto, história preservada) ──
  {
    source: "self_scan", name: "TÝR", sigil: "ᛏ",
    subtitle: "mesa arquivada · rodada encerrada",
    capitalRequiredUsd: 1000, capitalWhy:
      "arquivada — o capital é histórico, não alocação ativa; ver PLANO-ARQUIVO-RODADAS.md",
    who: "o deus que deu a mão para atar o lobo — aposentado por custo",
    style: "swing", venue: "cex", direction: "long_short", brain: "llm",
    model: "Anthropic (aposentado)", horizonHours: 72, scoreboard: "both", status: "valhalla",
    sector: "D_arquivo",
    tests: "assento Anthropic — encerrado: caro demais para o que entregava",
  },
  {
    source: "oracle_self", name: "SAGA", sigil: "ᛋ",
    subtitle: "mesa arquivada · rodada encerrada",
    capitalRequiredUsd: 1000, capitalWhy:
      "arquivada — o capital é histórico, não alocação ativa; ver PLANO-ARQUIVO-RODADAS.md",
    who: "a cronista de Odin — aposentada junto com o assento Anthropic",
    style: "position", venue: "cex", direction: "long_short", brain: "llm",
    model: "Anthropic (aposentado)", horizonHours: 240, scoreboard: "both", status: "valhalla",
    sector: "D_arquivo",
    tests: "tese de analista no assento Anthropic — encerrado por custo",
  },
];

// ── Índices e helpers ─────────────────────────────────────────────────────

const BY_SOURCE = new Map<string, Desk>(DESKS.map((d) => [d.source, d]));

export function deskFor(source: string): Desk | null {
  return BY_SOURCE.get(source) ?? null;
}

/** Nome de exibição — cai no `source` cru quando a mesa não está registrada. */
export function deskName(source: string): string {
  return BY_SOURCE.get(source)?.name ?? source;
}

export function desksByStatus(status: DeskStatus): Desk[] {
  return DESKS.filter((d) => d.status === status);
}

/** Rótulos legíveis (PT) para a taxonomia — usados nos painéis. */
export const STYLE_LABEL: Record<DeskStyle, string> = {
  scalp: "scalp", day: "day trade", swing: "swing", position: "posição", event: "evento",
};
export const DIRECTION_LABEL: Record<DeskDirection, string> = {
  long_only: "long-only (acumula USDT)",
  long_short: "long+short (direcional)",
  market_neutral: "market-neutral (hedgeada)",
};
export const VENUE_LABEL: Record<DeskVenue, string> = {
  cex: "CEX", dex: "DEX", both: "CEX+DEX",
};
export const SCOREBOARD_LABEL: Record<DeskScoreboard, string> = {
  paper: "carteira (USDT)",
  tournament: "torneio (sinal)",
  both: "carteira + torneio",
};

/** Agrupa a frota por estilo — a separação que o painel precisa mostrar. */
export function groupByStyle(desks: Desk[] = DESKS): Array<{ style: DeskStyle; label: string; desks: Desk[] }> {
  const order: DeskStyle[] = ["scalp", "day", "swing", "position", "event"];
  return order
    .map((style) => ({ style, label: STYLE_LABEL[style], desks: desks.filter((d) => d.style === style) }))
    .filter((g) => g.desks.length > 0);
}
