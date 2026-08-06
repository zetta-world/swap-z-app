import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { CEX_TRACKED_SYMBOLS } from "@/lib/api/cex-spot";
import {
  fundingStats, fundingVerdict, fundingCounts, fundingCorrelation,
  COST_PCT, PERIODS_PER_DAY, MIN_ROBUSTOS,
  type FundingPoint, type FundingStats,
} from "@/lib/zion/funding";
import { effectiveSampleSize } from "@/lib/zion/benchmarks";
import { median } from "@/lib/zion/stats";
import { recordEvent } from "@/lib/admin/track";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { startRun, finishRun, failRun } from "@/lib/lab/store";
import { BY_SLUG } from "@/lib/lab/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * FUNDING / BASIS — a medição que o plano do arbiter promoveu a próximo passo.
 *
 * Ver a nota grande em `src/lib/zion/funding.ts` para a mecânica e, mais
 * importante, para a lista do que esta conta NÃO inclui.
 *
 * Fonte: histórico PÚBLICO de funding, em cascata por EVIDÊNCIA de resposta —
 * gate.io e okx primeiro (provados pela matriz de spot viva), bybit e binance
 * por último (403 e 451 medidos em 04/08). É dado REALIZADO, não estimativa:
 * cada ponto é um pagamento que aconteceu.
 *
 * ⚠️ LEITURA PURA. Não abre posição, não escreve em `admin_kv`, não altera
 * nenhuma mesa. Mesma regra do `🧭 O QUE FUNCIONOU`.
 *
 * ⚠️ NENHUM PARÂMETRO FOI ESCOLHIDO OLHANDO ESTES DADOS. A janela é 360 dias
 * (ver a nota em `JANELA_DIAS`), o custo é o `ARB2_COST_PCT` que já existia
 * (0.45%, quatro pernas), e o limiar de "renda de regime" é 35% dos períodos
 * negativos — declarado como palpite, não como medição.
 */

/**
 * ⚠️ 360 DIAS NA FASE 3, e a mudança tem motivo (06/08).
 *
 * A janela de 174 existia para bater com o backtest da biblioteca. Aqui a
 * pergunta é outra: a nossa medição deu mediana de +1,4% ao ano e a literatura
 * vende 5% a 20%. É a maior incerteza do Mapa do Lucro, e o desfecho muda o
 * produto — se der 8%, é renda vendável para as três faixas de cliente; se der
 * 1,4%, é ruído documentado.
 *
 * Uma discrepância dessas não se resolve com dois meses de dado: funding é
 * variável de REGIME, e sessenta dias podem ser um regime só.
 */
const JANELA_DIAS = Number(process.env.FUNDING_WINDOW_DAYS ?? 360);
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

/**
 * A paginação foi interrompida por tempo em ALGUM símbolo?
 *
 * Módulo-escopo de propósito: o corte pode acontecer em qualquer símbolo e o
 * resultado precisa dizer que a janela entregue não é a janela pedida. Uma
 * janela curta silenciosa é a causa raiz que esta fase inteira ataca.
 */
