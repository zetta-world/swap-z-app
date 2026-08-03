/**
 * A BIBLIOTECA DE ESTRATÉGIAS — o repertório de um trader, escrito como regra.
 *
 * POR QUE ESTE ARQUIVO EXISTE (crítica do dono, 01/08):
 *
 * O seletor nascia com TRÊS playbooks: `range_reversion`, `trend_pullback` e
 * `capitulation_reversal`. O dono tinha dito *"stop range, pull back, suporte
 * resistência e etc"* — como EXEMPLOS. Eu implementei a lista literal e parei
 * no "etc".
 *
 * Isso não é detalhe de cobertura: é a tese inteira. A pergunta do experimento
 * é *"a IA escolhe a estratégia que melhor se adequa ao momento?"*. Com três
 * opções, escolher mal chega a ser escolher. Uma mesa de IA decidindo entre
 * três respostas não está sendo testada — está sendo enfeitada.
 *
 * AGORA SÃO DEZ, e a diferença que importa não é o número: é que cada uma
 * declara em que REGIME faz sentido, QUANDO FALHA, e de que dado depende. O
 * seletor mecânico escolhe por prioridade declarada; a mesa de IA escolhe
 * dentro do MESMO conjunto de candidatos. É isso que torna o duelo limpo — o
 * que muda entre as duas mesas é o escolhedor, não o cardápio.
 *
 * E TODOS OS CANDIDATOS SÃO REGISTRADOS, não só o escolhido. Sem guardar o
 * caminho não tomado, nunca se descobre se a escolha foi boa: um agente que
 * escolhe sempre o pior de três candidatos bons parece idêntico a um que
 * escolhe bem entre três ruins.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE NÃO ESTÁ AQUI, E POR QUÊ
 *
 * Quatro playbooks clássicos ficaram de fora porque o dado para reconhecê-los
 * NÃO EXISTE nos indicadores que a plataforma calcula hoje. Estão listados em
 * `PLAYBOOK_GAPS`, com o dado que falta, em vez de implementados com um proxy
 * ruim. Playbook aproximado é pior que playbook ausente: ele opera, entra no
 * ledger, e polui a medição de todos os outros.
 */

import type { SymbolIndicators, MarketRegime } from "@/lib/api/market-indicators";
import {
  buildLongBracket, atrAbs, floorAwareStop, DEFAULT_LIMITS,
  type ActivePlaybook, type StrategyPlan, type BracketLimits,
} from "@/lib/zion/bracket";

export interface PlaybookDef {
  id: ActivePlaybook;
  label: string;
  /** Em que regimes este playbook é candidato. */
  regimes: MarketRegime[];
  /** A lógica de mercado, em uma linha. */
  thesis: string;
  /** A contra-indicação — quando esta estratégia perde dinheiro. */
  failsWhen: string;
  /**
   * Prioridade DENTRO do regime, menor = tentado primeiro pelo seletor
   * mecânico.
   *
   * ⚠️ Isto é um PALPITE, não um fato medido. A ordem sai da leitura clássica
   * (o setup mais específico vence o mais genérico), e existe só para o
   * mecânico ter uma regra determinística enquanto não há histórico por
   * playbook. Medir cada um isolado é justamente o que vai substituir esta
   * coluna — e quando substituir, esta nota some.
   */
  priority: number;
  /**
   * Constrói o plano, ou devolve em TEXTO o motivo de não operar.
   *
   * O motivo não é decoração: é o diagnóstico que o operador lê no painel para
   * entender por que a mesa ficou parada. Um `stand_aside` sem motivo é
   * indistinguível de um agente quebrado.
   */
  plan(ind: SymbolIndicators, limits?: BracketLimits): StrategyPlan | string;
}

/**
 * Motivo padrão quando a TESE estava certa mas a GEOMETRIA não fecha: RR abaixo
 * do mínimo, stop dentro da banda de ruído, ou alvo fora de escala.
 *
 * Vale distinguir dos outros motivos: aqui o playbook RECONHECEU o setup e foi
 * barrado pelas travas de bracket. É a diferença entre "não vi oportunidade" e
 * "vi, mas não paga o risco" — e as duas coisas exigem correções opostas.
 */
