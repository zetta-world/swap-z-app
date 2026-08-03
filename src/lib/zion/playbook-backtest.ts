/**
 * BACKTEST POR PLAYBOOK — transformar palpite em fato.
 *
 * POR QUE ISTO EXISTE:
 *
 * A biblioteca declara uma coluna `priority` que decide qual estratégia o
 * seletor mecânico tenta primeiro. Ela sempre foi um PALPITE — a ordem clássica
 * ("o setup mais específico vence o mais genérico") — e o próprio código diz
 * isso em comentário. Enquanto ela for palpite, o VÖLUNDR pode estar escolhendo
 * na ordem errada em algum regime, e ninguém saberia.
 *
 * Medir cada playbook ISOLADO no histórico é o que substitui a coluna.
 *
 * A ARMADILHA CENTRAL DE QUALQUER BACKTEST é olhar o futuro sem perceber. Aqui
 * ela é evitada por construção, não por cuidado:
 *
 *  · `computeIndicators` é PURA e recebe as séries de candles. Para reconstruir
 *    o retrato técnico da barra `i`, passamos as séries CORTADAS em `i`. Não há
 *    como um indicador enxergar adiante, porque o dado adiante não está no
 *    argumento.
 *  · A resolução usa exclusivamente as barras DEPOIS de `i`, pelo mesmo
 *    `computeExitPath` que resolve as posições de verdade — inclusive a
 *    convenção stop-first pessimista quando uma vela cruza alvo e stop.
 *
 * A SEGUNDA ARMADILHA, menos conhecida e mais destrutiva: o mesmo setup
 * costuma continuar válido por várias barras seguidas. Registrar um "trade" a
 * cada barra produziria dezenas de observações quase idênticas do MESMO evento —
 * uma amostra que parece grande e não é, porque as observações são a mesma
 * coisa contada muitas vezes. Um playbook sortudo num movimento único viraria
 * "50 trades vencedores". Por isso existe o COOLDOWN: enquanto um trade daquele
 * playbook estiver em aberto naquele símbolo, o playbook não abre outro.
 *
 * O QUE ESTE MÓDULO NÃO RESOLVE, e nenhum backtest resolve:
 *
 *  · Liquidez e slippage reais — assume-se preenchimento no preço da barra.
 *  · Sobrevivência: mede-se os símbolos que existem HOJE, e quem quebrou no
 *    caminho não está na lista.
 *  · Que o passado se repita. Um playbook lucrativo aqui é um playbook que
 *    lucrou NAQUELE mercado. É evidência, não promessa.
 */

import { computeIndicators, type Candle, type SymbolIndicators, type MarketRegime } from "@/lib/api/market-indicators";
import { computeExitPath } from "@/lib/paper/engine";
import { candidateAttempts } from "@/lib/zion/playbooks";
import type { ActivePlaybook } from "@/lib/zion/bracket";

/** Candle com tempo — o que a resolução precisa. */
export interface TimedCandle extends Candle { t: number }

export interface PlaybookStat {
  playbook: ActivePlaybook;
  /** Trades que RESOLVERAM (alvo, stop ou horizonte). */
  decided: number;
  wins: number;
  losses: number;
  /** Horizonte vencido sem tocar nada. Não é vitória nem derrota. */
  expired: number;
  /** Expectância LÍQUIDA por trade, em %. `null` sem amostra. */
  netPerTrade: number | null;
  /** Taxa de acerto — secundária: o mandato é acumular USDT, não acertar. */
  winRate: number | null;
  /** Desempenho por regime — é aqui que mora a resposta útil. */
  byRegime: Partial<Record<MarketRegime, { decided: number; netPerTrade: number }>>;
}

export interface BacktestResult {
  symbol: string;
  /** Barras efetivamente avaliadas (depois do aquecimento dos indicadores). */
  barsTested: number;
  stats: PlaybookStat[];
}

/**
 * Quantas barras o retrato técnico precisa antes de significar alguma coisa.
 *
 * EMA50 sobre uma série de 30 barras é um número, mas não é uma EMA50. Começar
 * antes disso encheria a amostra de sinais gerados a partir de indicadores
 * ainda meio-formados — e eles entrariam na conta com o mesmo peso dos bons.
 */
