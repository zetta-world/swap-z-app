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

export interface Desk {
  /** `source` no ledger/carteira — nunca muda (é chave de dados). */
  source: string;
  /** Nome viking de guerra. */
  name: string;
  /** Runa/símbolo curto do painel. */
  sigil: string;
  /** Quem é, em uma linha. */
  who: string;
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
}

// ── A frota ───────────────────────────────────────────────────────────────

export const DESKS: Desk[] = [
  // ── Mesas market-neutral: LUCRAM HOJE. Não mexer na lógica. ──
  {
    source: "arbiter", name: "RATATOSKR", sigil: "ᛉ",
    who: "o esquilo que corre entre as praças levando a diferença de preço",
    style: "scalp", venue: "cex", direction: "market_neutral", brain: "none",
    horizonHours: null, scoreboard: "paper", status: "live",
    tests: "arbitragem spot entre corretoras — lucro do spread, sem apostar direção",
  },
  {
    source: "arbiter2", name: "JÖRMUNGANDR", sigil: "ᛇ",
    who: "a serpente que morde o próprio rabo — spot e perpétuo travados",
    style: "scalp", venue: "cex", direction: "market_neutral", brain: "none",
    horizonHours: null, scoreboard: "paper", status: "live",
    tests: "base spot vs futuros (funding + convergência), posição hedgeada",
  },

  // ── Mesa mecânica long-only (Ragnarök S1/S2) ──
  {
    source: "strat_mech", name: "VÖLUNDR", sigil: "ᚹ",
    who: "o ferreiro-mestre: nada de adivinhação, só a forja das regras",
    style: "swing", venue: "cex", direction: "long_only", brain: "none",
    horizonHours: 48, scoreboard: "paper", status: "live",
    tests: "escolher o playbook do momento (range/pullback/reversão) sem IA — o CONTROLE",
  },

  // ── Vigia sem IA (grupo de controle histórico) ──
  {
    source: "radar", name: "HEIMDALL", sigil: "ᚻ",
    who: "o vigia da ponte: enxerga longe e só toca o corno quando algo se move",
    style: "event", venue: "cex", direction: "long_short", brain: "none",
    horizonHours: 72, scoreboard: "both", status: "live",
    tests: "o CONTROLE puro — gatilho de preço sem tratamento nenhum",
  },

  // ── Caçador de evento ──
  {
    source: "sniper", name: "ULLR", sigil: "ᚢ",
    who: "o arqueiro: uma flecha, um alvo, munição contada",
    style: "event", venue: "cex", direction: "long_short", brain: "llm",
    horizonHours: 72, scoreboard: "both", status: "valhalla",
    tests: "disparo por evento com orçamento escasso — comprar o pump e realizar em USDT",
  },

  // ── A casa de Odin: o torneio de cérebros (formato scanner) ──
  {
    source: "hybrid_scan", name: "ODIN", sigil: "ᚬ",
    who: "o Pai de Todos: preside o conselho de modelos e assina a decisão",
    style: "swing", venue: "cex", direction: "long_short", brain: "llm",
    model: "DeepSeek (CEO)", horizonHours: 72, scoreboard: "both", status: "valhalla",
    tests: "um conselho multi-modelo decide melhor que um modelo só?",
  },
  {
    source: "deepseek_scan", name: "HUGINN", sigil: "ᚺ",
    who: "o corvo Pensamento — voa, observa e reporta a Odin",
    style: "swing", venue: "cex", direction: "long_short", brain: "llm",
    model: "DeepSeek", horizonHours: 72, scoreboard: "both", status: "valhalla",
    tests: "expectancy do modelo puro no formato scanner",
  },
  {
    source: "kimi_scan", name: "MUNINN", sigil: "ᛗ",
    who: "o corvo Memória — o outro par de olhos do trono",
    style: "swing", venue: "cex", direction: "long_short", brain: "llm",
    model: "Kimi (Moonshot)", horizonHours: 72, scoreboard: "both", status: "valhalla",
    tests: "expectancy do modelo puro no formato scanner",
  },
  {
    source: "mistral_scan", name: "GERI", sigil: "ᚷ",
    who: "o lobo Faminto que come ao pé da mesa de Odin",
    style: "swing", venue: "cex", direction: "long_short", brain: "llm",
    model: "Mistral", horizonHours: 72, scoreboard: "both", status: "valhalla",
    tests: "expectancy do modelo puro no formato scanner",
  },
  {
    source: "llama_scan", name: "FREKI", sigil: "ᚠ",
    who: "o lobo Voraz, irmão de Geri",
    style: "swing", venue: "cex", direction: "long_short", brain: "llm",
    model: "Llama (Meta)", horizonHours: 72, scoreboard: "both", status: "valhalla",
    tests: "expectancy do modelo puro no formato scanner",
  },
  {
    source: "grok_scan", name: "SLEIPNIR", sigil: "ᛊ",
    who: "o corcel de oito patas — o mais veloz, ainda que hoje corra sem os olhos do X",
    style: "swing", venue: "cex", direction: "long_short", brain: "llm",
    model: "Grok (xAI)", horizonHours: 72, scoreboard: "both", status: "valhalla",
    tests: "expectancy do modelo puro no formato scanner",
  },

  // ── As videntes: formato analista (tese em prosa) ──
  {
    source: "oracle_deepseek", name: "VÖLVA · DeepSeek", sigil: "ᚦ",
    who: "a vidente: lê a saga do mercado e declara a tese com invalidação",
    style: "position", venue: "cex", direction: "long_short", brain: "llm",
    model: "DeepSeek", horizonHours: 240, scoreboard: "both", status: "valhalla",
    tests: "tese de analista (240h) bate o scanner de 30 minutos?",
  },
  {
    source: "oracle_mistral", name: "VÖLVA · Mistral", sigil: "ᚦ",
    who: "a vidente de Midgard",
    style: "position", venue: "cex", direction: "long_short", brain: "llm",
    model: "Mistral", horizonHours: 240, scoreboard: "both", status: "valhalla",
    tests: "tese de analista (240h) bate o scanner de 30 minutos?",
  },
  {
    source: "oracle_grok", name: "VÖLVA · Grok", sigil: "ᚦ",
    who: "a vidente veloz",
    style: "position", venue: "cex", direction: "long_short", brain: "llm",
    model: "Grok (xAI)", horizonHours: 240, scoreboard: "both", status: "valhalla",
    tests: "tese de analista (240h) bate o scanner de 30 minutos?",
  },
  {
    source: "oracle_kimi", name: "VÖLVA · Kimi", sigil: "ᚦ",
    who: "a vidente da memória longa",
    style: "position", venue: "cex", direction: "long_short", brain: "llm",
    model: "Kimi (Moonshot)", horizonHours: 240, scoreboard: "both", status: "valhalla",
    tests: "tese de analista (240h) bate o scanner de 30 minutos?",
  },

  // ── Aposentados de vez (sem gasto, história preservada) ──
  {
    source: "self_scan", name: "TÝR", sigil: "ᛏ",
    who: "o deus que deu a mão para atar o lobo — aposentado por custo",
    style: "swing", venue: "cex", direction: "long_short", brain: "llm",
    model: "Anthropic (aposentado)", horizonHours: 72, scoreboard: "both", status: "valhalla",
    tests: "assento Anthropic — encerrado: caro demais para o que entregava",
  },
  {
    source: "oracle_self", name: "SAGA", sigil: "ᛋ",
    who: "a cronista de Odin — aposentada junto com o assento Anthropic",
    style: "position", venue: "cex", direction: "long_short", brain: "llm",
    model: "Anthropic (aposentado)", horizonHours: 240, scoreboard: "both", status: "valhalla",
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