const BRACKET_REJECTED = "setup reconhecido, mas o bracket não paga o risco (RR/stop/alvo)";

// ── Auxiliares de leitura ─────────────────────────────────────────────────

/** Onde o preço está dentro do canal: 0 = no suporte, 1 = na resistência. */
function posInRange(price: number, support: number, resistance: number): number | null {
  if (!(resistance > support)) return null;
  return (price - support) / (resistance - support);
}

/** Volume relativo à média das últimas 20 barras, com queda segura. */
function vol(ind: SymbolIndicators): number {
  return ind.relVol != null && ind.relVol > 0 ? ind.relVol : 1;
}

/** O RSI está subindo na trajetória recente? (direção, não foto parada) */
function rsiRising(ind: SymbolIndicators): boolean {
  const t = ind.rsiTrajectory;
  return t.length >= 2 && t[t.length - 1] > t[0];
}

// ── MERCADO LATERAL ───────────────────────────────────────────────────────

/**
 * RANGE REVERSION — o pão-com-manteiga do mercado sem tendência. O preço
 * oscila entre suporte e resistência; compra-se perto do suporte e realiza-se
 * antes da resistência, onde a fila de venda se forma.
 *
 * Só compra na METADE DE BAIXO do canal. Comprar no meio é comprar caro, que é
 * o oposto de acumular USDT.
 */
const rangeReversion: PlaybookDef = {
  id: "range_reversion",
  label: "Reversão no canal",
  regimes: ["RANGING"],
  priority: 1,
  thesis: "sem tendência, o preço volta à média: compra no suporte, realiza na resistência",
  failsWhen: "o range quebra — uma tendência nascendo transforma cada compra no suporte em faca caindo",
  plan(ind, limits) {
    const { symbol, price } = ind;
    if (price == null || !(price > 0)) return "sem preço";
    const support = ind.supports[0];
    const resistance = ind.resistances[0];
    if (support == null || resistance == null) return "range sem S/R definido";
    const pos = posInRange(price, support, resistance);
    if (pos == null) return "S/R degenerado";
    if (pos > 0.5) return `caro no range (${(pos * 100).toFixed(0)}% do canal)`;

    // Stop um ATR INTEIRO abaixo do suporte, não meio: pavio furando o suporte
    // é ruído; fechamento um ATR abaixo é quebra de range de verdade.
    const a = atrAbs(price, ind.atr14);
    const target = resistance - (resistance - support) * 0.15;
    const stop = support - a;
    return buildLongBracket(
      symbol, "range_reversion", price, target, stop, ind.atrPct, 48,
      `lateral (ADX ${ind.adx?.toFixed(0) ?? "?"}) a ${(pos * 100).toFixed(0)}% do canal — compra no suporte`,
      limits,
    ) ?? BRACKET_REJECTED;
  },
};

/**
 * RANGE BREAKOUT — o outro lado da moeda do canal. Quando o preço rompe a
 * resistência COM VOLUME, quem estava vendendo no nível desistiu, e a altura da
 * faixa costuma se projetar para cima.
 *
 * O volume é a trava inteira: rompimento sem volume é o setup que mais engana
 * no mercado, porque parece idêntico ao de verdade até voltar.
 */
const rangeBreakout: PlaybookDef = {
  id: "range_breakout",
  label: "Rompimento do canal",
  regimes: ["RANGING", "TRANSITIONING"],
  priority: 2,
  thesis: "rompimento da resistência com volume acima da média projeta a altura da faixa",
  failsWhen: "volume fraco — aí é rompimento falso, e o preço volta pra dentro pegando quem comprou o topo",
  plan(ind, limits) {
    const { symbol, price } = ind;
    if (price == null || !(price > 0)) return "sem preço";
    if (vol(ind) < 1.5) return `volume ${vol(ind).toFixed(1)}× — rompimento sem volume é falso`;
    const support = ind.supports[0];
    const resistance = ind.resistances[0];
    if (support == null || resistance == null) return "range sem S/R definido";
    const pos = posInRange(price, support, resistance);
    if (pos == null) return "S/R degenerado";
    // Tem que estar ENCOSTANDO no teto (≥85% do canal) — comprar rompimento a
    // meio caminho é comprar expectativa, não rompimento.
    if (pos < 0.85) return `longe do teto (${(pos * 100).toFixed(0)}% do canal)`;

    const a = atrAbs(price, ind.atr14);
    const height = resistance - support;
    const target = resistance + height * 0.8;         // projeção medida da faixa
    // Voltar pra dentro do canal mata a tese. Mas o teto costuma estar a menos
    // de um ATR da entrada, e aí o stop cairia dentro do ruído — por isso o
    // afastamento. Se com o risco maior o RR não fechar, o bracket recusa.
    const stop = floorAwareStop(price, resistance - a, a);
    return buildLongBracket(
      symbol, "range_breakout", price, target, stop, ind.atrPct, 36,
      `rompendo o topo do canal com volume ${vol(ind).toFixed(1)}× a média — projeção da faixa`,
      limits,
    ) ?? BRACKET_REJECTED;
  },
};

