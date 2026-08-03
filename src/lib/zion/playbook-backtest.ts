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
import { DEFAULT_LIMITS, type ActivePlaybook, type BracketLimits } from "@/lib/zion/bracket";

/** Candle com tempo — o que a resolução precisa. */
export interface TimedCandle extends Candle { t: number }

/**
 * O registro de UM trade — com o caminho, não só o desfecho.
 *
 * ⚠️ POR QUE O CAMINHO (03/08, depois da primeira medição séria).
 *
 * A janela de 6 meses devolveu 419 trades e TODOS os nove playbooks negativos,
 * o melhor em −0.21% — que é, quase exatamente, o custo de ida-e-volta. Ou
 * seja: bruto ≈ zero, nenhuma vantagem. Esse número responde "paga?" com um
 * não, e não responde NADA sobre o porquê. E sem o porquê não há conserto: dá
 * só para trocar de estratégia no escuro até algum resultado parecer bom por
 * sorte, que é como se produz um sistema que quebra com dinheiro real.
 *
 * As excursões respondem o porquê. Se o preço andava 60% do caminho até o alvo
 * e voltava, o problema é o ALVO (longe demais), não a tese. Se os perdedores
 * furavam o stop por um triz e depois recuperavam, o problema é o STOP (perto
 * demais). São dois consertos opostos, e o desfecho sozinho não distingue os
 * dois.
 */
export interface Outcome {
  regime: MarketRegime;
  netPct: number;
  reason: "target" | "stop" | "expired";
  win: boolean;
  /** Excursão favorável máxima até o desfecho, em % da entrada. */
  mfePct: number;
  /** Excursão adversa máxima até o desfecho, em % da entrada (negativa). */
  maePct: number;
  /** Distância PLANEJADA até o alvo, em % da entrada. */
  targetPct: number;
  /** Distância PLANEJADA até o stop, em % da entrada. */
  stopPct: number;
  /** RR planejado no bracket (o que o validador exigiu ≥ MIN_RR). */
  plannedRr: number;
  /** A vela que resolveu tocou alvo E stop — a convenção stop-first decidiu. */
  straddled: boolean;
  /**
   * O MESMO SETUP, ESPELHADO — a hipótese do "compra quando ele diz que tá ruim".
   *
   * O dono brincou que se ele fizesse o contrário do que a mesa manda, lucraria.
   * A brincadeira tem aritmética: se a expectância é consistentemente negativa,
   * o espelho dela é positivo menos o custo pago duas vezes.
   *
   * ⚠️ MAS INVERTER O SINAL DO RESULTADO SERIA BATOTA, e de um jeito sutil.
   *
   * Quando uma vela cruza alvo E stop, a convenção pessimista faz o LONG
   * registrar o stop. Se o espelho fosse só `−netPct`, essa mesma vela viraria
   * um ALVO batido no short — a pessimista viraria otimista na tradução, e o
   * inverso apareceria melhor do que é exatamente nas velas mais violentas.
   *
   * Por isso o espelho é uma posição DE VERDADE: bracket refletido em torno da
   * entrada (stop acima, alvo abaixo), lado `sell`, resolvido pelo MESMO
   * `computeExitPath` com a MESMA pessimismo. O short também perde o straddle.
   */
  inverseNetPct: number;
  inverseReason: "target" | "stop" | "expired";
}

/**
 * O DIAGNÓSTICO — os números que dizem o que consertar.
 *
 * `netPerTrade` é o veredito. Isto aqui é a causa.
 */
