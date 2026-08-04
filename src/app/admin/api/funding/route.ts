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
/**
 * ⚠️⚠️ SEGUNDA RODADA: OS DOIS PRIMEIROS HOSTS RECUSARAM (04/08).
 *
 * Com o status finalmente capturado, a resposta veio inequívoca:
 *
 *   bybit:403×57   binance:451×57
 *
 * 451 é "Unavailable For Legal Reasons" — bloqueio jurisdicional. Confirma a
 * hipótese sobre o `fapi.binance.com` de forma direta, e confirma junto que o
 * `getFundingAndOI` em market-indicators.ts devolve null desde sempre.
 *
 * O 403 da Bybit foi a surpresa: eu escolhi a Bybit ARGUMENTANDO evidência —
 * "`api.bybit.com` já é chamado em produção por `fetchFundingContext`". O
 * argumento tinha um buraco: `fetchFundingContext` faz `catch { return "" }`,
 * então ele nunca provou que funciona. Ele prova que não quebra. Usei a
 * ausência de erro como prova de sucesso, que é o mesmo raciocínio que deixou
 * a sonda de orderbook seis dias sendo lida como "sem problema".
 *
 * A evidência que EU PODIA TER USADO estava do lado: a matriz de spot é
 * montada com gate.io e okx e volta cheia — 57 símbolos, 53 com quórum, medido
 * minutos antes. Esses dois hosts têm prova POSITIVA de resposta, não ausência
 * de reclamação.
 *
 * Ordem agora: gate.io primeiro (host provado E `limit=1000` cobre 333 dias
 * numa chamada), okx depois, e as duas recusadas por último — se o bloqueio
 * mudar, o registro de status dirá.
 */
interface Falha { symbol: string; fonte: string; status: number | string }

interface BinanceRow { fundingTime?: number; fundingRate?: string }
interface BybitRow { fundingRateTimestamp?: string; fundingRate?: string }
interface GateRow { t?: number; r?: string }
interface OkxRow { fundingTime?: string; realizedRate?: string; fundingRate?: string }

/**
 * Gate.io — `limit` até 1000, ou seja 333 dias numa chamada só.
 * Mesmo host de `fetchGateIo` em cex-spot.ts, que responde na matriz viva.
 */
async function fetchGateFunding(symbol: string, falhas: Falha[]): Promise<FundingPoint[]> {
  const url = `https://api.gateio.ws/api/v4/futures/usdt/funding_rate`
    + `?contract=${symbol}_USDT&limit=${Math.min(1000, LIMITE)}`;
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) { falhas.push({ symbol, fonte: "gateio", status: res.status }); return []; }
    const body = await res.json() as GateRow[];
    if (!Array.isArray(body)) { falhas.push({ symbol, fonte: "gateio", status: "resposta não é lista" }); return []; }
    return body
      // `t` vem em SEGUNDOS aqui, ao contrário das outras fontes.
      .map((r) => ({ t: Number(r.t ?? 0) * 1000, ratePct: parseFloat(r.r ?? "") * 100 }))
      .filter((p) => p.t > 0 && Number.isFinite(p.ratePct))
      .sort((a, b) => a.t - b.t);
  } catch (e) {
    falhas.push({ symbol, fonte: "gateio", status: String(e).slice(0, 60) });
    return [];
  }
}