/**
 * PIVOT REVERSION — o clássico do day trade, e o único playbook aqui que usa
 * os níveis derivados do dia anterior em vez dos swings do gráfico.
 *
 * Preço abrindo o dia no S1/S2 tende a buscar o ponto pivô de volta. É um trade
 * de horas, não de dias — por isso o horizonte curto.
 */
const pivotReversion: PlaybookDef = {
  id: "pivot_reversion",
  label: "Volta ao pivô",
  regimes: ["RANGING"],
  priority: 3,
  thesis: "preço no suporte do pivô diário tende a buscar o ponto pivô de volta",
  failsWhen: "dia de tendência forte — aí o preço atravessa S1 e S2 sem olhar para trás",
  plan(ind, limits) {
    const { symbol, price } = ind;
    if (price == null || !(price > 0)) return "sem preço";
    const p = ind.pivotLevels;
    if (!p) return "sem níveis de pivô do dia anterior";
    // Só vale abaixo do pivô e acima (ou perto) do S1 — é essa a zona de compra.
    if (!(price < p.pp)) return "acima do pivô — não é zona de compra";
    if (!(price > p.s2)) return "abaixo do S2 — perdeu a estrutura do dia";

    const a = atrAbs(price, ind.atr14);
    const target = p.pp;                              // o pivô é o ímã
    const stop = floorAwareStop(price, p.s2 - a * 0.5, a);  // perder o S2 mata a tese
    return buildLongBracket(
      symbol, "pivot_reversion", price, target, stop, ind.atrPct, 12,
      `abaixo do pivô diário (${p.pp.toFixed(4)}), acima do S2 — busca a volta ao pivô`,
      limits,
    ) ?? BRACKET_REJECTED;
  },
};

// ── TENDÊNCIA DE ALTA ─────────────────────────────────────────────────────

/**
 * TREND PULLBACK — em alta confirmada não se compra o rompimento (caro): espera
 * o recuo até a EMA20 e compra ali, a favor da maré. Se o preço está esticado
 * acima da média, fica de fora e espera o desconto.
 */
const trendPullback: PlaybookDef = {
  id: "trend_pullback",
  label: "Recuo na tendência",
  regimes: ["TRENDING_UP"],
  priority: 1,
  thesis: "em alta, o recuo até a média é o desconto — compra a favor da maré",
  failsWhen: "a tendência está acabando; aí o 'recuo' vira o começo da reversão",
  plan(ind, limits) {
    const { symbol, price } = ind;
    if (price == null || !(price > 0)) return "sem preço";
    if (ind.ema20 == null || !(ind.ema20 > 0)) return "sem EMA20";

    // Esticado = comprar no topo do impulso. O recuo é o desconto; sem ele, fora.
    const stretchPct = ((price - ind.ema20) / ind.ema20) * 100;
    const atrPct = ind.atrPct ?? 1;
    if (stretchPct > atrPct * 1.5) return `esticado ${stretchPct.toFixed(1)}% acima da EMA20 — espera o pullback`;

    const a = atrAbs(price, ind.atr14);
    const structural = ind.supports[0];
    const stop = structural != null && structural < price ? structural - a : price - a * 1.5;
    // Sem resistência no caminho, o movimento medido tem espaço pra correr —
    // 4 ATR. A 3 ATR o playbook era natimorto contra um stop estrutural honesto.
    const target = ind.resistances[0] != null && ind.resistances[0] > price
      ? ind.resistances[0]
      : price + a * 4;
    return buildLongBracket(
      symbol, "trend_pullback", price, target, stop, ind.atrPct, 72,
      `alta confirmada (ADX ${ind.adx?.toFixed(0) ?? "?"}, ${ind.alignment}) a ${stretchPct.toFixed(1)}% da EMA20 — compra o recuo`,
      limits,
    ) ?? BRACKET_REJECTED;
  },
};

