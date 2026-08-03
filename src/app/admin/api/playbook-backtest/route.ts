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
 * ⚠️ A JANELA PRECISA APARECER NA TELA, JUNTO DO NÚMERO.
 *
 * A primeira rodada usou 1.000 barras — o teto de UMA chamada da Binance — e
 * devolveu 65 trades no total, com os nove playbooks abaixo do limiar. A tela
 * disse "não sei", que era honesto e inútil. Agora `fetchTimedCandles` pagina
 * para trás e a janela é ESCOLHIDA (~6 meses), não imposta.
 *
 * Isso muda a amostra, não a regra: o que continuar abaixo do limiar continua
 * saindo em cinza. Seis meses não transformam um playbook raro em medido — só
 * dão a ele a chance de aparecer.
 *
 * Por isso a resposta carrega `windowDays` e o `n` de cada playbook, e o painel
 * acinzenta o que estiver abaixo do limiar. Não é rodapé: é o que separa
 * medição de encenação.
 *
 * Só LÊ. Não escreve no ledger, não gasta token, não move fundo.
 */

/** Um recorte, não o universo: o backtest é caro e 60s é o teto. */
const SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "AVAX", "LINK", "ARB", "OP", "ADA", "DOGE"];

/**
 * SEIS MESES (03/08). A primeira rodada usou 1.000 barras — o teto de UMA
 * chamada da Binance — e voltou com os nove playbooks abaixo do limiar: 65
 * trades no total, o maior com n=20. A tela disse "não sei", que era a resposta
 * honesta e inútil.
 *
 * `fetchTimedCandles` agora pagina para trás, então a janela deixa de ser
 * limitada pela API e passa a ser escolhida. 4.400 barras de 1h ≈ 6 meses.
 *
 * Com a janela de indicadores limitada (`INDICATOR_WINDOW`), o custo por barra
 * virou constante — sem isso, seis meses estourariam os 60s da rota e ela
 * devolveria menos símbolos em silêncio, que é a pior forma de falhar.
 */
const BARS_1H = Number(process.env.PLAYBOOK_BT_BARS ?? 4400);

export async function POST(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();

  /**
   * QUANTOS DIAS ATRÁS a janela TERMINA. 0 = até hoje.
   *
   * O mercado da janela padrão caiu 18.49% na mediana. Uma biblioteca long-only
   * medida só aí responde "ela ganha em bear?", que não é a pergunta. Com o
   * recuo dá para medir a MESMA biblioteca numa estação diferente — e só a
   * comparação entre as duas separa "estratégia ruim" de "estação errada".
   */
  const backDays = Math.max(0, Number(new URL(req.url).searchParams.get("backDays") ?? 0));
  const endAtMs = backDays > 0 ? Date.now() - backDays * 86_400_000 : undefined;

  /**
   * A REFERÊNCIA DO MAR: o diário do BTC na mesma janela.
   *
   * Buscado UMA vez e passado a todos os símbolos — o clima é propriedade do
   * mercado, não do peixe. Sem ele o backtest marca tudo como "misto", que é a
   * resposta honesta para "não medi".
   *
   * O BTC não é o mercado inteiro (na janela de 12 meses ele subiu 20% enquanto
   * OP caía 33%), e por isso ele serve de REFERÊNCIA e não de veredito: o filtro
   * ao vivo usa amplitude cross-símbolo, que é mais fiel. Aqui vale a
   * aproximação porque a alternativa seria recalcular amplitude a cada barra de
   * cada símbolo, e o teto da rota é 60s.
   */
  const marketRef = await fetchTimedCandles("BTC", "1d", 400, 3600, endAtMs);

  const results = await Promise.all(SYMBOLS.map(async (symbol) => {
    const [c1h, c4h, c1d, c1w] = await Promise.all([
      fetchTimedCandles(symbol, "1h", BARS_1H, 3600, endAtMs),
      fetchTimedCandles(symbol, "4h", 1100, 3600, endAtMs),
      fetchTimedCandles(symbol, "1d", 200, 3600, endAtMs),
      fetchTimedCandles(symbol, "1w", 60, 3600, endAtMs),
    ]);
    if (c1h.length < WARMUP_BARS + 20) return null;
    try {
      return backtestPlaybooks(symbol, c1h, c4h, c1d, c1w, undefined, marketRef);
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

  /**
   * O QUE O MERCADO FEZ NA MESMA JANELA — o denominador do veredito.
   *
   * A primeira rodada de 6 meses devolveu os nove playbooks negativos, e essa
   * frase sozinha não significa nada: se o mercado subiu 80%, mesas long-only
   * no vermelho são um fracasso; se caiu 40%, perder 0.2% por trade é um
   * resultado DEFENSIVO e a leitura é o oposto. Sem esta linha, o operador
   * julga a biblioteca contra um pano de fundo que ele está imaginando.
   *
   * Mediana entre os símbolos, não média: um único símbolo que triplicou
   * arrastaria a média e descreveria um mercado que ninguém viveu.
   */
  const bh = ok.map((r) => r.buyHoldPct).filter((x): x is number => x != null).sort((a, b) => a - b);
  const marketPct = bh.length
    ? (bh.length % 2 ? bh[(bh.length - 1) / 2] : (bh[bh.length / 2 - 1] + bh[bh.length / 2]) / 2)
    : null;

  // GRAVA para as mesas lerem. Até aqui a medição morria na tela — informação
  // que não muda decisão nenhuma é decoração, que é o defeito que esta semana
  // inteira perseguiu. É a partir daqui que o MÍMIR escolhe sabendo o que
  // funcionou, em vez de escolher às cegas.
  // Uma janela HISTÓRICA não substitui o registro que as mesas leem: elas
  // operam hoje, e a evidência que as guia tem de ser da estação atual. Rodar
  // um recuo para estudo não pode reprogramar a URÐR sem ninguém pedir.
  const saved = backDays > 0 ? false : await savePlaybookRecord({
    entries: stats.map((s) => ({
      playbook: s.playbook, decided: s.decided,
      netPerTrade: s.netPerTrade, byRegime: s.byRegime,
    })),
    windowDays,
    marketPct,
    measuredAt: new Date().toISOString(),
  });

  return NextResponse.json({
    savedForDesks: saved,
    ok: true,
    symbols: ok.map((r) => r.symbol),
    symbolsFailed: SYMBOLS.filter((s) => !ok.some((r) => r.symbol === s)),
    windowDays,
    backDays,
    endedAt: endAtMs ? new Date(endAtMs).toISOString() : null,
    warmupBars: WARMUP_BARS,
    barsTested,
    marketPct,
    perSymbol: ok.map((r) => ({ symbol: r.symbol, buyHoldPct: r.buyHoldPct })),
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
