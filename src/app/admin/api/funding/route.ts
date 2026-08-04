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

interface FundingRow { fundingTime?: number; fundingRate?: string }

async function fetchFunding(symbol: string): Promise<FundingPoint[]> {
  const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}USDT&limit=${LIMITE}`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return [];
  const body = await res.json() as FundingRow[];
  if (!Array.isArray(body)) return [];
  return body
    .map((r) => ({ t: Number(r.fundingTime ?? 0), ratePct: parseFloat(r.fundingRate ?? "") * 100 }))
    .filter((p) => p.t > 0 && Number.isFinite(p.ratePct))
    .sort((a, b) => a.t - b.t);
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
  try {
    const LOTE = 10;
    for (let i = 0; i < simbolos.length; i += LOTE) {
      const bloco = simbolos.slice(i, i + LOTE);
      const res = await Promise.all(bloco.map(async (s) => [s, await fetchFunding(s)] as const));
      for (const [s, pts] of res) if (pts.length > 0) series.set(s, pts);
    }
  } catch (e) {
    return await falhou("falha ao buscar histórico de funding", String(e).slice(0, 200));
  }

  if (series.size === 0) {
    return await falhou(
      "nenhum símbolo retornou funding",
      `tentados ${simbolos.length}; a fonte é fapi.binance.com/fapi/v1/fundingRate`,
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