/** OKX — `limit` máximo 100 por página; 3 páginas cobrem ~100 dias. */
async function fetchOkxFunding(symbol: string, falhas: Falha[]): Promise<FundingPoint[]> {
  const pontos: FundingPoint[] = [];
  let after: number | undefined;
  for (let pagina = 0; pagina < 3; pagina++) {
    const params = new URLSearchParams({ instId: `${symbol}-USDT-SWAP`, limit: "100" });
    if (after != null) params.set("after", String(after));
    try {
      const res = await fetch(`https://www.okx.com/api/v5/public/funding-rate-history?${params}`, {
        next: { revalidate: 3600 },
      });
      if (!res.ok) { if (pagina === 0) falhas.push({ symbol, fonte: "okx", status: res.status }); break; }
      const body = await res.json() as { data?: OkxRow[] };
      const lista = body.data ?? [];
      if (lista.length === 0) break;
      const bloco = lista
        .map((r) => ({
          t: Number(r.fundingTime ?? 0),
          // `realizedRate` é o que foi PAGO; `fundingRate` é a estimativa.
          ratePct: parseFloat(r.realizedRate ?? r.fundingRate ?? "") * 100,
        }))
        .filter((p) => p.t > 0 && Number.isFinite(p.ratePct));
      if (bloco.length === 0) break;
      pontos.push(...bloco);
      after = Math.min(...bloco.map((p) => p.t));
      if (lista.length < 100) break;
    } catch (e) {
      if (pagina === 0) falhas.push({ symbol, fonte: "okx", status: String(e).slice(0, 60) });
      break;
    }
  }
  return pontos.sort((a, b) => a.t - b.t);
}

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

/**
 * Cascata por ordem de EVIDÊNCIA POSITIVA de resposta, não por preferência.
 *
 * gate.io e okx montam a matriz de spot viva todo minuto; sabemos que atendem.
 * bybit e binance recusaram com 403 e 451 — ficam por último, e continuam sendo
 * tentadas só para que o registro mostre se o bloqueio mudar.
 */
const FONTES: Array<[string, (s: string, f: Falha[]) => Promise<FundingPoint[]>]> = [
  ["gateio", fetchGateFunding],
  ["okx", fetchOkxFunding],
  ["bybit", fetchBybitFunding],
  ["binance", fetchBinanceFunding],
];

/** Períodos necessários para o veredito ter amostra (MIN_DIAS × 3 por dia). */
const PERIODOS_MINIMOS = MIN_DIAS * PERIODS_PER_DAY;

/**
 * ⚠️ "PRIMEIRA QUE RESPONDE" ERA A REGRA ERRADA (04/08).
 *
 * A versão anterior devolvia a primeira fonte com qualquer dado. A gate.io
 * respondeu para 53 símbolos e o resultado parou ali — só que ela devolveu 90 a
 * 180 pontos (30 a 60 dias), muito abaixo dos 174 dias pedidos, enquanto a okx
 * pagina 3×100 e chegaria a ~100 dias.
 *
 * Ou seja: uma fonte com cobertura pior calou uma melhor, e o efeito não foi
 * um dado faltando — foi 42 dos 53 símbolos caindo abaixo do mínimo de amostra
 * e o veredito sendo calculado sobre 11.
 *
 * Agora: se a primeira fonte não cobre o mínimo, as outras são tentadas e fica
 * a de MAIOR cobertura. "Respondeu" e "respondeu o suficiente" são coisas
 * diferentes — é a mesma confusão entre ausência de erro e prova de sucesso que
 * me fez escolher a Bybit horas atrás.
 */
async function fetchFunding(
  symbol: string, falhas: Falha[], usadas: Map<string, number>,
): Promise<FundingPoint[]> {
  let melhor: FundingPoint[] = [];
  let melhorNome = "";
  for (const [nome, fn] of FONTES) {
    const pts = await fn(symbol, falhas);
    if (pts.length > melhor.length) { melhor = pts; melhorNome = nome; }
    // Cobriu o mínimo — parar aqui poupa chamadas sem esconder cobertura.
    if (melhor.length >= PERIODOS_MINIMOS) break;
  }
  if (melhor.length > 0) usadas.set(melhorNome, (usadas.get(melhorNome) ?? 0) + 1);
  return melhor;
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
    /** O que decide: um ano de funding menos UMA ida e volta. */
    medianaLiquidaAnualPct: median(comAmostra.map((s) => s.netAnnualizedPct)),
    /** A janela REAL entregue pela fonte, que não é a pedida. */
    diasMedianos: median(comAmostra.map((s) => s.days)),
    /** Quantos ficaram de fora por amostra curta — 42 de 53 na 1ª rodada. */
    semAmostra: stats.length - comAmostra.length,
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
      liqAno: Math.round(s.netAnnualizedPct * 10) / 10,
      periodos: s.periods,
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
