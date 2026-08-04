import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { CEX_TRACKED_SYMBOLS } from "@/lib/api/cex-spot";
import {
  fundingStats, fundingVerdict, fundingCorrelation, COST_PCT, PERIODS_PER_DAY,
  type FundingPoint, type FundingStats,
} from "@/lib/zion/funding";
import { effectiveSampleSize } from "@/lib/zion/benchmarks";
import { median } from "@/lib/zion/stats";
import { recordEvent } from "@/lib/admin/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * FUNDING / BASIS — a medição que o plano do arbiter promoveu a próximo passo.
 *
 * Ver a nota grande em `src/lib/zion/funding.ts` para a mecânica e, mais
 * importante, para a lista do que esta conta NÃO inclui.
 *
 * Fonte: histórico PÚBLICO de funding da Binance (`/fapi/v1/fundingRate`). É
 * dado realizado, não estimativa — cada ponto é um pagamento que aconteceu.
 *
 * ⚠️ LEITURA PURA. Não abre posição, não escreve em `admin_kv`, não altera
 * nenhuma mesa. Mesma regra do `🧭 O QUE FUNCIONOU`.
 *
 * ⚠️ NENHUM PARÂMETRO FOI ESCOLHIDO OLHANDO ESTES DADOS. A janela é a mesma
 * 174 dias do resto do laboratório, o custo é o `ARB2_COST_PCT` que já existia
 * (0.45%, quatro pernas), e o limiar de "renda de regime" é 35% dos períodos
 * negativos — declarado como palpite, não como medição.
 */

/** A mesma janela do backtest e do estudo de estratégias. Comparável de propósito. */
const JANELA_DIAS = Number(process.env.FUNDING_WINDOW_DAYS ?? 174);
const LIMITE = Math.min(1000, JANELA_DIAS * PERIODS_PER_DAY);
/** Palpite declarado: acima disso a renda depende de regime, não de estrutura. */
const MAX_NEG_SHARE = Number(process.env.FUNDING_MAX_NEG_SHARE ?? 0.35);
const MIN_DIAS = Number(process.env.FUNDING_MIN_DAYS ?? 60);

/**
 * ⚠️⚠️ A PRIMEIRA VERSÃO FALHOU E NÃO SOUBE DIZER POR QUÊ (04/08).
 *
 * O dono rodou, voltou "nenhum símbolo retornou funding", e o evento gravado
 * dizia exatamente isso e mais nada. `fetchFunding` engolia `!res.ok` num `[]`
 * silencioso, então 57 símbolos falharam sem um único código de status.
 *
 * É a MESMA falta de rastro que esta semana já achou cinco vezes — e desta vez
 * dentro do código que eu escrevi horas antes justamente para não ter isso. Eu
 * gravei QUE falhou e esqueci de gravar O QUÊ, que é a única parte acionável.
 *
 * O tempo denunciava: 179ms para 57 símbolos é rejeição instantânea, não
 * rede lenta nem limite de taxa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A CAUSA PROVÁVEL, e ela vale além desta rota.
 *
 * O repo usa `data-api.binance.vision` para candles (funciona — o 🧭 rodou),
 * mas Futuros vive em OUTRO host, `fapi.binance.com`, que bloqueia IP de
 * datacenter e jurisdição. Não é a mesma porta.
 *
 * ⚠️ E ISSO IMPLICA UM SEGUNDO PROBLEMA, MAIOR: `getFundingAndOI` em
 * `market-indicators.ts` chama o mesmo `fapi.binance.com` e faz
 * `if (!premRes.ok) return null` — silencioso. Se o host está bloqueado, esse
 * instrumento devolve null desde sempre e ninguém soube. Outro medidor que não
 * mede, como a sonda de orderbook que rodou seis dias sem ser lida.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A CORREÇÃO: Bybit como fonte primária, e o motivo é evidência, não gosto.
 *
 * `api.bybit.com` já é chamado em produção por `fetchFundingContext`
 * (market-context.ts), que alimenta os scanners vivos. Ou seja: sabemos que
 * responde. A Binance fica como segunda tentativa, e o resultado de CADA fonte
 * é registrado — se o fapi voltar a funcionar, o número dirá.
 */
interface Falha { symbol: string; fonte: string; status: number | string }

interface BinanceRow { fundingTime?: number; fundingRate?: string }
interface BybitRow { fundingRateTimestamp?: string; fundingRate?: string }

