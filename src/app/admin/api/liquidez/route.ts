import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { recordEvent } from "@/lib/admin/track";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { startRun, finishRun, failRun } from "@/lib/lab/store";
import { fetchLlamaYields, type LlamaPool } from "@/lib/api/defillama-yields";
import { fetchLiFiQuote, LIFI_NATIVE, LIFI_CHAIN_IDS } from "@/lib/api/lifi";
import { findToken } from "@/lib/tokens";
import {
  ALVOS, MIN_PISCINAS, janelaPiscina, resumirLiquidez, vereditoLiquidez,
  custoGasPct, GAS_TOTAL_LP, GAS_UNIDADES_LP,
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

/** O capital da mesa. Declarado no registro, repetido aqui porque o gás é % dele. */
const CAPITAL_USD = 2_000;

/** Endereço só de leitura — a LI.FI exige `fromAddress` para cotar. */
const ENDERECO_LEITURA = "0x0000000000000000000000000000000000000001";

/**
 * DÓLARES POR UNIDADE DE GÁS, na Ethereum — MEDIDO, não chutado.
 *
 * ⚠️ Sai dos `gasCosts` de uma cotação REAL: a resposta traz o custo em dólar e
 * o número de unidades juntos, então a divisão é uma medição, não uma
 * estimativa. Mesma técnica da Fase 4.
 *
 * ⚠️ E DEVOLVE null QUANDO O CAMPO NÃO VEM. Na Fase 4 isso virava zero em
 * silêncio, e "gás barato" ficava idêntico a "gás não lido" — exatamente o par
 * de estados que esta casa não deixa mais colapsar.
 */
async function usdPorUnidadeDeGas(): Promise<{
  usdPorGas: number | null; usdDaCotacao?: number; unidadesDaCotacao?: number; falha?: string;
}> {
  try {
    const chainId = LIFI_CHAIN_IDS.ethereum;
    const usdc = findToken("ethereum", "USDC");
    if (!usdc || chainId == null) {
      return { usdPorGas: null, falha: "lifi: sem USDC ou sem id de cadeia" };
    }
    const bruto = BigInt(Math.round(CAPITAL_USD / 2)) * 10n ** BigInt(usdc.decimals);
    const q = await fetchLiFiQuote({
      fromChainId: chainId, toChainId: chainId,
      fromToken: usdc.address, toToken: LIFI_NATIVE,
      fromAmount: bruto.toString(),
      fromAddress: ENDERECO_LEITURA,
      slippageBps: 50,
    }, process.env.LIFI_API_KEY);

    let usd = 0, unidades = 0;
    for (const c of q.estimate?.gasCosts ?? []) {
      const u = parseFloat(c.amountUSD ?? "");
      const n = parseFloat(c.estimate ?? c.limit ?? "");
      if (Number.isFinite(u)) usd += u;
      if (Number.isFinite(n)) unidades += n;
    }
    if (!(usd > 0) || !(unidades > 0)) {
      return { usdPorGas: null, falha: "lifi: cotação sem gasCosts" };
    }
    return { usdPorGas: usd / unidades, usdDaCotacao: usd, unidadesDaCotacao: unidades };
  } catch (e) {
    return { usdPorGas: null, falha: `lifi:${String(e).slice(0, 60)}` };
  }
}

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
        capitalUsd: CAPITAL_USD,
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

  const [rendimentos, gas, ...historicos] = await Promise.all([
    fetchLlamaYields(),
    usdPorUnidadeDeGas(),
    ...simbolos.map((s) => fechamentosDiarios(s, desdeMs, ateMs)),
  ]);

  const porSimbolo = new Map(simbolos.map((s, i) => [s, historicos[i]]));
  const falhas = [
    ...rendimentos.falhas.map((f) => `${f.host}:${f.status}`),
    ...historicos.map((h) => h.falha).filter(Boolean) as string[],
    ...(gas.falha ? [gas.falha] : []),
  ];

  // ⚠️ null aqui viaja como null até a janela, que marca `gasDe: "ausente"`.
  // Zero seria "gás grátis", que é uma afirmação e não um dado.
  const gasPct = gas.usdPorGas == null ? null : custoGasPct(CAPITAL_USD, gas.usdPorGas);

  /**
   * ⚠️ A PARCELA DO GÁS, PARA A TELA — agregado sem parcela não é auditável.
   *
   * Na rodada de 10/08 o gás saiu 0,01% (US$ 0,20 pela ida e volta INTEIRA na
   * Ethereum), número que exige conferência e que não tinha como ser conferido:
   * a tela mostrava só o percentual. Agora mostra a cotação que o produziu e o
   * gwei implícito, que é a unidade em que se sabe se um gás é plausível.
   */
  const gasDetalhe = gas.usdPorGas == null ? null : {
    usdPorGas: gas.usdPorGas,
    usdTotal: Number((GAS_TOTAL_LP * gas.usdPorGas).toFixed(4)),
    unidades: GAS_TOTAL_LP,
    cotacaoUsd: gas.usdDaCotacao ?? null,
    cotacaoUnidades: gas.unidadesDaCotacao ?? null,
  };

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
      gasPct,
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
    "⚠️ cada número do cabeçalho é a mediana da SUA coluna, e cada uma pode vir "
      + "de uma piscina diferente. NÃO se combinam: `taxa − perda` não dá a "
      + "`vantagem`. A régua é a vantagem; as outras colunas são contexto",
    "⚠️ a TROCA para montar a cesta 50/50 NÃO entra — de propósito. Quem vai "
      + "SEGURAR metade em cada ativo paga a mesma troca na entrada e na saída, "
      + "então ela cancela entre os dois lados. O que entra é só o gás de piscina, "
      + "que quem segura não paga",
    `o GÁS usa unidades DECLARADAS (${GAS_TOTAL_LP.toLocaleString("pt-BR")} no total: `
      + `2 aprovações de ${GAS_UNIDADES_LP.aprovar.toLocaleString("pt-BR")}, depósito de `
      + `${GAS_UNIDADES_LP.depositar.toLocaleString("pt-BR")}, saque de `
      + `${GAS_UNIDADES_LP.sacar.toLocaleString("pt-BR")}); o PREÇO delas é medido. `
      + "Um par v3 ou uma piscina de 3 ativos gasta diferente",
    "o gás da SAÍDA é cobrado junto com o da entrada, sobre o capital inicial — "
      + "superestima num mercado que caiu, subestima num que subiu",
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
      // ⚠️ O custo desta mesa tem DUAS parcelas: a perda impermanente e o gás.
      // Só a perda aqui esconderia metade do que a mesa paga.
        // ⚠️ O "custo" desta mesa é a perda impermanente, e ela é NEGATIVA na
        // janela. Vai como número positivo porque a coluna é custo — inverter o
        // sinal aqui é o que a invariante nº 1 cobra.
        costPct: resumo.ilMedianoPct == null ? null
          : Number((Math.abs(resumo.ilMedianoPct) + (resumo.gasMedianoPct ?? 0)).toFixed(4)),
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
      gasMedianoPct: resumo.gasMedianoPct,
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
      gasMedianoPct: resumo.gasMedianoPct,
      semGas: resumo.semGas,
      incertezaTaxaPct: resumo.incertezaTaxaPct,
      piscinaMediana: resumo.piscinaMediana,
      segurarMedianoPct: resumo.segurarMedianoPct,
      ganhouDeSegurar: resumo.ganhouDeSegurar,
      medidas: resumo.medidas.length,
      semApy: resumo.semApy,
    },
    gasDetalhe,
    piscinas: janelas.map((j) => ({
      id: j.alvo.id, rotulo: j.alvo.rotulo, porque: j.alvo.porque,
      controle: j.alvo.controle === true,
      dias: j.dias, razao: j.razao,
      ilPct: j.ilPct, taxaPct: j.taxaPct,
      vantagemPct: j.vantagemPct, lpPct: j.lpPct, segurarPct: j.segurarPct,
      apyDe: j.apyDe, apyAnualPct: j.apyAnualPct,
      gasPct: j.gasPct, gasDe: j.gasDe,
      desacordoTaxaPct: j.desacordoTaxaPct, casada: j.casada,
    })),
    veredito,
    naoMedido,
    tookMs: Date.now() - t0,
  });
}