/**
 * TREND CONTINUATION — a bandeira. No meio de uma perna de alta o preço para e
 * consolida com volume MINGUANDO: quem vendeu já vendeu. A perna seguinte
 * costuma medir o tamanho da anterior.
 *
 * O volume baixo é a assinatura. Consolidação com volume alto é distribuição —
 * o oposto, e comprar ali é comprar de quem está saindo.
 */
const trendContinuation: PlaybookDef = {
  id: "trend_continuation",
  label: "Continuação (bandeira)",
  regimes: ["TRENDING_UP"],
  priority: 2,
  thesis: "consolidação com volume secando no meio da alta antecede a perna seguinte",
  failsWhen: "o volume some porque o interesse acabou, não porque está descansando",
  plan(ind, limits) {
    const { symbol, price } = ind;
    if (price == null || !(price > 0)) return "sem preço";
    if (ind.ema20 == null || ind.ema50 == null) return "sem médias";
    if (!(ind.ema20 > ind.ema50)) return "médias não empilhadas — não há perna";
    if (!(price > ind.ema20)) return "preço abaixo da EMA20 — não é bandeira";
    if (vol(ind) > 0.8) return `volume ${vol(ind).toFixed(1)}× — bandeira precisa de volume SECANDO`;
    if (ind.alignment !== "aligned_bull") return `prazos em ${ind.alignment} — sem o maior junto não é perna`;

    const a = atrAbs(price, ind.atr14);
    const stop = ind.ema20 - a * 0.5;                 // perder a média mata a bandeira
    // MOVIMENTO MEDIDO: a perna seguinte tende a repetir a anterior, e a
    // anterior é aproximada pelo afastamento da EMA50 (a base do impulso). Um
    // múltiplo fixo de ATR aqui produzia alvo perto demais do stop estrutural —
    // o playbook nascia natimorto, reprovado pelo RR mínimo em quase todo caso.
    const leg = price - ind.ema50;
    const target = price + Math.max(leg, a * 3);
    return buildLongBracket(
      symbol, "trend_continuation", price, target, stop, ind.atrPct, 48,
      `bandeira acima da EMA20 com volume ${vol(ind).toFixed(1)}× (secando) — continuação da perna`,
      limits,
    ) ?? BRACKET_REJECTED;
  },
};

/**
 * BREAKOUT RETEST — o rompimento comprado com desconto e com prova. O preço
 * rompeu um nível, voltou para testá-lo POR CIMA e segurou: o antigo teto virou
 * chão. É o mesmo trade do `range_breakout`, só que sem pagar o topo.
 *
 * A diferença prática: aqui existe um stop óbvio e curto (abaixo do nível), o
 * que costuma dar RR melhor que perseguir o rompimento.
 */
const breakoutRetest: PlaybookDef = {
  id: "breakout_retest",
  label: "Reteste do rompimento",
  regimes: ["TRENDING_UP", "TRANSITIONING"],
  priority: 3,
  thesis: "nível rompido vira suporte; o reteste por cima é a entrada com stop curto",
  failsWhen: "o reteste não segura — aí o rompimento era falso e o nível volta a ser teto",
  plan(ind, limits) {
    const { symbol, price } = ind;
    if (price == null || !(price > 0)) return "sem preço";
    const level = ind.supports[0];
    if (level == null || !(level < price)) return "sem nível rompido embaixo";
    const a = atrAbs(price, ind.atr14);
    // "Voltou testar" = está a menos de meio ATR acima do nível. Mais longe que
    // isso não é reteste, é só uma alta que por acaso tem suporte embaixo.
    if (price - level > a * 0.5) return "longe do nível — não é reteste";
    if (ind.obvTrend === "falling") return "fluxo saindo no reteste — armadilha";

    const stop = floorAwareStop(price, level - a, a);  // perdeu o nível, perdeu a tese
    const target = ind.resistances[0] != null && ind.resistances[0] > price
      ? ind.resistances[0]
      : price + a * 3.5;
    return buildLongBracket(
      symbol, "breakout_retest", price, target, stop, ind.atrPct, 48,
      `reteste do nível ${level.toFixed(4)} por cima, fluxo ${ind.obvTrend ?? "?"} — teto virou chão`,
      limits,
    ) ?? BRACKET_REJECTED;
  },
};