export const WARMUP_BARS = 220;

interface OpenTrade {
  playbook: ActivePlaybook;
  regime: MarketRegime;
  openedIdx: number;
  pos: {
    side: string; entry_price: number; cost_usd: number;
    target_price: number; stop_price: number; opened_at: string; horizon_hours: number;
  };
}

/**
 * Corta as séries no instante da barra `i`.
 *
 * As séries de prazo maior são cortadas PROPORCIONALMENTE (4h a cada 4 barras
 * de 1h, 1d a cada 24, 1w a cada 168). Isso pressupõe que as quatro séries
 * terminam no mesmo instante e são contíguas — verdade quando vêm da mesma
 * coleta. É uma aproximação, e vale dizer: um desalinhamento aqui adiantaria
 * no máximo uma barra de prazo maior, o que muda um filtro de tendência, não a
 * geometria do trade.
 */
function sliceAt(
  i: number, c1h: Candle[], c4h: Candle[], c1d: Candle[], c1w: Candle[],
): [Candle[], Candle[], Candle[], Candle[]] {
  const n = i + 1;
  return [
    c1h.slice(0, n),
    c4h.slice(0, Math.max(1, Math.floor(n / 4))),
    c1d.slice(0, Math.max(1, Math.floor(n / 24))),
    c1w.slice(0, Math.max(1, Math.floor(n / 168))),
  ];
}

/** Agrega os resultados de um playbook. Pura, para ser testável sozinha. */
export function summarize(
  playbook: ActivePlaybook,
  outcomes: Array<{ regime: MarketRegime; netPct: number; reason: "target" | "stop" | "expired"; win: boolean }>,
): PlaybookStat {
  const decided = outcomes.length;
  const expired = outcomes.filter((o) => o.reason === "expired").length;
  // A EXPIRADA SAI DAS DUAS PONTAS do win-rate, não só do denominador.
  //
  // Uma expirada que fechou no positivo tem `win: true` (o P&L é real, e conta
  // na expectância). Mas se ela entrasse no NUMERADOR e não no denominador, o
  // win-rate passaria de 100% com metade dos trades tendo sido derrota — foi
  // exatamente o que o teste pegou.
  const resolved = outcomes.filter((o) => o.reason !== "expired");
  const wins = resolved.filter((o) => o.win).length;
  const losses = resolved.length - wins;
  const byRegime: PlaybookStat["byRegime"] = {};
  for (const r of ["RANGING", "TRENDING_UP", "TRENDING_DOWN", "TRANSITIONING"] as MarketRegime[]) {
    const sub = outcomes.filter((o) => o.regime === r);
    if (sub.length === 0) continue;
    byRegime[r] = {
      decided: sub.length,
      netPerTrade: sub.reduce((s, o) => s + o.netPct, 0) / sub.length,
    };
  }
  return {
    playbook, decided, wins, losses, expired,
    netPerTrade: decided > 0 ? outcomes.reduce((s, o) => s + o.netPct, 0) / decided : null,
    // Expirada NÃO conta como vitória nem derrota no win-rate — é a mesma regra
    // do flywheel. Contá-la como derrota puniria a paciência; como vitória,
    // premiaria a indecisão.
    winRate: resolved.length > 0 ? wins / resolved.length : null,
    byRegime,
  };
}

/**
 * Roda a biblioteca inteira sobre uma série histórica e devolve o desempenho de
 * CADA playbook, isolado.
 *
 * Todos os candidatos de cada barra são avaliados — não só o que o seletor
 * escolheria. É essa a diferença entre medir a ESTRATÉGIA e medir o ESCOLHEDOR:
 * a segunda é a pergunta do duelo MÍMIR × VÖLUNDR, e depende da primeira estar
 * respondida.
 */