export interface PlaybookDiag {
  /** RR médio que o bracket PROMETEU (o validador exige ≥ 1.8). */
  plannedRr: number;
  /** RR que o mercado PAGOU: |ganho médio| / |perda média|. */
  realizedRr: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  /** Fração dos trades que venceram o horizonte sem tocar nada. */
  expiredShare: number;
  /**
   * Mediana de (excursão favorável ÷ distância até o alvo).
   *
   * 1.0 = o preço chegou no alvo. 0.5 = andou metade do caminho e voltou —
   * e aí o alvo estava no lugar errado, não a tese.
   */
  mfeToTarget: number | null;
  /**
   * Mediana de (excursão adversa ÷ distância até o stop) nos trades que NÃO
   * stoparam. Perto de 1.0 significa que o stop está encostado no ruído: os
   * sobreviventes passaram raspando, então os mortos morreram por pouco.
   */
  maeToStop: number | null;
  /** Quantos desfechos vieram da convenção pessimista (vela cruzou os dois). */
  straddles: number;
  /**
   * O MESMO SETUP ESPELHADO — "e se eu fizesse o contrário?".
   *
   * Não é `−netPerTrade`: é uma posição vendida de verdade, com o bracket
   * refletido, resolvida pelo mesmo motor e perdendo os mesmos straddles. A
   * diferença entre este número e o simétrico do original É o custo da
   * convenção pessimista, e ele aparece nas duas pontas em vez de sumir numa.
   *
   * ⚠️ ANTES DE COMEMORAR UM POSITIVO AQUI: inverter um long vira um SHORT, que
   * não é a mesma coisa com o sinal trocado. Short paga funding, exige margem,
   * pode ser liquidado e tem perda sem teto. E, o mais importante: num mercado
   * que CAIU na janela, qualquer short lucra sem que isso seja vantagem —
   * `buyHoldPct` está do lado justamente para essa leitura.
   */
  inverseNetPerTrade: number;
}

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
  /** Por que o número acima é o que é. `null` quando não houve trade. */
  diag: PlaybookDiag | null;
}

export interface BacktestResult {
  symbol: string;
  /** Barras efetivamente avaliadas (depois do aquecimento dos indicadores). */
  barsTested: number;
  stats: PlaybookStat[];
  /**
   * O que o SÍMBOLO fez na janela, em %.
   *
   * Sem isto o resultado é ilegível. "Todos os playbooks negativos" significa
   * coisas opostas conforme o mercado tenha subido 80% (a biblioteca é ruim) ou
   * caído 40% (mesas long-only perdendo MENOS que o mercado estariam, na
   * verdade, protegendo). O veredito precisa do denominador do lado.
   */
  buyHoldPct: number | null;
  /** Os trades crus, para o merge somar sem média-de-médias. */
  outcomes?: Array<{ playbook: ActivePlaybook; outcome: Outcome }>;
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
  plannedRr: number;
  pos: {
    side: string; entry_price: number; cost_usd: number;
    target_price: number; stop_price: number; opened_at: string; horizon_hours: number;
  };
}

/**
 * O caminho que o preço percorreu enquanto o trade esteve vivo.
 *
 * Vai até a barra que RESOLVEU, inclusive — e para ali. Continuar depois disso
 * seria olhar o futuro de uma posição já fechada: o preço podia disparar uma
 * hora depois do stop, e contar essa subida como "excursão favorável" faria o
 * stop parecer errado por um movimento que o trade nunca viveu.
 */
function excursions(
  entry: number, bars: Candle[], stop: number, target: number,
): { mfePct: number; maePct: number; straddled: boolean } {
  let hi = entry, lo = entry, straddled = false;
  for (const c of bars) {
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
    const hitStop = c.low <= stop, hitTarget = c.high >= target;
    if (hitStop || hitTarget) { straddled = hitStop && hitTarget; break; }
  }
  return {
    mfePct: ((hi - entry) / entry) * 100,
    maePct: ((lo - entry) / entry) * 100,
    straddled,
  };
}

/**
 * Quantas barras de história cada retrato enxerga.
 *
 * ⚠️ ISTO NÃO É SÓ OTIMIZAÇÃO (03/08, ao abrir a janela para 6 meses).
 *
 * A versão anterior passava a série INTEIRA até a barra `i` — e como
 * `calcSupportResistance` varre o array todo procurando pivôs, o custo por
 * barra crescia com a posição dela. Numa janela de 33 dias isso passava
 * despercebido; em 6 meses (~4.400 barras) o backtest levaria uns dois minutos
 * e estouraria o teto de 60s da rota, silenciosamente devolvendo menos símbolos.
 *
 * Mas o motivo principal não é custo, é CORREÇÃO. Um suporte formado quatro
 * meses atrás não é o suporte que decide um trade de 48 horas. Com a série
 * inteira, um pivô antigo e irrelevante competia com os recentes e às vezes
 * vencia por estar mais perto do preço por acaso. A janela deslizante faz o
 * retrato ver o que um trader veria: as últimas semanas.
 *
 * 400 barras ≈ 17 dias. Folgado para a EMA50 convergir (a memória dela é
 * exponencial: além de ~8× o período a contribuição é irrelevante), para o
 * ADX14, para a divergência (60 velas) e para o volume relativo (20).
 *
 * Efeito colateral honesto: os números mudam em relação à rodada anterior. Não
 * é ruído — é o retrato deixando de olhar para trás demais.
 */
