import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { fetchTimedCandles } from "@/lib/api/market-indicators";
import { backtestPlaybooks, mergeResults, WARMUP_BARS } from "@/lib/zion/playbook-backtest";
import { DEFAULT_LIMITS, type BracketLimits } from "@/lib/zion/bracket";
import { recordEvent } from "@/lib/admin/track";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * VARREDURA DE CALIBRAGEM — "estamos conservadores demais?", com número.
 *
 * O dono disse: "focamos tanto em ser conservador que os níveis de pessimista e
 * otimista não estão bem calibrados". É uma hipótese, e até agora não havia como
 * testá-la: cada trava era constante lida do ambiente na importação, então mudar
 * uma exigia deploy e comparar duas exigia memória.
 *
 * Discutir calibragem sem poder variar o parâmetro é chute com vocabulário
 * técnico. Isto roda a MESMA janela, sobre os MESMOS dados, mexendo em UMA trava
 * por vez — e a pergunta passa a ter resposta.
 *
 * ⚠️ O QUE ESTA ROTA NÃO FAZ: escolher. Ela mede e devolve. Adotar o melhor
 * número de uma varredura é o caminho mais curto para o sobreajuste — a mesma
 * janela que escolheu o parâmetro não pode ser a que o valida, e o resultado de
 * 03/08 (um playbook positivo que virou negativo em seis horas) mostrou o quanto
 * esta janela ainda balança.
 *
 * Ela também é MAIS CARA que o backtest normal: são N rodadas completas. Por
 * isso o recorte de símbolos é menor e o teto de barras, menor.
 */

const SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "LINK", "ADA"];
const BARS_1H = Number(process.env.CALIBRATION_BARS ?? 2200);

/**
 * As variações a testar, uma trava por vez.
 *
 * Cada linha muda UM valor em relação ao padrão. Variar dois de uma vez
 * devolveria um resultado sem dono — não daria para saber qual dos dois moveu.
 */
const VARIACOES: Array<{ nome: string; oQueMuda: string; limits: Partial<BracketLimits> }> = [
  { nome: "padrão (hoje)", oQueMuda: "os valores de fábrica, como referência", limits: {} },

  { nome: "RR 1.5", oQueMuda: "aceita bracket que paga 1.5× o risco (hoje: 1.8)", limits: { minRr: 1.5 } },
  { nome: "RR 1.2", oQueMuda: "aceita quase 1:1 — mais trades, menos margem por trade", limits: { minRr: 1.2 } },
  { nome: "RR 2.5", oQueMuda: "só bracket generoso — menos trades, mais exigente", limits: { minRr: 2.5 } },

  { nome: "alvo 1.2× ATR", oQueMuda: "alvo tem que caber FOLGADO no horizonte", limits: { maxTargetAtrMult: 1.2 } },
  { nome: "alvo 3.0× ATR", oQueMuda: "aceita alvo mais ambicioso para o prazo", limits: { maxTargetAtrMult: 3.0 } },
  { nome: "alvo sem trava", oQueMuda: "volta ao comportamento anterior a 03/08", limits: { maxTargetAtrMult: 999 } },

  { nome: "stop 1.0× ATR", oQueMuda: "stop mais apertado (hoje: 1.5× ATR)", limits: { minStopAtr: 1.0 } },
  { nome: "stop 2.0× ATR", oQueMuda: "stop mais folgado — menos morte por ruído", limits: { minStopAtr: 2.0 } },
  { nome: "stop 2.5× ATR", oQueMuda: "bem folgado: arrisca mais por trade", limits: { minStopAtr: 2.5 } },
];

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();

  // As velas são baixadas UMA vez e reusadas em todas as variações. É o que
  // torna a comparação honesta: mesma janela, mesmos dados, só a trava mudando.
  const series = await Promise.all(SYMBOLS.map(async (symbol) => ({
    symbol,
    c1h: await fetchTimedCandles(symbol, "1h", BARS_1H),
    c4h: await fetchTimedCandles(symbol, "4h", 600),
    c1d: await fetchTimedCandles(symbol, "1d", 120),
    c1w: await fetchTimedCandles(symbol, "1w", 40),
  })));
  const usaveis = series.filter((s) => s.c1h.length >= WARMUP_BARS + 20);
  if (usaveis.length === 0) {
    return NextResponse.json({ error: "sem candles" }, { status: 503 });
  }

  const linhas = VARIACOES.map(({ nome, oQueMuda, limits }) => {
    const l: BracketLimits = { ...DEFAULT_LIMITS, ...limits };
    const stats = mergeResults(usaveis.map((s) => backtestPlaybooks(s.symbol, s.c1h, s.c4h, s.c1d, s.c1w, l)));
    const trades = stats.reduce((n, x) => n + x.decided, 0);
    const net = trades > 0
      ? stats.reduce((sum, x) => sum + (x.netPerTrade ?? 0) * x.decided, 0) / trades
      : null;
    // O TOTAL importa tanto quanto a média: uma trava que melhora a média
    // cortando 90% dos trades não melhorou nada, só escolheu melhor a dedo.
    const total = trades > 0 ? (net ?? 0) * trades : 0;
    const wins = stats.reduce((n, x) => n + x.wins, 0);
    const losses = stats.reduce((n, x) => n + x.losses, 0);
    return {
      nome, oQueMuda, trades,
      netPerTrade: net,
      totalPct: total,
      winRate: wins + losses > 0 ? wins / (wins + losses) : null,
      porPlaybook: stats
        .filter((x) => x.decided >= 15)
        .map((x) => ({ playbook: x.playbook, n: x.decided, net: x.netPerTrade })),
    };
  });

  const base = linhas[0];
  // AWAIT obrigatório: sem ele o insert perde a corrida contra o congelamento
  // da função serverless e a varredura some sem deixar rastro. Ver a nota em
  // what-worked/route.ts e o comentário dentro de recordEvent.
  await recordEvent("calibration_sweep", { meta: {
    symbols: usaveis.length, bars: BARS_1H,
    baseNet: base.netPerTrade, baseTrades: base.trades,
    melhor: [...linhas].sort((a, b) => (b.netPerTrade ?? -9) - (a.netPerTrade ?? -9))[0]?.nome,
  } });

  return NextResponse.json({
    linhas,
    symbols: usaveis.map((s) => s.symbol),
    windowDays: Math.round((BARS_1H - WARMUP_BARS) / 24),
    // A ressalva viaja com o resultado, não num rodapé que ninguém lê.
    aviso: "Isto MEDE, não escolhe. Adotar o melhor número desta varredura é sobreajustar: "
      + "a janela que escolhe o parâmetro não pode ser a que o valida. Use para saber QUAL "
      + "trava é cara, e depois confirme numa janela diferente.",
    tookMs: Date.now() - t0,
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