/** Bybit: histórico de funding realizado. `limit` máximo é 200 por chamada. */
async function fetchBybitFunding(symbol: string, falhas: Falha[]): Promise<FundingPoint[]> {
  const pontos: FundingPoint[] = [];
  let endTime: number | undefined;
  // 200 por página; 3 páginas cobrem ~200 dias, acima da janela de 174.
  for (let pagina = 0; pagina < 3; pagina++) {
    const params = new URLSearchParams({
      category: "linear", symbol: `${symbol}USDT`, limit: "200",
    });
    if (endTime != null) params.set("endTime", String(endTime));
    try {
      const res = await fetch(`https://api.bybit.com/v5/market/funding/history?${params}`, {
        next: { revalidate: 3600 },
      });
      if (!res.ok) { if (pagina === 0) falhas.push({ symbol, fonte: "bybit", status: res.status }); break; }
      const body = await res.json() as { result?: { list?: BybitRow[] } };
      const lista = body.result?.list ?? [];
      if (lista.length === 0) break;
      const bloco = lista
        .map((r) => ({
          t: Number(r.fundingRateTimestamp ?? 0),
          ratePct: parseFloat(r.fundingRate ?? "") * 100,
        }))
        .filter((p) => p.t > 0 && Number.isFinite(p.ratePct));
      if (bloco.length === 0) break;
      pontos.push(...bloco);
      // Próxima página termina um ms antes do ponto mais antigo desta.
      endTime = Math.min(...bloco.map((p) => p.t)) - 1;
      if (lista.length < 200) break;
    } catch (e) {
      if (pagina === 0) falhas.push({ symbol, fonte: "bybit", status: String(e).slice(0, 60) });
      break;
    }
  }
  return pontos.sort((a, b) => a.t - b.t);
}