export function backtestPlaybooks(
  symbol: string,
  c1h: TimedCandle[],
  c4h: Candle[] = [],
  c1d: Candle[] = [],
  c1w: Candle[] = [],
): BacktestResult {
  const outcomes = new Map<ActivePlaybook, Array<{ regime: MarketRegime; netPct: number; reason: "target" | "stop" | "expired"; win: boolean }>>();
  const open = new Map<ActivePlaybook, OpenTrade>();
  let barsTested = 0;

  for (let i = WARMUP_BARS; i < c1h.length - 1; i++) {
    const bar = c1h[i];
    barsTested++;

    // 1) Fecha o que já resolveu, usando SÓ as barras posteriores à abertura.
    for (const [pb, tr] of [...open.entries()]) {
      const future = c1h.slice(tr.openedIdx + 1, i + 1);
      const v = computeExitPath(tr.pos, future, undefined, bar.t);
      if (!v) continue;
      const list = outcomes.get(pb) ?? [];
      list.push({ regime: tr.regime, netPct: v.netPct, reason: v.reason, win: v.win });
      outcomes.set(pb, list);
      open.delete(pb);
    }

    // 2) Retrato técnico com a história CORTADA em `i`.
    let ind: SymbolIndicators;
    try {
      const [s1h, s4h, s1d, s1w] = sliceAt(i, c1h, c4h, c1d, c1w);
      ind = computeIndicators(symbol, s1h, s4h, s1d, s1w);
    } catch { continue; }

    // 3) TODOS os candidatos daquela barra — não só o que seria escolhido.
    for (const att of candidateAttempts(ind)) {
      if (!att.plan) continue;
      // COOLDOWN: o mesmo setup persiste por várias barras. Sem isto, um único
      // movimento vira dezenas de "trades" quase idênticos e infla a amostra
      // com a mesma observação repetida.
      if (open.has(att.plan.playbook)) continue;
      open.set(att.plan.playbook, {
        playbook: att.plan.playbook,
        regime: ind.regime,
        openedIdx: i,
        pos: {
          side: "buy", entry_price: att.plan.entry, cost_usd: 100,
          target_price: att.plan.target, stop_price: att.plan.stop,
          opened_at: new Date(bar.t).toISOString(),
          horizon_hours: att.plan.horizonHours,
        },
      });
    }
  }

  // Trades ainda em aberto no fim da série NÃO entram: o resultado deles é
  // desconhecido, e chutar o fechamento pelo último preço premiaria quem tem
  // horizonte longo justamente na janela em que ele não foi testado.
  const stats = [...outcomes.entries()]
    .map(([pb, list]) => summarize(pb, list))
    .sort((a, b) => (b.netPerTrade ?? -Infinity) - (a.netPerTrade ?? -Infinity));

  return { symbol, barsTested, stats };
}

/** Junta o resultado de vários símbolos num só painel por playbook. */
export function mergeResults(results: BacktestResult[]): PlaybookStat[] {
  const byPb = new Map<ActivePlaybook, PlaybookStat[]>();
  for (const r of results) {
    for (const s of r.stats) {
      const list = byPb.get(s.playbook) ?? [];
      list.push(s);
      byPb.set(s.playbook, list);
    }
  }
  return [...byPb.entries()].map(([pb, list]) => {
    const decided = list.reduce((n, s) => n + s.decided, 0);
    const wins = list.reduce((n, s) => n + s.wins, 0);
    const expired = list.reduce((n, s) => n + s.expired, 0);
    const losses = list.reduce((n, s) => n + s.losses, 0);
    // Média PONDERADA por número de trades. A média das médias daria o mesmo
    // peso a um símbolo com 3 trades e a outro com 300.
    const net = decided > 0
      ? list.reduce((s, x) => s + (x.netPerTrade ?? 0) * x.decided, 0) / decided
      : null;
    const byRegime: PlaybookStat["byRegime"] = {};
    for (const r of ["RANGING", "TRENDING_UP", "TRENDING_DOWN", "TRANSITIONING"] as MarketRegime[]) {
      const parts = list.map((s) => s.byRegime[r]).filter(Boolean) as Array<{ decided: number; netPerTrade: number }>;
      const d = parts.reduce((n, p) => n + p.decided, 0);
      if (d === 0) continue;
      byRegime[r] = { decided: d, netPerTrade: parts.reduce((s, p) => s + p.netPerTrade * p.decided, 0) / d };
    }
    return {
      playbook: pb, decided, wins, losses, expired,
      netPerTrade: net,
      winRate: decided - expired > 0 ? wins / (decided - expired) : null,
      byRegime,
    };
  }).sort((a, b) => (b.netPerTrade ?? -Infinity) - (a.netPerTrade ?? -Infinity));
}