// ── REVERSÃO ──────────────────────────────────────────────────────────────

/**
 * CAPITULATION REVERSAL — o único long em tendência de BAIXA, e com trava
 * dupla: exige divergência de alta no RSI (vendedor perdendo força) E preço no
 * terço inferior do range de 1 ano. Sem as duas, comprar queda é faca caindo —
 * foi assim que a rodada antiga sangrou.
 */
const capitulationReversal: PlaybookDef = {
  id: "capitulation_reversal",
  label: "Reversão de capitulação",
  regimes: ["TRENDING_DOWN"],
  priority: 1,
  thesis: "queda com divergência de alta perto do fundo do ciclo: o vendedor ficou sem força",
  failsWhen: "sempre que a queda tinha razão de ser — divergência não é fundo, é sinal de fadiga",
  plan(ind, limits) {
    const { symbol, price } = ind;
    if (price == null || !(price > 0)) return "sem preço";
    if (ind.divergence !== "bullish_rsi") return "queda sem divergência de exaustão — faca caindo";
    if (ind.rangePct == null) return "sem range de 1 ano para situar o fundo";
    if (ind.rangePct > 33) return `queda longe do fundo do ciclo (${ind.rangePct.toFixed(0)}% do range)`;

    const a = atrAbs(price, ind.atr14);
    const stop = price - a * 2;                        // reversão precisa de folga
    const target = ind.resistances[0] != null && ind.resistances[0] > price
      ? ind.resistances[0]
      : price + a * 4;
    return buildLongBracket(
      symbol, "capitulation_reversal", price, target, stop, ind.atrPct, 96,
      `divergência de alta a ${ind.rangePct.toFixed(0)}% do range de 1 ano — vendedor sem força`,
      limits,
    ) ?? BRACKET_REJECTED;
  },
};

/**
 * DIVERGENCE REVERSAL — a mesma divergência, sem a exigência de estar no fundo
 * do ciclo. Vale em mercado lateral ou em transição, onde uma divergência
 * costuma marcar o fim de uma perna curta.
 *
 * Gate própria: alvo modesto (a EMA20), porque sem tendência a favor não há
 * motivo para esperar muito mais que a volta à média.
 */
const divergenceReversal: PlaybookDef = {
  id: "divergence_reversal",
  label: "Reversão por divergência",
  regimes: ["RANGING"],
  priority: 4,
  thesis: "divergência de alta marca o fim da perna de baixa; alvo é a volta à média",
  failsWhen: "divergência em tendência forte só antecipa uma pausa, não uma virada",
  plan(ind, limits) {
    const { symbol, price } = ind;
    if (price == null || !(price > 0)) return "sem preço";
    if (ind.divergence !== "bullish_rsi") return "sem divergência de alta";
    if (ind.ema20 == null || !(ind.ema20 > price)) return "EMA20 abaixo do preço — sem espaço de volta à média";
    if (!rsiRising(ind)) return "RSI ainda não virou — divergência sem confirmação";

    const a = atrAbs(price, ind.atr14);
    const support = ind.supports[0];
    const stop = support != null && support < price ? support - a * 0.5 : price - a * 1.8;
    // Alvo é a própria média: sem tendência a favor, não há motivo para esperar
    // mais que a volta a ela. Quando a média está perto, o RR não fecha e o
    // bracket recusa — que é o certo: mean-reversion de perto não paga o risco.
    return buildLongBracket(
      symbol, "divergence_reversal", price, ind.ema20, stop, ind.atrPct, 36,
      `divergência de alta com RSI virando (${ind.rsiTrajectory.join("→")}) — alvo é a EMA20`,
      limits,
    ) ?? BRACKET_REJECTED;
  },
};

