import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { recordEvent } from "@/lib/admin/track";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { startRun, finishRun, failRun } from "@/lib/lab/store";
import { fetchLlamaYields, type LlamaPool } from "@/lib/api/defillama-yields";
import {
  ALVOS, MIN_PISCINAS, janelaPiscina, resumirLiquidez, vereditoLiquidez,
  type JanelaPiscina,
} from "@/lib/lab/liquidez";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * SER A CONTRAPARTE — C14 (LP em AMM clássico), Fase 8.1.
 *
 * Ver a nota grande em `src/lib/lab/liquidez.ts`. O resumo: toda interface
 * publica o APR das taxas e nenhuma publica a perda impermanente, que é a outra
 * metade da conta. Esta rota mede as duas e julga contra SEGURAR os mesmos
 * ativos na mesma janela.
 *
 * ⚠️ LEITURA PURA. Não abre posição, não escreve em `admin_kv`, não altera mesa.
 */

/** Fonte de fechamento diário — a mesma do estudo de variância. */
const BINANCE_DATA = "https://data-api.binance.vision";

/**
 * ⚠️ JANELA DECLARADA ANTES DA RODADA (invariante nº 12).
 *
 * Um ano: a perda impermanente é acumulada e precisa de divergência para
 * aparecer. Janela curta num mercado parado devolveria perda ≈0 e venderia a
 * mesa — o mesmo tipo de recorte que fez a sonda de orderbook medir só livro
 * fino.
 */
const JANELA_DIAS = 365;

async function fechamentosDiarios(
  symbol: string, desdeMs: number, ateMs: number,
): Promise<{ porDia: Map<string, number>; falha?: string }> {
  const url = `${BINANCE_DATA}/api/v3/klines?symbol=${symbol}USDT&interval=1d`
    + `&startTime=${Math.floor(desdeMs)}&endTime=${Math.ceil(ateMs)}&limit=1000`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { porDia: new Map(), falha: `binance ${symbol}:${res.status}` };
    const linhas = await res.json() as Array<[number, string, string, string, string, ...unknown[]]>;
    if (!Array.isArray(linhas) || linhas.length === 0) {
      return { porDia: new Map(), falha: `binance ${symbol}: sem velas` };
    }
    const porDia = new Map<string, number>();
    for (const l of linhas) {
      const t = Number(l[0]); const fecha = parseFloat(l[4]);
      if (!(t > 0) || !Number.isFinite(fecha)) continue;
      porDia.set(new Date(t).toISOString().slice(0, 10), fecha);
    }
    return { porDia };
  } catch (e) {
    return { porDia: new Map(), falha: `binance ${symbol}:${String(e).slice(0, 60)}` };
  }
}

/**
 * Acha a piscina declarada na lista da fonte.
 *
 * ⚠️ CASAMENTO FROUXO NO SÍMBOLO, ESTRITO NO RESTO. A fonte escreve
 * "WETH-USDC" e "USDC-WETH" conforme o adaptador, então a comparação é por
 * CONJUNTO de pernas. Projeto e cadeia batem exatos — aceitar "qualquer
 * uniswap" traria uma piscina de $40 mil com APR de três dígitos que não é a
 * que a lista declarou.
 */