/** Binance Futuros — segunda tentativa. Host separado, bloqueio separado. */
async function fetchBinanceFunding(symbol: string, falhas: Falha[]): Promise<FundingPoint[]> {
  const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}USDT&limit=${LIMITE}`;
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) { falhas.push({ symbol, fonte: "binance", status: res.status }); return []; }
    const body = await res.json() as BinanceRow[];
    if (!Array.isArray(body)) { falhas.push({ symbol, fonte: "binance", status: "resposta não é lista" }); return []; }
    return body
      .map((r) => ({ t: Number(r.fundingTime ?? 0), ratePct: parseFloat(r.fundingRate ?? "") * 100 }))
      .filter((p) => p.t > 0 && Number.isFinite(p.ratePct))
      .sort((a, b) => a.t - b.t);
  } catch (e) {
    falhas.push({ symbol, fonte: "binance", status: String(e).slice(0, 60) });
    return [];
  }
}

async function fetchFunding(
  symbol: string, falhas: Falha[], usadas: Map<string, number>,
): Promise<FundingPoint[]> {
  const bybit = await fetchBybitFunding(symbol, falhas);
  if (bybit.length > 0) { usadas.set("bybit", (usadas.get("bybit") ?? 0) + 1); return bybit; }
  const binance = await fetchBinanceFunding(symbol, falhas);
  if (binance.length > 0) { usadas.set("binance", (usadas.get("binance") ?? 0) + 1); return binance; }
  return [];
}

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();

  const falhou = async (motivo: string, detalhe?: string) => {
    await recordEvent("funding_study_failed", {
      meta: { motivo, detalhe: detalhe ?? null, windowDays: JANELA_DIAS, tookMs: Date.now() - t0 },
    });
    return NextResponse.json({ error: motivo, detail: detalhe ?? null }, { status: 503 });
  };

  // Em lotes: são ~57 símbolos e a Binance limita taxa. Sequencial seria lento
  // demais para os 60s da função; tudo de uma vez leva 429.
  const simbolos = [...CEX_TRACKED_SYMBOLS];
  const series = new Map<string, FundingPoint[]>();
  const falhas: Falha[] = [];
  const usadas = new Map<string, number>();
  try {
    const LOTE = 10;
    for (let i = 0; i < simbolos.length; i += LOTE) {
      const bloco = simbolos.slice(i, i + LOTE);
      const res = await Promise.all(
        bloco.map(async (s) => [s, await fetchFunding(s, falhas, usadas)] as const),
      );
      for (const [s, pts] of res) if (pts.length > 0) series.set(s, pts);
    }
  } catch (e) {
    return await falhou("falha ao buscar histórico de funding", String(e).slice(0, 200));
  }

  /** Um resumo legível de POR QUE falhou — não só QUE falhou. */
  const porStatus = (() => {
    const c = new Map<string, number>();
    for (const f of falhas) {
      const k = `${f.fonte}:${f.status}`;
      c.set(k, (c.get(k) ?? 0) + 1);
    }
    return [...c].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(" ");
  })();

  if (series.size === 0) {
    return await falhou(
      "nenhum símbolo retornou funding",
      `tentados ${simbolos.length} · ${porStatus || "sem status capturado"}`,
    );
  }

  const stats = [...series.entries()]
    .map(([s, pts]) => fundingStats(s, pts, COST_PCT))
    .filter((s): s is FundingStats => s != null)
    .sort((a, b) => b.netPct - a.netPct);

  if (stats.length === 0) {
    return await falhou(
      "nenhum símbolo com períodos suficientes",
      [...series].map(([s, p]) => `${s}:${p.length}`).join(" "),
    );
  }

  const veredito = fundingVerdict(stats, MIN_DIAS, MAX_NEG_SHARE);

  // A correlação decide quanto vale a amostra. Funding é variável de
  // posicionamento: quando o mercado está comprado, tudo fica positivo junto.
  const comAmostra = stats.filter((s) => s.days >= MIN_DIAS);
  const rho = fundingCorrelation(
    comAmostra.map((s) => series.get(s.symbol)!.map((p) => p.ratePct)),
  );
  const efetivo = effectiveSampleSize(comAmostra.length, rho);

  const resumo = {
    simbolos: stats.length,
    comAmostra: comAmostra.length,
    janelaDias: JANELA_DIAS,
    custoPct: COST_PCT,
    // O número que decide: o LÍQUIDO mediano da janela real.
    medianaLiquidaPct: median(comAmostra.map((s) => s.netPct)),
    medianaBrutaPct: median(comAmostra.map((s) => s.grossPct)),
    medianaAnualizadaPct: median(comAmostra.map((s) => s.annualizedPct)),
    positivosLiquidos: comAmostra.filter((s) => s.netPct > 0).length,
    robustos: comAmostra.filter((s) => s.netPct > 0 && s.negativeShare <= MAX_NEG_SHARE).length,
    medianaNegativeShare: median(comAmostra.map((s) => s.negativeShare)),
    piorTomboPct: comAmostra.length ? Math.max(...comAmostra.map((s) => s.maxDrawdownPct)) : null,
    rho: rho == null ? null : Math.round(rho * 1000) / 1000,
    apostasEfetivas: Math.round(efetivo * 100) / 100,
  };

  await recordEvent("funding_study", { meta: {
    ...resumo,
    readable: veredito.readable,
    verdict: veredito.verdict,
    maxNegShare: MAX_NEG_SHARE, minDias: MIN_DIAS,
    // Qual fonte respondeu, e o que a outra disse ao recusar. Sem isto,
    // "funcionou" e "funcionou pela metade" ficam iguais no histórico.
    fontes: Object.fromEntries(usadas),
    falhasPorStatus: porStatus || null,
    // Por símbolo, como o what-worked passou a gravar: agregado sozinho não é
    // auditável, e número que não dá para conferir acaba conferido por chute.
    porSimbolo: stats.slice(0, 60).map((s) => ({
      s: s.symbol,
      dias: Math.round(s.days),
      liq: Math.round(s.netPct * 100) / 100,
      bruto: Math.round(s.grossPct * 100) / 100,
      anual: Math.round(s.annualizedPct * 10) / 10,
      neg: Math.round(s.negativeShare * 100),
      tombo: Math.round(s.maxDrawdownPct * 100) / 100,
      equilibrioDias: s.breakEvenDays == null ? null : Math.round(s.breakEvenDays),
    })),
    tookMs: Date.now() - t0,
  } });

  return NextResponse.json({
    resumo,
    veredito,
    fontes: Object.fromEntries(usadas),
    falhasPorStatus: porStatus || null,
    porSimbolo: stats,
    naoMedido: [
      "basis de entrada/saída (exige histórico de mark vs spot) — típico <0.05% nos dois sentidos",
      "risco de liquidação da perna vendida (mitigado por margem isolada e alavancagem 1x)",
      "custo de margem além do funding e risco de custódia na corretora",
    ],
    aviso: "Leitura pura: não abre posição, não escreve em admin_kv, não altera mesa nenhuma. "
      + "O anualizado é EXTRAPOLAÇÃO; o que decide é o líquido da janela real.",
    tookMs: Date.now() - t0,
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
