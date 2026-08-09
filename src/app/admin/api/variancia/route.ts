import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { recordEvent } from "@/lib/admin/track";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { startRun, finishRun, failRun } from "@/lib/lab/store";
import { BY_SLUG } from "@/lib/lab/registry";
import { fetchDvol } from "@/lib/api/deribit-dvol";
import {
  construirVrp, resumirVrp, vereditoVrp, janelasIndependentes, pioresJanelas,
} from "@/lib/lab/variancia";
import {
  STRIKES, janelaCoberta, resumirCoberta, vereditoCoberta, type JanelaCoberta,
} from "@/lib/lab/coberta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * PRÊMIO DE RISCO DE VARIÂNCIA — Fase 5.1.
 *
 * Ver a nota grande em `src/lib/lab/variancia.ts`. O resumo: a hipótese do mapa
 * ("IV do BTC roda 50-80% contra 15-20% do S&P") compara o PREÇO do seguro, não
 * o lucro de vendê-lo. Quem vende ganha IV menos a volatilidade que aconteceu.
 *
 * ⚠️ LEITURA PURA. Não abre posição, não escreve em `admin_kv`, não altera mesa.
 *
 * ⚠️ ISTO MEDE O PRÊMIO, NÃO A ESTRATÉGIA. Custo de execução da opção e teto de
 * alta da coberta ficam para a 5.2, e só se esta passar.
 */

/** Janela do índice: DVOL é a implícita de 30 dias. */
const JANELA_DIAS = 30;
/** Histórico pedido. 1000 velas diárias é o teto de uma chamada da Binance. */
const HISTORICO_DIAS = Number(process.env.VRP_HISTORICO_DIAS ?? 900);

const BINANCE_DATA = "https://data-api.binance.vision";

/**
 * Fechamentos DIÁRIOS.
 *
 * ⚠️ NÃO REUSA O `fetchKlines` DO BACKTEST DE PROPÓSITO — e a distinção importa
 * porque a regra da casa é o contrário.
 *
 * Aquele é privado, afinado para velas de 5m e tem a lógica de `intervalForSpan`
 * amarrada ao horizonte de sugestão. O que se repete aqui é o ENDEREÇO, não uma
 * verdade: são os mesmos parâmetros de um endpoint público com granularidade
 * diferente. Duplicação perigosa é a de CONTA (a mediana, a correlação); esta é
 * de chamada.
 */