// ── FLUXO E ESTRUTURA ─────────────────────────────────────────────────────

/**
 * ABSORPTION — volume alto e preço parado significa que alguém está comprando
 * tudo que aparece. Quando o OBV sobe e o preço não, o comprador está absorvendo
 * a oferta em silêncio — e quando a oferta acaba, o preço anda.
 *
 * É o playbook mais sutil da biblioteca, e o que mais depende de o `relVol` e o
 * `obvTrend` estarem confiáveis.
 */
const absorption: PlaybookDef = {
  id: "absorption",
  label: "Absorção",
  regimes: ["RANGING"],
  priority: 5,
  thesis: "volume alto com preço parado e OBV subindo: comprador absorvendo a oferta",
  failsWhen: "o mesmo desenho aparece na distribuição — se o OBV estiver mentindo, compra-se de quem sai",
  plan(ind, limits) {
    const { symbol, price } = ind;
    if (price == null || !(price > 0)) return "sem preço";
    if (vol(ind) < 1.4) return `volume ${vol(ind).toFixed(1)}× — absorção exige volume acima da média`;
    if (ind.obvTrend !== "rising") return `fluxo ${ind.obvTrend ?? "desconhecido"} — não há comprador absorvendo`;
    if (ind.atrPct == null) return "sem ATR para saber se o preço está parado";
    if (ind.atrPct > 3) return `ATR ${ind.atrPct.toFixed(1)}% — preço andando, não absorvendo`;
    const support = ind.supports[0];
    if (support == null || !(support < price)) return "sem suporte mapeado embaixo";

    const a = atrAbs(price, ind.atr14);
    const stop = floorAwareStop(price, support - a, a);
    const target = ind.resistances[0] != null && ind.resistances[0] > price
      ? ind.resistances[0]
      : price + a * 3;
    return buildLongBracket(
      symbol, "absorption", price, target, stop, ind.atrPct, 48,
      `volume ${vol(ind).toFixed(1)}× com OBV subindo e ATR ${ind.atrPct.toFixed(1)}% — absorção`,
      limits,
    ) ?? BRACKET_REJECTED;
  },
};

/**
 * SUPPORT ACCUMULATION — o primo lento da absorção. Preço encostado num suporte
 * mapeado, fluxo comprador líquido entrando, sem exigir volume explosivo. É o
 * setup de acumular posição em quem já se decidiu, não de pegar o estalo.
 */
const supportAccumulation: PlaybookDef = {
  id: "support_accumulation",
  label: "Acumulação no suporte",
  regimes: ["RANGING", "TRENDING_UP"],
  priority: 6,
  thesis: "preço no suporte com fluxo comprador líquido: acumula antes do movimento",
  failsWhen: "o suporte não é suporte, só o último lugar onde o preço parou de cair",
  plan(ind, limits) {
    const { symbol, price } = ind;
    if (price == null || !(price > 0)) return "sem preço";
    if (ind.obvTrend !== "rising") return `fluxo ${ind.obvTrend ?? "desconhecido"} — sem comprador líquido`;
    const support = ind.supports[0];
    if (support == null || !(support < price)) return "sem suporte mapeado embaixo";

    const a = atrAbs(price, ind.atr14);
    // "Encostado" = a menos de 1 ATR do suporte. Longe disso não é acumulação
    // no suporte, é só uma compra qualquer com um suporte distante embaixo.
    if (price - support > a) return "longe do suporte — não é acumulação";
    if (ind.rsi14 != null && ind.rsi14 > 60) return `RSI ${ind.rsi14.toFixed(0)} — já esticou, não é acumulação`;

    const stop = floorAwareStop(price, support - a, a);
    const target = ind.resistances[0] != null && ind.resistances[0] > price
      ? ind.resistances[0]
      : price + a * 3;
    return buildLongBracket(
      symbol, "support_accumulation", price, target, stop, ind.atrPct, 60,
      `a menos de 1 ATR do suporte ${support.toFixed(4)} com OBV subindo — acumulação`,
      limits,
    ) ?? BRACKET_REJECTED;
  },
};

// ── O registro ────────────────────────────────────────────────────────────

