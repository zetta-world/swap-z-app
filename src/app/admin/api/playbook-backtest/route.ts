import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { fetchTimedCandles } from "@/lib/api/market-indicators";
import { backtestPlaybooks, mergeResults, WARMUP_BARS } from "@/lib/zion/playbook-backtest";
import { PLAYBOOKS, PLAYBOOK_GAPS } from "@/lib/zion/playbooks";
import { NOISE_THRESHOLD } from "@/lib/admin/sample";
import { savePlaybookRecord } from "@/lib/zion/playbook-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Uma dezena de símbolos × quatro séries de candles cada. 60s é o teto do plano.
export const maxDuration = 60;

/**
 * POST /admin/api/playbook-backtest — mede CADA estratégia da biblioteca,
 * isolada, sobre o histórico real.
 *
 * O que este número substitui: a coluna `priority` da biblioteca, que decide
 * qual playbook o seletor mecânico tenta primeiro e sempre foi um PALPITE —
 * a ordem clássica, declarada como chute no próprio código.
 *
 * ⚠️ O TETO DA JANELA É REAL E PRECISA APARECER NA TELA.
 *
 * A Binance devolve no máximo ~1000 candles de 1h por chamada, ou seja ~40
 * dias. Descontando o aquecimento dos indicadores sobram cerca de 32 dias de
 * teste por símbolo. Para os playbooks frequentes isso dá amostra; para os
 * raros (absorção, divergência) provavelmente NÃO dá — e um número de 4 trades
 * exibido como resposta seria o mesmo defeito do Valhalla, agora com a
 * autoridade de um "backtest".
 *
 * Por isso a resposta carrega `windowDays` e o `n` de cada playbook, e o painel
 * acinzenta o que estiver abaixo do limiar. Não é rodapé: é o que separa
 * medição de encenação.
 *
 * Só LÊ. Não escreve no ledger, não gasta token, não move fundo.
 */

/** Um recorte, não o universo: o backtest é caro e 60s é o teto. */
const SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "AVAX", "LINK", "ARB", "OP", "ADA", "DOGE"];
const BARS_1H = 1000;

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();

  const results = await Promise.all(SYMBOLS.map(async (symbol) => {
    const [c1h, c4h, c1d, c1w] = await Promise.all([
      fetchTimedCandles(symbol, "1h", BARS_1H),
      fetchTimedCandles(symbol, "4h", 400),
      fetchTimedCandles(symbol, "1d", 200),
      fetchTimedCandles(symbol, "1w", 60),
    ]);
    if (c1h.length < WARMUP_BARS + 20) return null;
    try {
      return backtestPlaybooks(symbol, c1h, c4h, c1d, c1w);
    } catch { return null; }
  }));

  const ok = results.filter((r): r is NonNullable<typeof r> => r !== null);
  const stats = mergeResults(ok);

  // Playbooks que NUNCA dispararam também precisam aparecer. Ausência não é
  // aprovação: um playbook que não encontra setup nenhum na janela é um dado
  // sobre ELE, e sumir com a linha faria parecer que ele nem existe.
  const disparou = new Set(stats.map((s) => s.playbook));
  const silenciosos = PLAYBOOKS.filter((p) => !disparou.has(p.id)).map((p) => ({
    playbook: p.id, label: p.label,
    reason: "nenhum setup encontrado na janela testada",
  }));

  const barsTested = ok.reduce((n, r) => n + r.barsTested, 0);
  const windowDays = Math.round((BARS_1H - WARMUP_BARS) / 24);

  // GRAVA para as mesas lerem. Até aqui a medição morria na tela — informação
  // que não muda decisão nenhuma é decoração, que é o defeito que esta semana
  // inteira perseguiu. É a partir daqui que o MÍMIR escolhe sabendo o que
  // funcionou, em vez de escolher às cegas.
  const saved = await savePlaybookRecord({
    entries: stats.map((s) => ({
      playbook: s.playbook, decided: s.decided,
      netPerTrade: s.netPerTrade, byRegime: s.byRegime,
    })),
    windowDays,
    measuredAt: new Date().toISOString(),
  });

  return NextResponse.json({
    savedForDesks: saved,
    ok: true,
    symbols: ok.map((r) => r.symbol),
    symbolsFailed: SYMBOLS.filter((s) => !ok.some((r) => r.symbol === s)),
    windowDays,
    warmupBars: WARMUP_BARS,
    barsTested,
    noiseThreshold: NOISE_THRESHOLD,
    stats: stats.map((s) => ({
      ...s,
      label: PLAYBOOKS.find((p) => p.id === s.playbook)?.label ?? s.playbook,
      thesis: PLAYBOOKS.find((p) => p.id === s.playbook)?.thesis ?? "",
    })),
    silent: silenciosos,
    // Os playbooks que a plataforma AINDA não sabe reconhecer viajam junto: uma
    // tabela de desempenho sem eles daria a impressão de que a biblioteca está
    // completa.
    gaps: PLAYBOOK_GAPS.map((g) => ({ id: g.id, label: g.label, blockedBy: g.blockedBy })),
    tookMs: Date.now() - t0,
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