async function fetchFechamentosDiarios(
  symbol: string, desdeMs: number, ateMs: number,
): Promise<{ porDia: Map<string, number>; falha?: string }> {
  const url = `${BINANCE_DATA}/api/v3/klines?symbol=${symbol}USDT&interval=1d`
    + `&startTime=${Math.floor(desdeMs)}&endTime=${Math.ceil(ateMs)}&limit=1000`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { porDia: new Map(), falha: `binance:${res.status}` };
    const linhas = await res.json() as Array<[number, string, string, string, string, ...unknown[]]>;
    if (!Array.isArray(linhas) || linhas.length === 0) {
      return { porDia: new Map(), falha: "binance: sem velas" };
    }
    const porDia = new Map<string, number>();
    for (const l of linhas) {
      const t = Number(l[0]); const fecha = parseFloat(l[4]);
      if (!(t > 0) || !Number.isFinite(fecha)) continue;
      porDia.set(new Date(t).toISOString().slice(0, 10), fecha);
    }
    return { porDia };
  } catch (e) {
    return { porDia: new Map(), falha: `binance:${String(e).slice(0, 60)}` };
  }
}

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();
  const db = getSupabaseAdmin();

  const ateMs = Date.now();
  const desdeMs = ateMs - HISTORICO_DIAS * 86_400_000;

  const capital = BY_SLUG.get("covered_call")?.capitalRequiredUsd ?? 5000;
  let runId: string | null = null;
  if (db) {
    try {
      runId = await startRun(db, {
        slug: "covered_call", capitalUsd: capital, windowDays: HISTORICO_DIAS,
        params: { fase: "5.1 prêmio de variância", janelaDias: JANELA_DIAS, moeda: "BTC" },
      });
    } catch { /* o laboratório é registro, não pré-requisito da medição */ }
  }

  const [dvol, spot] = await Promise.all([
    fetchDvol("BTC", desdeMs, ateMs),
    fetchFechamentosDiarios("BTC", desdeMs, ateMs),
  ]);

  const falhas = [dvol.falha, spot.falha].filter(Boolean) as string[];

  /**
   * ⚠️ FONTE RECUSADA NÃO É PRÊMIO ZERO. Se a Deribit não responder, a resposta
   * é "não medimos" — e ela tem que sair como FALHA, com o status, não como um
   * resultado de prêmio inexistente. As duas leituras são opostas e a segunda
   * encerraria a fase por engano.
   */
  if (dvol.porDia.size === 0 || spot.porDia.size === 0) {
    const motivo = dvol.porDia.size === 0
      ? "a fonte de volatilidade implícita não respondeu"
      : "a fonte de preço não respondeu";
    const detalhe = falhas.join(" · ") || "sem status capturado";
    await recordEvent("variancia_study_failed", {
      meta: { motivo, detalhe, tookMs: Date.now() - t0 },
    });
    if (db && runId) {
      try { await failRun(db, runId, motivo, detalhe, Date.now() - t0); } catch { /* idem */ }
    }
    return NextResponse.json({ error: motivo, detail: detalhe }, { status: 503 });
  }

  const { pontos, semFuturo } = construirVrp(dvol.porDia, spot.porDia, JANELA_DIAS);
  const resumo = resumirVrp(pontos);
  const veredito = vereditoVrp(resumo, JANELA_DIAS);

  /**
   * ⚠️⚠️ FASE 5.2 — E ELA É SIMULAÇÃO, NÃO MEDIÇÃO.
   *
   * A 5.1 acima mede o prêmio com dado real (DVOL contra realizada). Aqui a
   * call é precificada por Black-Scholes com a implícita observada, porque não
   * existe histórico gratuito de preço de opção. Ver a nota de `coberta.ts`
   * para a direção de cada erro do modelo.
   *
   * ⚠️ O QUE É MEDIDO: o retorno do BTC nas janelas (velas reais) e quantas
   * vezes ele passou do teto. Esse é o lado da conta que mais decide, e ele não
   * depende de modelo nenhum.
   *
   * A janela é a MESMA da 5.1 — mesmos dias, mesma duração — para as duas
   * metades da fase falarem do mesmo período.
   */
  const anos = JANELA_DIAS / 365;
  const diasPreco = [...spot.porDia.keys()].sort();
  const iPreco = new Map(diasPreco.map((d, i) => [d, i]));
  const porStrike = new Map<number, JanelaCoberta[]>(STRIKES.map((k) => [k, []]));

  for (const p of pontos) {
    const i = iPreco.get(p.dia);
    if (i == null) continue;
    const diaFinal = diasPreco[i + JANELA_DIAS];
    if (diaFinal == null) continue;
    const s0 = spot.porDia.get(p.dia)!;
    const sT = spot.porDia.get(diaFinal)!;
    for (const k of STRIKES) {
      porStrike.get(k)!.push(
        // A implícita do dia é a vol do modelo — a mesma que a 5.1 usou.
        janelaCoberta(p.dia, s0, sT, p.implicitaPct / 100, k, anos),
      );
    }
  }

  const cobertas = STRIKES
    .map((k) => resumirCoberta(porStrike.get(k) ?? [], k))
    .filter((r): r is NonNullable<typeof r> => r != null);
  const vereditoCob = vereditoCoberta(cobertas);
  const melhorCob = cobertas.length
    ? cobertas.reduce((a, b) => (b.vantagemPct > a.vantagemPct ? b : a))
    : null;

  const naoMedido = [
    "⚠️ o CUSTO DE EXECUÇÃO da opção — spread do livro, taxa e rolagem. DVOL é "
      + "índice, não livro: não existe preço de opção histórico nesta fonte",
    "⚠️ o PRÊMIO da 5.2 é de MODELO (Black-Scholes com a implícita do dinheiro), "
      + "não de livro. O sorriso subestima o prêmio e a cauda subestima o risco, "
      + "para lados opostos — leia como ordem de grandeza",
    "o strike — este número é o prêmio do índice de 30 dias, não de uma call "
      + "específica; strike fora do dinheiro cobra menos e trava menos",
    "risco de custódia e de margem na corretora de opções",
  ];

  if (db && runId) {
    try {
      await finishRun(db, runId, {
        /**
         * ⚠️ O TITULAR É A VANTAGEM DA COBERTA CONTRA SEGURAR, na janela de 30
         * dias — é ela a estratégia. O prêmio de variância vira contexto.
         */
        netPct: melhorCob?.vantagemPct ?? null,
        // Extrapolação declarada: a vantagem de 30 dias repetida 12,17 vezes.
        netAnnualizedPct: melhorCob == null
          ? null : Number((melhorCob.vantagemPct * (365 / JANELA_DIAS)).toFixed(4)),
        grossPct: melhorCob?.premioMedioPct ?? null,
        // A "amostra" é a de janelas INDEPENDENTES — ver `janelasIndependentes`.
        sampleN: resumo ? janelasIndependentes(resumo.n, JANELA_DIAS) : 0,
        effectiveN: resumo ? janelasIndependentes(resumo.n, JANELA_DIAS) : null,
        maxDrawdownPct: resumo ? Math.abs(Math.min(0, resumo.piorPct)) : null,
        // ⚠️ O DENOMINADOR É SEGURAR A MOEDA — a alternativa real de quem tem
        // BTC. Comparar contra zero mediria meia operação.
        benchmarkPct: melhorCob?.segurarMediaPct ?? null,
        /**
         * ⚠️ O VEREDITO DA ESTRATÉGIA É O DA COBERTA (5.2), não o do prêmio
         * (5.1). Prêmio positivo é condição NECESSÁRIA e não suficiente: quem
         * decide é se travar a alta custa menos que o prêmio recebido.
         */
        verdict: vereditoCob.status,
        verdictText: `${vereditoCob.verdict} ⟨prêmio de variância: ${veredito.verdict}⟩`,
        /**
         * ⚠️ AS PIORES, NÃO AS ÚLTIMAS (09/08). Isto guardava `slice(-120)` —
         * recorte por RECÊNCIA — e o painel o exibia como "as 30 piores".
         * A pior armazenada era −10,6 enquanto a pior real era −46,1: numa fase
         * cujo argumento é "a cauda decide", o que ficava gravado escondia
         * exatamente a cauda. As recentes continuam, marcadas, porque servem
         * para ver o regime de agora.
         */
        perSymbol: [
          ...pioresJanelas(pontos, 40).map((p) => ({
            tipo: "pior", dia: p.dia,
            iv: Math.round(p.implicitaPct * 10) / 10,
            rv: Math.round(p.realizadaPct * 10) / 10,
            vrp: Math.round(p.vrpPct * 10) / 10,
          })),
          ...pontos.slice(-60).map((p) => ({
            tipo: "recente", dia: p.dia,
            iv: Math.round(p.implicitaPct * 10) / 10,
            rv: Math.round(p.realizadaPct * 10) / 10,
            vrp: Math.round(p.vrpPct * 10) / 10,
          })),
          ...cobertas.map((c) => ({
            tipo: "coberta", teto: Math.round((c.strikeFrac - 1) * 100),
            coberta: c.cobertaMediaPct, segurar: c.segurarMediaPct,
            vantagem: c.vantagemPct, ganhou: Math.round(c.fracaoGanhou * 100),
            exercida: Math.round(c.fracaoExercida * 100), premio: c.premioMedioPct,
          })),
        ],
        notMeasured: naoMedido,
      }, Date.now() - t0);
    } catch (e) {
      try {
        await failRun(db, runId, "falha ao gravar a medição", String(e).slice(0, 200), Date.now() - t0);
      } catch { /* idem */ }
    }
  }

  await recordEvent("variancia_study", { meta: {
    n: resumo?.n ?? 0,
    independentes: resumo ? janelasIndependentes(resumo.n, JANELA_DIAS) : 0,
    mediaPct: resumo?.mediaPct ?? null, medianaPct: resumo?.medianaPct ?? null,
    piorPct: resumo?.piorPct ?? null, cauda5Pct: resumo?.cauda5Pct ?? null,
    fracaoNegativa: resumo?.fracaoNegativa ?? null,
    episodiosNegativos: resumo?.episodiosNegativos ?? null,
    implicitaMediaPct: resumo?.implicitaMediaPct ?? null,
    realizadaMediaPct: resumo?.realizadaMediaPct ?? null,
    semFuturo, status: veredito.status,
    cobertaStatus: vereditoCob.status,
    cobertaMelhorTeto: melhorCob ? Math.round((melhorCob.strikeFrac - 1) * 100) : null,
    cobertaVantagem: melhorCob?.vantagemPct ?? null,
    cobertaGanhouPct: melhorCob ? Math.round(melhorCob.fracaoGanhou * 100) : null,
    dvolDe: dvol.primeiroDia ?? null, dvolAte: dvol.ultimoDia ?? null,
    falhas: falhas.join(" · ") || null,
    tookMs: Date.now() - t0,
  } });

  return NextResponse.json({
    veredito,
    resumo: resumo == null ? null : {
      ...resumo,
      independentes: janelasIndependentes(resumo.n, JANELA_DIAS),
      janelaDias: JANELA_DIAS,
      historicoDias: HISTORICO_DIAS,
      /** Dias com implícita mas sem 30 dias de futuro — saem da conta. */
      semFuturo,
      dvolDe: dvol.primeiroDia ?? null,
      dvolAte: dvol.ultimoDia ?? null,
      diasComPreco: spot.porDia.size,
    },
    /** ⚠️ FASE 5.2 — simulação. Ver `coberta.ts`. */
    coberta: { veredito: vereditoCob, porTeto: cobertas },
    /** As piores da série INTEIRA — é o que a tabela diz mostrar. */
    piores: pioresJanelas(pontos, 40),
    /** E as recentes, separadas e ditas, para ver o regime de agora. */
    recentes: pontos.slice(-60),
    falhas: falhas.length ? falhas : null,
    naoMedido,
    aviso: "Leitura pura. Mede o PRÊMIO de vender volatilidade (implícita menos a "
      + "realizada que veio depois), não a estratégia de call coberta.",
    tookMs: Date.now() - t0,
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