export const PLAYBOOKS: PlaybookDef[] = [
  rangeReversion, rangeBreakout, pivotReversion,
  trendPullback, trendContinuation, breakoutRetest,
  capitulationReversal, divergenceReversal,
  absorption, supportAccumulation,
];

/** Os playbooks candidatos a um regime, na ordem em que o mecânico os tenta. */
export function playbooksFor(regime: MarketRegime): PlaybookDef[] {
  return PLAYBOOKS.filter((p) => p.regimes.includes(regime))
    .sort((a, b) => a.priority - b.priority);
}

/**
 * TODOS os planos viáveis para um símbolo — não só o escolhido.
 *
 * Guardar o caminho não tomado é o que permite descobrir, depois, se a escolha
 * foi boa: um agente que escolhe sempre o pior de três candidatos bons parece
 * idêntico a um que escolhe bem entre três ruins, se só o escolhido for
 * registrado.
 */
export function candidatePlans(ind: SymbolIndicators): StrategyPlan[] {
  return candidateAttempts(ind)
    .map((a) => a.plan)
    .filter((p): p is StrategyPlan => p !== null);
}

export interface PlaybookAttempt {
  def: PlaybookDef;
  /** O plano, quando o setup existe. */
  plan: StrategyPlan | null;
  /** Por que não operou, quando `plan` é null. */
  reason: string | null;
}

/**
 * Cada playbook do regime e o que aconteceu com ele — inclusive os que
 * recusaram, e por quê.
 *
 * É desta lista que sai o diagnóstico do painel. Sem ela, uma mesa parada é
 * indistinguível de uma mesa quebrada: as duas simplesmente não produzem trade.
 */
export function candidateAttempts(ind: SymbolIndicators, limits: BracketLimits = DEFAULT_LIMITS): PlaybookAttempt[] {
  if (ind.price == null || !(ind.price > 0)) {
    return playbooksFor(ind.regime).map((def) => ({ def, plan: null, reason: "sem preço" }));
  }
  return playbooksFor(ind.regime).map((def) => {
    const r = def.plan(ind, limits);
    return typeof r === "string"
      ? { def, plan: null, reason: r }
      : { def, plan: r, reason: null };
  });
}

// ── O que a plataforma AINDA não sabe reconhecer ──────────────────────────

export interface PlaybookGap {
  id: string;
  label: string;
  thesis: string;
  /** O dado que falta. Enquanto faltar, o playbook não existe. */
  blockedBy: string;
}

/**
 * Playbooks clássicos que NÃO foram implementados porque o dado para
 * reconhecê-los não existe nos indicadores de hoje.
 *
 * Estão declarados em vez de aproximados de propósito. Um playbook feito com
 * proxy ruim é pior que um playbook ausente: ele opera, entra no ledger, e
 * envenena a medição de todos os outros — e ninguém desconfia, porque ele tem
 * a mesma aparência dos que funcionam.
 */
export const PLAYBOOK_GAPS: PlaybookGap[] = [
  {
    id: "failed_breakout",
    label: "Rompimento falso (liquidity sweep)",
    thesis: "rompe a máxima, não sustenta e volta pra dentro — o estopim de quem comprou o topo vira combustível",
    blockedBy: "exige a TRAJETÓRIA do preço nas últimas barras; hoje só temos o último fechamento e a trajetória do RSI",
  },
  {
    id: "volatility_squeeze",
    label: "Compressão de volatilidade",
    thesis: "ATR/Bollinger no menor valor em N períodos antecede expansão; entra na direção do rompimento",
    blockedBy: "exige o PERCENTIL histórico do ATR; hoje só temos o ATR corrente, que não diz se está comprimido",
  },
  {
    id: "vwap_reversion",
    label: "Reversão à VWAP",
    thesis: "desvio de 2σ da VWAP contra a tendência costuma voltar à média ponderada por volume",
    blockedBy: "não calculamos VWAP — só EMA, que não é ponderada por volume e não serve de substituto honesto",
  },
  {
    id: "opening_range",
    label: "Rompimento da faixa de abertura",
    thesis: "a faixa das primeiras horas do dia define o viés da sessão",
    blockedBy: "exige recorte de sessão; em cripto o mercado é 24h e a 'abertura' teria de ser definida por convenção antes de valer alguma coisa",
  },
];