function acharPiscina(pools: LlamaPool[], alvo: (typeof ALVOS)[number]): LlamaPool | null {
  const pernas = (s: string) => new Set(s.toUpperCase().split(/[-/]/).filter(Boolean));
  const querido = pernas(alvo.llama.symbol);
  const mesmasPernas = (s?: string) => {
    if (!s) return false;
    const p = pernas(s);
    if (p.size !== querido.size) return false;
    for (const x of querido) if (!p.has(x)) return false;
    return true;
  };
  const candidatas = pools.filter((p) =>
    (p.project ?? "").toLowerCase() === alvo.llama.project.toLowerCase()
    && (p.chain ?? "").toLowerCase() === alvo.llama.chain.toLowerCase()
    && mesmasPernas(p.symbol));
  if (candidatas.length === 0) return null;
  // Empate resolvido pela MAIOR piscina: é a que tem taxa menos ruidosa.
  return candidatas.reduce((a, b) => ((b.tvlUsd ?? 0) > (a.tvlUsd ?? 0) ? b : a));
}

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();
  const db = getSupabaseAdmin();

  const ateMs   = Date.now();
  const desdeMs = ateMs - JANELA_DIAS * 86_400_000;

  let runId: string | null = null;
  if (db) {
    try {
      runId = await startRun(db, {
        slug: "amm_lp",
        capitalUsd: 2_000,
        windowDays: JANELA_DIAS,
        params: { alvos: ALVOS.map((a) => a.id), minPiscinas: MIN_PISCINAS },
      });
    } catch { /* o laboratório é registro, não pré-requisito da medição */ }
  }

  // ⚠️ Símbolos únicos: o par BTC/ETH pede os dois, e o ETH aparece em dois
  // alvos. Buscar duas vezes o mesmo histórico é chamada jogada fora.
  const simbolos = [...new Set(
    ALVOS.flatMap((a) => [a.base, a.cotacao]).filter((s): s is string => !!s),
  )];

  const [rendimentos, ...historicos] = await Promise.all([
    fetchLlamaYields(),
    ...simbolos.map((s) => fechamentosDiarios(s, desdeMs, ateMs)),
  ]);

  const porSimbolo = new Map(simbolos.map((s, i) => [s, historicos[i]]));
  const falhas = [
    ...rendimentos.falhas.map((f) => `${f.host}:${f.status}`),
    ...historicos.map((h) => h.falha).filter(Boolean) as string[],
  ];

  /**
   * ⚠️ FONTE RECUSADA NÃO É PERDA ZERO NEM TAXA ZERO. Sem preço não há como
   * calcular divergência, e "não medimos" tem que sair como FALHA com o status
   * — nunca como um resultado. As duas leituras são opostas.
   */
  const semPreco = simbolos.filter((s) => (porSimbolo.get(s)?.porDia.size ?? 0) === 0);
  if (semPreco.length > 0 || rendimentos.pools.length === 0) {
    const motivo = semPreco.length > 0
      ? `a fonte de preço não respondeu para ${semPreco.join(", ")}`
      : "a fonte de rendimento não respondeu";
    const detalhe = falhas.join(" · ") || "sem status capturado";
    await recordEvent("liquidez_study_failed", {
      meta: { motivo, detalhe, tookMs: Date.now() - t0 },
    });
    if (db && runId) {
      try { await failRun(db, runId, motivo, detalhe, Date.now() - t0); } catch { /* idem */ }
    }
    return NextResponse.json({ error: motivo, detail: detalhe }, { status: 503 });
  }

  const janelas: JanelaPiscina[] = [];
  const naoCasadas: string[] = [];

  for (const alvo of ALVOS) {
    const piscina = acharPiscina(rendimentos.pools, alvo);
    if (!piscina) naoCasadas.push(alvo.rotulo);

    const ponta = (s: string | null, qual: "ini" | "fim"): number | null => {
      if (s === null) return 1;                     // dólar
      const h = porSimbolo.get(s)?.porDia;
      if (!h || h.size === 0) return null;
      const dias = [...h.keys()].sort();
      return h.get(qual === "ini" ? dias[0] : dias[dias.length - 1]) ?? null;
    };

    // Os dias efetivamente cobertos pelo histórico — NÃO os 365 pedidos. Uma
    // listagem recente devolve menos velas, e usar 365 aqui diluiria a taxa
    // sobre um período que não existiu.
    const serie = alvo.base ? porSimbolo.get(alvo.base)?.porDia : null;
    const dias = serie && serie.size > 1 ? serie.size - 1 : JANELA_DIAS;

    const j = janelaPiscina({
      alvo,
      precoBaseIni:    ponta(alvo.base, "ini"),
      precoBaseFim:    ponta(alvo.base, "fim"),
      precoCotacaoIni: ponta(alvo.cotacao, "ini"),
      precoCotacaoFim: ponta(alvo.cotacao, "fim"),
      apyBase:    piscina?.apyBase,
      apyMean30d: piscina?.apyMean30d,
      dias,
      casada: piscina
        ? { symbol: piscina.symbol ?? "?", tvlUsd: Number.isFinite(piscina.tvlUsd as number) ? Number(piscina.tvlUsd) : null }
        : null,
    });
    if (j) janelas.push(j);
  }

  const resumo   = resumirLiquidez(janelas);
  const veredito = vereditoLiquidez(resumo, MIN_PISCINAS);

  /**
   * ⚠️ O QUE ESTA MEDIÇÃO NÃO INCLUI. Omissão que só vive no comentário vira,
   * semanas depois, um número que alguém leu como completo.
   */
  const naoMedido = [
    "⚠️ o GÁS de entrar e sair da piscina — depositar, sacar e coletar taxa. "
      + "Em $2.000 na Ethereum isso é material, e o sinal do veredito pode virar",
    "⚠️ a taxa vem da MÉDIA DE 30 DIAS da fonte, aplicada proporcionalmente à "
      + "janela de um ano. Não é a série real do período — entre 09 e 10/08 a foto "
      + "de 24h do ETH/USDC oscilou 12× (0,25% → 2,97%/ano), e é por isso que a "
      + "média manda aqui. Sem compor: subestima, que é o lado conservador",
    "a perda impermanente é a de PONTA A PONTA. O caminho no meio da janela pode "
      + "ter sido muito pior, e quem saiu no meio realizou aquele número",
    "liquidez concentrada (v3) NÃO está aqui: a perda dela depende da faixa "
      + "escolhida e da gestão dela. Medir com a fórmula de faixa cheia daria um "
      + "número errado com cara de certo — fica para a 8.2",
    "risco de contrato do protocolo da piscina",
  ];
  if (naoCasadas.length > 0) {
    naoMedido.unshift(
      `⚠️ ${naoCasadas.length} piscina(s) declarada(s) não foram encontradas na fonte `
      + `(${naoCasadas.join(", ")}) — entraram sem taxa e ficaram FORA do veredito`,
    );
  }

  if (db && runId) {
    try {
      await finishRun(db, runId, {
        // ⚠️ O TITULAR É A VANTAGEM CONTRA SEGURAR, não o retorno da piscina.
        // A pergunta desta mesa é se ela bate não fazer nada.
        netPct: resumo.vantagemMedianaPct,
        netAnnualizedPct: resumo.vantagemMedianaPct == null ? null
          : Number((resumo.vantagemMedianaPct * (365 / JANELA_DIAS)).toFixed(4)),
        grossPct: resumo.taxaMedianaPct,
        // ⚠️ O "custo" desta mesa é a perda impermanente, e ela é NEGATIVA na
        // janela. Vai como número positivo porque a coluna é custo — inverter o
        // sinal aqui é o que a invariante nº 1 cobra.
        costPct: resumo.ilMedianoPct == null ? null : Math.abs(resumo.ilMedianoPct),
        sampleN: resumo.medidas.length,
        // ⚠️ O denominador é SEGURAR os mesmos ativos — a alternativa real.
        benchmarkPct: resumo.segurarMedianoPct,
        verdict: veredito.status,
        verdictText: veredito.texto,
        notMeasured: naoMedido,
      }, Date.now() - t0);
    } catch { /* idem */ }
  }

  await recordEvent("liquidez_study", {
    meta: {
      veredito: veredito.status,
      vantagemMedianaPct: resumo.vantagemMedianaPct,
      ilMedianoPct: resumo.ilMedianoPct,
      piscinas: resumo.medidas.length,
      tookMs: Date.now() - t0,
    },
  });

  return NextResponse.json({
    janelaDias: JANELA_DIAS,
    minPiscinas: MIN_PISCINAS,
    hostUsado: rendimentos.hostUsado,
    falhas,
    naoCasadas,
    resumo: {
      ilMedianoPct: resumo.ilMedianoPct,
      taxaMedianaPct: resumo.taxaMedianaPct,
      vantagemMedianaPct: resumo.vantagemMedianaPct,
      lpMedianoPct: resumo.lpMedianoPct,
      segurarMedianoPct: resumo.segurarMedianoPct,
      ganhouDeSegurar: resumo.ganhouDeSegurar,
      medidas: resumo.medidas.length,
      semApy: resumo.semApy,
    },
    piscinas: janelas.map((j) => ({
      id: j.alvo.id, rotulo: j.alvo.rotulo, porque: j.alvo.porque,
      controle: j.alvo.controle === true,
      dias: j.dias, razao: j.razao,
      ilPct: j.ilPct, taxaPct: j.taxaPct,
      vantagemPct: j.vantagemPct, lpPct: j.lpPct, segurarPct: j.segurarPct,
      apyDe: j.apyDe, apyAnualPct: j.apyAnualPct, casada: j.casada,
    })),
    veredito,
    naoMedido,
    tookMs: Date.now() - t0,
  });
}