let paginacaoCortada = false;

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
async function fetchOkxFunding(
  symbol: string, falhas: Falha[], deadline?: number,
): Promise<FundingPoint[]> {
  const pontos: FundingPoint[] = [];
  let after: number | undefined;
  /**
   * ⚠️ PROFUNDIDADE SUFICIENTE PARA O ALVO, não um 3 mágico (06/08).
   *
   * Eram 3 páginas fixas = 300 períodos = 100 dias, escrito quando o alvo era
   * 174. Número de página não pode ser constante quando a janela é variável:
   * mudar `JANELA_DIAS` sem mudar isto pediria 360 dias e receberia 100, em
   * silêncio.
   *
   * O teto de 15 existe porque a função tem 60s: 57 símbolos × 15 páginas
   * sequenciais não cabe, e estourar o tempo devolveria resultado PARCIAL sem
   * dizer. O `deadline` abaixo é a segunda trava, e ela AVISA.
   */
  const maxPaginas = Math.min(15, Math.ceil(PERIODOS_ALVO / 100));
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    /**
     * ⚠️ O TEMPO ACABANDO NÃO PODE VIRAR RESULTADO PARCIAL MUDO.
     *
     * Sem esta trava, a função estoura os 60s da Vercel no meio da paginação e
     * o que sobra é uma janela curta apresentada como se fosse a pedida — que
     * é exatamente o defeito que a Fase 3 existe para consertar, reintroduzido
     * pela porta do timeout.
     *
     * `paginacaoCortada` sobe até o resultado e aparece na tela.
     */
    if (deadline != null && Date.now() > deadline) { paginacaoCortada = true; break; }
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
const FONTES: Array<[string, (s: string, f: Falha[], d?: number) => Promise<FundingPoint[]>]> = [
  ["gateio", fetchGateFunding],
  ["okx", fetchOkxFunding],
  ["bybit", fetchBybitFunding],
  ["binance", fetchBinanceFunding],
];

/** Períodos necessários para o veredito ter amostra (MIN_DIAS × 3 por dia). */
const PERIODOS_MINIMOS = MIN_DIAS * PERIODS_PER_DAY;
/**
 * ⚠️ O ALVO, que é diferente do mínimo — e confundir os dois travava tudo em
 * 60 dias (06/08).
 *
 * A cascata parava quando `melhor.length >= PERIODOS_MINIMOS`, ou seja assim
 * que juntava a amostra MÍNIMA aceitável (60 dias). Com a gate.io devolvendo
 * 180 pontos, ela batia o mínimo na primeira fonte e nenhuma outra era
 * tentada — mesmo pedindo 174 dias, mesmo com a okx capaz de paginar mais.
 *
 * Consertei a regra "primeira que responde" em 04/08 e deixei a condição de
 * parada apontando para o mínimo. O efeito foi o mesmo defeito com outra
 * roupa: uma fonte curta calando as demais, agora com a justificativa de que
 * "já deu o suficiente".
 *
 * Mínimo é o piso para o número VALER. Alvo é o que se pediu. São coisas
 * diferentes e a parada tem que olhar para o alvo.
 */
const PERIODOS_ALVO = JANELA_DIAS * PERIODS_PER_DAY;

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
  symbol: string, falhas: Falha[], usadas: Map<string, number>, deadline?: number,
): Promise<FundingPoint[]> {
  let melhor: FundingPoint[] = [];
  let melhorNome = "";
  for (const [nome, fn] of FONTES) {
    const pts = await fn(symbol, falhas, deadline);
    if (pts.length > melhor.length) { melhor = pts; melhorNome = nome; }
    // Cobriu o ALVO — aí sim parar poupa chamada sem esconder cobertura.
    // Parar no MÍNIMO seria deixar uma fonte curta calar as demais.
    if (melhor.length >= PERIODOS_ALVO) break;
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
    // A rodada fecha como FALHOU com o detalhe acionável. Gravar QUE falhou sem
    // gravar O QUÊ é gravar a parte inútil — custou uma rodada inteira em 04/08.
    if (db && runId) {
      try { await failRun(db, runId, motivo, detalhe ?? "", Date.now() - t0); } catch { /* idem */ }
    }
    return NextResponse.json({ error: motivo, detail: detalhe ?? null }, { status: 503 });
  };

  // Em lotes: são ~57 símbolos e a Binance limita taxa. Sequencial seria lento
  // demais para os 60s da função; tudo de uma vez leva 429.
  const simbolos = [...CEX_TRACKED_SYMBOLS];
  const series = new Map<string, FundingPoint[]>();
  const falhas: Falha[] = [];
  const usadas = new Map<string, number>();
  // Estado de módulo: zerar por rodada, senão uma rodada anterior contamina.
  paginacaoCortada = false;
  // Margem de 12s para montar o resultado e gravar depois de parar de buscar.
  const deadline = t0 + (maxDuration - 12) * 1000;

  /**
   * ⚠️ A RODADA ABRE NO LABORATÓRIO ANTES DE BUSCAR NADA (06/08).
   *
   * `lab_runs` nasce com status `rodando`. Se a função morrer no meio — timeout,
   * exceção, deploy — a linha fica lá dizendo que começou e não voltou, em vez
   * de a rodada simplesmente não existir.
   *
   * É a diferença entre "rodou e deu erro" e "nunca clicou", que esta semana
   * confundiu seis vezes. E o capital vai gravado NO MOMENTO: se o exigido pela
   * estratégia mudar amanhã, esta rodada continua dizendo com quanto foi feita.
   */
  const db = getSupabaseAdmin();
  const capital = BY_SLUG.get("funding_basis")?.capitalRequiredUsd ?? 2000;
  let runId: string | null = null;
  if (db) {
    try {
      runId = await startRun(db, {
        slug: "funding_basis",
        capitalUsd: capital,
        windowDays: JANELA_DIAS,
        params: { simbolos: CEX_TRACKED_SYMBOLS.length, custoPct: COST_PCT, minDias: MIN_DIAS },
      });
    } catch { /* o laboratório é registro, não pré-requisito da medição */ }
  }
  try {
    const LOTE = 10;
    for (let i = 0; i < simbolos.length; i += LOTE) {
      const bloco = simbolos.slice(i, i + LOTE);
      const res = await Promise.all(
        bloco.map(async (s) => [s, await fetchFunding(s, falhas, usadas, deadline)] as const),
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
  /**
   * ⚠️ AS CONTAGENS VÊM DA MESMA FUNÇÃO QUE O VEREDITO (06/08).
   *
   * Antes o resumo refazia a conta aqui com `netPct` (janela) enquanto o
   * veredito contava com `netAnnualizedPct` (ano) — e a tela mostrava os dois
   * lado a lado, "23 de 50" em cima e "26/50 · robustos 22" embaixo, sem nada
   * dizendo que eram réguas diferentes. Ver a nota em `fundingCounts`.
   */
  const contagem = fundingCounts(stats, MIN_DIAS, MAX_NEG_SHARE);

  // A correlação decide quanto vale a amostra. Funding é variável de
  // posicionamento: quando o mercado está comprado, tudo fica positivo junto.
  const comAmostra = contagem.comAmostra;
  const rho = fundingCorrelation(
    comAmostra.map((s) => series.get(s.symbol)!.map((p) => p.ratePct)),
  );
  const efetivo = effectiveSampleSize(comAmostra.length, rho);

  const diasMedianos = median(comAmostra.map((s) => s.days));

  /**
   * ⚠️⚠️ "EU CORTEI" E "A FONTE ACABOU" SÃO COISAS DIFERENTES (06/08).
   *
   * A rodada de 06/08 pediu 360 dias e recebeu 94, com `paginacaoCortada =
   * false`. Ou seja: o relógio não estourou, a paginação rodou até o fim, e
   * mesmo assim a janela veio a um quarto do pedido — porque o histórico
   * público de funding da okx termina ali. Quarenta símbolos diferentes pararam
   * no MESMO 94º dia, que é assinatura de corte da fonte, não de contador nosso
   * (o nosso cortaria em múltiplos de 100 períodos, e variaria por símbolo).
   *
   * A distinção importa porque as ações são opostas: paginação cortada se
   * resolve rodando de novo ou pedindo menos símbolos; teto de fonte não se
   * resolve — ou se aceita a janela, ou se troca de fonte. Registrar as duas
   * como "janela curta" faria alguém clicar de novo por um ano inteiro que a
   * fonte nunca vai entregar.
   */
  const fonteEsgotada = !paginacaoCortada
    && diasMedianos != null
    && diasMedianos < JANELA_DIAS * 0.9;

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
    diasMedianos,
    /** Quantos ficaram de fora por amostra curta — 42 de 53 na 1ª rodada. */
    semAmostra: stats.length - comAmostra.length,
    /** ⚠️ A régua do veredito: positivo NO ANO, uma ida e volta. */
    positivosNoAno: contagem.positivosNoAno,
    robustos: contagem.robustos,
    minRobustos: MIN_ROBUSTOS,
    /** Outra pergunta, com nome próprio: pagou as pernas DENTRO da janela. */
    pagaramNaJanela: contagem.pagaramNaJanela,
    medianaNegativeShare: median(comAmostra.map((s) => s.negativeShare)),
    piorTomboPct: comAmostra.length ? Math.max(...comAmostra.map((s) => s.maxDrawdownPct)) : null,
    rho: rho == null ? null : Math.round(rho * 1000) / 1000,
    apostasEfetivas: Math.round(efetivo * 100) / 100,
    /**
     * ⚠️ A janela entregue é a pedida? Se a paginação foi cortada por tempo,
     * NÃO — e o número abaixo vale menos do que parece. Janela curta silenciosa
     * é a causa raiz que esta fase inteira ataca.
     */
    paginacaoCortada,
    /** A janela é curta porque a FONTE acabou, não porque nós cortamos. */
    fonteEsgotada,
    janelaPedidaDias: JANELA_DIAS,
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

  /**
   * ⚠️ O RESULTADO FECHA A RODADA NO LABORATÓRIO (06/08).
   *
   * O que vai para `lab_results` é o que permite comparar esta medição com a de
   * daqui a três meses — e é exatamente o que faltava quando a discrepância de
   * onze pontos entre duas rotas levou uma hora para ser isolada.
   *
   * `netAnnualizedPct` é o campo que decide: o líquido da JANELA compara ganho
   * acumulado com um custo pago UMA VEZ, e numa janela curta isso cospe "não
   * paga" quando o que diz é "a janela é curta". Os dois vão gravados.
   */
  if (db && runId) {
    try {
      await finishRun(db, runId, {
        netPct: resumo.medianaLiquidaPct,
        netAnnualizedPct: resumo.medianaLiquidaAnualPct,
        grossPct: resumo.medianaBrutaPct,
        costPct: COST_PCT,
        // A amostra é o número de símbolos que passaram o mínimo de dias — não
        // os 53 que responderam, que seria inflar o `n` com quem não conta.
        sampleN: resumo.comAmostra,
        effectiveN: resumo.apostasEfetivas,
        correlationRho: resumo.rho,
        maxDrawdownPct: resumo.piorTomboPct,
        /**
         * ⚠️ VERDE EXIGE UMA CESTA, NÃO UM NOME (06/08).
         *
         * Era `robustos > 0`: um símbolo em cinquenta marcaria a rodada como
         * verde. Mesma família do portão de lançamento que aprovava com n=0 —
         * ausência de contra-exemplo lida como prova. Ver `MIN_ROBUSTOS`.
         */
        verdict: veredito.readable
          && resumo.robustos >= MIN_ROBUSTOS
          && (resumo.medianaLiquidaAnualPct ?? 0) > 0 ? "verde" : "cinza",
        verdictText: veredito.verdict,
        perSymbol: stats.slice(0, 60).map((x) => ({
          s: x.symbol, dias: Math.round(x.days),
          liqAno: Math.round(x.netAnnualizedPct * 10) / 10,
          neg: Math.round(x.negativeShare * 100),
        })),
        notMeasured: [
          "basis de entrada/saída — exige histórico de mark vs spot alinhado; típico <0,05% nos dois sentidos",
          "risco de liquidação da perna vendida",
          "custo de margem além do funding e risco de custódia",
          ...(paginacaoCortada
            ? ["⚠️ paginação CORTADA por tempo — a janela entregue é menor que a pedida"]
            : []),
          ...(fonteEsgotada
            ? [`⚠️ a fonte esgotou em ~${Math.round(diasMedianos ?? 0)}d dos ${JANELA_DIAS}d `
               + "pedidos — teto do histórico público, não corte nosso; rodar de novo não muda"]
            : []),
        ],
      }, Date.now() - t0);
    } catch { /* o laboratório é registro, não pré-requisito da medição */ }
  }

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