export const INDICATOR_WINDOW = 400;

/**
 * Corta as séries no instante da barra `i`, com janela LIMITADA.
 *
 * As séries de prazo maior são cortadas PROPORCIONALMENTE (4h a cada 4 barras
 * de 1h, 1d a cada 24, 1w a cada 168). Isso pressupõe que as quatro séries
 * terminam no mesmo instante e são contíguas — verdade quando vêm da mesma
 * coleta. Um desalinhamento aqui adiantaria no máximo uma barra de prazo maior,
 * o que muda um filtro de tendência, não a geometria do trade.
 *
 * As de prazo maior NÃO são limitadas pela janela: 200 velas diárias são oito
 * meses, e é justamente de lá que saem o range de 1 ano e a estrutura de ciclo.
 */
function sliceAt(
  i: number, c1h: Candle[], c4h: Candle[], c1d: Candle[], c1w: Candle[],
): [Candle[], Candle[], Candle[], Candle[]] {
  const n = i + 1;
  return [
    c1h.slice(Math.max(0, n - INDICATOR_WINDOW), n),
    c4h.slice(0, Math.max(1, Math.floor(n / 4))),
    c1d.slice(0, Math.max(1, Math.floor(n / 24))),
    c1w.slice(0, Math.max(1, Math.floor(n / 168))),
  ];
}

/** Mediana — resistente ao trade único e absurdo, que a média não é. */
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * O diagnóstico de um conjunto de trades. Separado de `summarize` para poder
 * receber a lista JUNTA de vários símbolos — mediana de medianas não é mediana,
 * então o merge precisa dos trades crus, não dos resumos.
 */
export function diagnose(outcomes: Outcome[]): PlaybookDiag | null {
  if (outcomes.length === 0) return null;
  const resolved = outcomes.filter((o) => o.reason !== "expired");
  const wins = resolved.filter((o) => o.win).map((o) => o.netPct);
  const losses = resolved.filter((o) => !o.win).map((o) => o.netPct);
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : null;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : null;
  return {
    plannedRr: outcomes.reduce((s, o) => s + o.plannedRr, 0) / outcomes.length,
    // Só faz sentido com as duas pontas: sem uma perda sequer, dividir por zero
    // devolveria "infinito", que na tela viraria a mentira mais otimista possível.
    realizedRr: avgWin != null && avgLoss != null && avgLoss < 0 ? avgWin / -avgLoss : null,
    avgWinPct: avgWin, avgLossPct: avgLoss,
    expiredShare: outcomes.filter((o) => o.reason === "expired").length / outcomes.length,
    mfeToTarget: median(outcomes.filter((o) => o.targetPct > 0).map((o) => o.mfePct / o.targetPct)),
    // Nos que stoparam, a excursão adversa É o stop por definição — incluí-los
    // faria a mediana valer 1.0 sempre e não diria nada.
    maeToStop: median(
      outcomes.filter((o) => o.reason !== "stop" && o.stopPct > 0).map((o) => -o.maePct / o.stopPct),
    ),
    straddles: outcomes.filter((o) => o.straddled).length,
    inverseNetPerTrade: outcomes.reduce((s, o) => s + o.inverseNetPct, 0) / outcomes.length,
  };
}

/** Agrega os resultados de um playbook. Pura, para ser testável sozinha. */
export function summarize(
  playbook: ActivePlaybook,
  outcomes: Array<{ regime: MarketRegime; netPct: number; reason: "target" | "stop" | "expired"; win: boolean } & Partial<Outcome>>,
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
    // Só diagnostica quando os trades trazem o caminho. Fixture antiga (sem as
    // excursões) continua somando o veredito e devolve `null` aqui, em vez de
    // inventar um zero que a tela leria como "andou nada".
    diag: outcomes.every((o) => o.mfePct !== undefined) ? diagnose(outcomes as Outcome[]) : null,
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
  /**
   * Os níveis de cautela a usar NESTA rodada.
   *
   * Existe para a varredura de calibragem: a mesma janela, os mesmos dados, e
   * só a trava mudando. Sem isto, "está conservador demais?" só podia ser
   * respondido com opinião.
   */
  limits: BracketLimits = DEFAULT_LIMITS,
): BacktestResult {
  const outcomes = new Map<ActivePlaybook, Outcome[]>();
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
      const e = tr.pos.entry_price;
      const ex = excursions(e, future, tr.pos.stop_price, tr.pos.target_price);

      // O ESPELHO: mesma entrada, bracket refletido, lado vendido. Resolvido
      // pelo mesmo motor e com a mesma convenção pessimista — o short também
      // perde quando a vela cruza os dois lados.
      const espelho = computeExitPath({
        ...tr.pos, side: "sell",
        stop_price: e + (e - tr.pos.stop_price),      // o stop do long vira o alvo
        target_price: e - (tr.pos.target_price - e),  // e o alvo vira o stop
      }, future, undefined, bar.t);
      const list = outcomes.get(pb) ?? [];
      list.push({
        regime: tr.regime, netPct: v.netPct, reason: v.reason, win: v.win,
        ...ex,
        targetPct: ((tr.pos.target_price - e) / e) * 100,
        stopPct: ((e - tr.pos.stop_price) / e) * 100,
        plannedRr: tr.plannedRr,
        // Espelho ainda em aberto no fim da janela conta como expirado a zero —
        // não inventa resultado para o lado que não fechou.
        inverseNetPct: espelho?.netPct ?? 0,
        inverseReason: espelho?.reason ?? "expired",
      });
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
    for (const att of candidateAttempts(ind, limits)) {
      if (!att.plan) continue;
      // COOLDOWN: o mesmo setup persiste por várias barras. Sem isto, um único
      // movimento vira dezenas de "trades" quase idênticos e infla a amostra
      // com a mesma observação repetida.
      if (open.has(att.plan.playbook)) continue;
      open.set(att.plan.playbook, {
        playbook: att.plan.playbook,
        regime: ind.regime,
        openedIdx: i,
        plannedRr: att.plan.rr,
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

  // O denominador do veredito: o que o símbolo fez na MESMA janela em que os
  // playbooks foram medidos — do fim do aquecimento até o fim da série, não da
  // primeira barra baixada.
  const first = c1h[WARMUP_BARS], last = c1h[c1h.length - 1];
  const buyHoldPct = first && last && first.close > 0
    ? ((last.close - first.close) / first.close) * 100
    : null;

  return {
    symbol, barsTested, stats, buyHoldPct,
    outcomes: [...outcomes.entries()].flatMap(([playbook, list]) => list.map((outcome) => ({ playbook, outcome }))),
  };
}

/**
 * Junta o resultado de vários símbolos num só painel por playbook.
 *
 * Quando os trades CRUS vêm junto (`outcomes`), o merge é feito neles e o
 * diagnóstico sai correto — mediana de medianas não é mediana, e somar RR
 * realizado por média ponderada daria um número que não corresponde a trade
 * nenhum. Sem eles, cai no merge antigo, que só sabe somar o veredito.
 */
export function mergeResults(results: BacktestResult[]): PlaybookStat[] {
  if (results.length > 0 && results.every((r) => r.outcomes)) {
    const byPb = new Map<ActivePlaybook, Outcome[]>();
    for (const r of results) {
      for (const { playbook, outcome } of r.outcomes!) {
        const list = byPb.get(playbook) ?? [];
        list.push(outcome);
        byPb.set(playbook, list);
      }
    }
    return [...byPb.entries()]
      .map(([pb, list]) => summarize(pb, list))
      .sort((a, b) => (b.netPerTrade ?? -Infinity) - (a.netPerTrade ?? -Infinity));
  }

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
      diag: null,   // sem os trades crus não há diagnóstico honesto a dar
    };
  }).sort((a, b) => (b.netPerTrade ?? -Infinity) - (a.netPerTrade ?? -Infinity));
}
