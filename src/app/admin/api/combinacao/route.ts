import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { recordEvent } from "@/lib/admin/track";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { startRun, finishRun, failRun } from "@/lib/lab/store";
import { BY_SLUG } from "@/lib/lab/registry";
import { fetchLlamaYields, fetchPoolChart, resumoFalhas } from "@/lib/api/defillama-yields";
import { ALVOS, casaAlvo, escolherApy, produtosDistintos } from "@/lib/lab/rendimento";
import {
  alinhar, matrizCorrelacao, correlacaoMedia, estatisticas, carteiraIgual,
  vereditoCombinacao, melhorParte, diaUtc, type Fluxo,
} from "@/lib/lab/combinacao";
import { effectiveSampleSize } from "@/lib/zion/benchmarks";
import { median } from "@/lib/zion/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * COMBINAR AS VERDES — Fase 4.5.
 *
 * Ver a nota grande em `src/lib/lab/combinacao.ts` para as três armadilhas que
 * esta medição existe para não cair, e para por que ela compara contra a MELHOR
 * PARTE em vez de contra a média das partes.
 *
 * ⚠️ LEITURA PURA. Não abre posição, não escreve em `admin_kv`, não altera mesa.
 *
 * ⚠️ ESTA FASE MEDE UMA HIPÓTESE MINHA. Fui eu que propus combinar as verdes.
 * Hipótese própria é exatamente onde eu já errei duas vezes — o clima e o
 * filtro de regime, as duas derrubadas pela minha própria medição, a segunda
 * INVERTIDA. O código abaixo está escrito para poder me desmentir.
 */

/**
 * ⚠️ O MOTOR DE CADA FLUXO, e é ele que sustenta a tese.
 *
 * Combinar só diversifica se as CAUSAS forem diferentes. Se os quatro fossem
 * variações de "o mercado está comprado", seriam quatro sabores do funding e a
 * correlação diria isso. Declarado aqui para o veredito poder ser conferido
 * contra a razão, não só contra o número.
 */
const MOTOR: Record<string, string> = {
  funding_basis: "posicionamento — quem está comprado no perpétuo paga quem está vendido",
  stablecoin_lending: "demanda de crédito — quem toma emprestado paga quem deposita",
  tokenized_treasury: "juro soberano — o título público paga o portador",
  liquid_staking: "emissão do protocolo — a rede paga quem a valida",
};

/**
 * Só as VERDES entram. Cinza não é aprovação e morta não entra em carteira.
 *
 * ⚠️ Lê o status do registro, não uma lista fixa: se uma delas for reprovada
 * amanhã, ela sai da carteira sozinha. Lista fixa aqui viraria uma segunda
 * fonte de verdade sobre o que está aprovado.
 */
function verdesElegiveis(): string[] {
  return Object.keys(MOTOR).filter((slug) => BY_SLUG.get(slug)?.status === "verde");
}

/**
 * Custo de ida e volta por fluxo — MEDIDO na Fase 4, não inventado aqui.
 * Ver `rendimento.ts` e a tabela por faixa do painel 🏦.
 */
const CUSTO_PADRAO: Record<string, number> = {
  funding_basis: 0.45,
  stablecoin_lending: 0.0012,
  tokenized_treasury: 0.4161,
  liquid_staking: 0.4464,
};

interface OkxRow { fundingTime?: string; realizedRate?: string; fundingRate?: string }

/**
 * O funding diário de um símbolo âncora, somando os períodos de 8h por dia UTC.
 *
 * ⚠️ UM SÍMBOLO, NÃO A CESTA. A carteira aloca uma fatia em funding, e medir a
 * cesta inteira misturaria duas perguntas: "quanto rende funding" (Fase 3, já
 * respondida) e "funding diversifica contra crédito" (esta). O símbolo é
 * DECLARADO, não escolhido olhando o resultado.
 */
const SIMBOLO_FUNDING = process.env.COMBINACAO_FUNDING_SYMBOL ?? "BTC";

async function fluxoFunding(): Promise<{ fluxo: Fluxo | null; falha?: string }> {
  const porDia = new Map<string, number>();
  let after: number | undefined;
  try {
    for (let pagina = 0; pagina < 6; pagina++) {
      const params = new URLSearchParams({
        instId: `${SIMBOLO_FUNDING}-USDT-SWAP`, limit: "100",
      });
      if (after != null) params.set("after", String(after));
      const res = await fetch(
        `https://www.okx.com/api/v5/public/funding-rate-history?${params}`,
        { cache: "no-store" },
      );
      if (!res.ok) return { fluxo: null, falha: `okx:${res.status}` };
      const body = await res.json() as { data?: OkxRow[] };
      const lista = body.data ?? [];
      if (lista.length === 0) break;
      for (const r of lista) {
        const t = Number(r.fundingTime ?? 0);
        const taxa = parseFloat(r.realizedRate ?? r.fundingRate ?? "") * 100;
        if (!(t > 0) || !Number.isFinite(taxa)) continue;
        const d = diaUtc(t);
        porDia.set(d, (porDia.get(d) ?? 0) + taxa);
      }
      const tempos = lista.map((r) => Number(r.fundingTime ?? 0)).filter((x) => x > 0);
      if (tempos.length === 0) break;
      after = Math.min(...tempos);
      if (lista.length < 100) break;
    }
  } catch (e) {
    return { fluxo: null, falha: `okx:${String(e).slice(0, 40)}` };
  }
  if (porDia.size === 0) return { fluxo: null, falha: "okx: sem pontos" };
  /**
   * ⚠️ O PRIMEIRO E O ÚLTIMO DIA SAEM FORA. Eles quase sempre estão
   * incompletos — a paginação começa e termina no meio de um dia — e um dia com
   * um pagamento de 8h em vez de três parece um dia de renda baixa. Perder dois
   * dias é honesto; deixar dois dias truncados vira um mínimo falso na série.
   */
  const chaves = [...porDia.keys()].sort();
  porDia.delete(chaves[0]);
  if (chaves.length > 1) porDia.delete(chaves[chaves.length - 1]);
  return {
    fluxo: {
      slug: "funding_basis", nome: `Funding (${SIMBOLO_FUNDING})`,
      motor: MOTOR.funding_basis, porDia,
      idaEVoltaPct: CUSTO_PADRAO.funding_basis,
    },
  };
}

/**
 * O rendimento diário de uma piscina.
 *
 * ⚠️ `apyBase` MANDA, e a ausência dele NÃO vira `apy` em silêncio quando o
 * `apy` traz recompensa embutida — a mesma regra da Fase 4. O retorno do dia é
 * `apy/365`, que é o que a posição rende naquele dia.
 */
function serieDaPiscina(
  pontos: Array<{ timestamp?: string; apyBase?: number | null; apy?: number | null }>,
): { porDia: Map<string, number>; semBase: number } {
  const porDia = new Map<string, number>();
  let semBase = 0;
  for (const p of pontos) {
    if (!p.timestamp) continue;
    const ms = Date.parse(p.timestamp);
    if (!Number.isFinite(ms)) continue;
    let apy: number | null = null;
    if (typeof p.apyBase === "number" && Number.isFinite(p.apyBase)) apy = p.apyBase;
    else if (typeof p.apy === "number" && Number.isFinite(p.apy)) { apy = p.apy; semBase++; }
    if (apy == null) continue;
    porDia.set(diaUtc(ms), apy / 365);
  }
  return { porDia, semBase };
}

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();
  const deadline = t0 + (maxDuration - 12) * 1000;
  const db = getSupabaseAdmin();

  const elegiveis = verdesElegiveis();
  const falhas: string[] = [];
  const fluxos: Fluxo[] = [];
  let hostUsado = "";
  let diasSemBase = 0;

  // ── 1. O fluxo de funding, se ele for verde.
  if (elegiveis.includes("funding_basis")) {
    const { fluxo, falha } = await fluxoFunding();
    if (fluxo) fluxos.push(fluxo);
    if (falha) falhas.push(`funding_basis ${falha}`);
  }

  // ── 2. Os fluxos de piscina: a maior piscina do maior produto de cada verde.
  const alvosVerdes = ALVOS.filter((a) => elegiveis.includes(a.slug));
  if (alvosVerdes.length > 0) {
    const r = await fetchLlamaYields(deadline);
    hostUsado = r.hostUsado;
    if (r.pools.length === 0) {
      falhas.push(`piscinas ${resumoFalhas(r.falhas) || "sem status"}`);
    } else {
      for (const alvo of alvosVerdes) {
        const casadas = r.pools
          .filter((p) => casaAlvo(p, alvo))
          .map((p) => ({ p, escolha: escolherApy(p) }))
          .filter((x) => x.escolha != null);
        /**
         * ⚠️ A MAIOR PISCINA DO MAIOR PRODUTO. `produtosDistintos` colapsa o
         * mesmo emissor em várias cadeias — a correção de 06/08 — e aqui
         * queremos UMA série por estratégia, não uma por implantação.
         */
        const produtos = produtosDistintos(casadas.map(({ p, escolha }) => ({
          slug: alvo.slug, poolId: String(p.pool ?? ""), projeto: String(p.project ?? ""),
          cadeia: String(p.chain ?? ""), simbolo: String(p.symbol ?? ""),
          tvlUsd: Number(p.tvlUsd ?? 0), apyPct: escolha!.apyPct,
          apyDe: escolha!.apyDe, apyRecompensaPct: null,
        })));
        const maior = produtos[0];
        if (!maior?.poolId) { falhas.push(`${alvo.slug}: sem piscina casada`); continue; }
        if (Date.now() > deadline) { falhas.push(`${alvo.slug}: tempo esgotado`); continue; }
        const chart = await fetchPoolChart(maior.poolId);
        if (chart.falha) { falhas.push(`${alvo.slug} chart:${chart.falha}`); continue; }
        const { porDia, semBase } = serieDaPiscina(chart.pontos);
        diasSemBase += semBase;
        if (porDia.size === 0) { falhas.push(`${alvo.slug}: série sem APY utilizável`); continue; }
        fluxos.push({
          slug: alvo.slug,
          nome: `${BY_SLUG.get(alvo.slug)?.name ?? alvo.slug} · ${maior.projeto} ${maior.simbolo}`,
          motor: MOTOR[alvo.slug] ?? "—",
          porDia,
          idaEVoltaPct: CUSTO_PADRAO[alvo.slug] ?? 0,
        });
      }
    }
  }

  const capital = BY_SLUG.get("carteira_verde")?.capitalRequiredUsd ?? 5000;
  let runId: string | null = null;
  if (db) {
    try {
      runId = await startRun(db, {
        slug: "carteira_verde", capitalUsd: capital, windowDays: 365,
        params: {
          fluxos: fluxos.map((f) => f.slug), elegiveis,
          simboloFunding: SIMBOLO_FUNDING, fonte: hostUsado || null,
        },
      });
    } catch { /* o laboratório é registro, não pré-requisito da medição */ }
  }

  // ── 3. Alinhar POR DATA e medir. Ver a nota em `alinhar`.
  const { dias, matriz } = alinhar(fluxos);
  const correl = matrizCorrelacao(matriz);
  const rho = correlacaoMedia(correl);

  const partes = fluxos.map((f, i) => {
    const e = estatisticas(matriz[i] ?? []);
    return {
      slug: f.slug, nome: f.nome, motor: f.motor,
      diasProprios: f.porDia.size,
      idaEVoltaPct: f.idaEVoltaPct,
      brutoPct: e?.anualizadoPct ?? null,
      liquidoPct: e == null ? null : Number((e.anualizadoPct - f.idaEVoltaPct).toFixed(4)),
      volAnualPct: e?.volAnualPct ?? null,
      tomboPct: e?.tomboPct ?? null,
      diasNegativos: e?.diasNegativos ?? null,
    };
  });

  const { retornosDiarios, custoEntradaPct } = carteiraIgual(fluxos, matriz);
  const carteira = estatisticas(retornosDiarios);
  const carteiraLiquidaPct = carteira == null
    ? null : Number((carteira.anualizadoPct - custoEntradaPct).toFixed(4));

  const melhor = melhorParte(partes);
  const veredito = vereditoCombinacao({
    fluxos: fluxos.length, diasComuns: dias.length, carteira, carteiraLiquidaPct,
    melhorParteNome: melhor?.nome ?? "—",
    melhorParteLiquidaPct: melhor?.liquidoPct ?? null,
    melhorParteTomboPct: melhor?.tomboPct ?? null,
    rhoMedio: rho,
  });

  const naoMedido = [
    "⚠️ O RISCO QUE DECIDE NÃO ESTÁ NA SÉRIE: exploit de contrato, despegue do ativo e "
      + "falha de emissor não aparecem em volatilidade. Ranquear por vol ordenaria as "
      + "estratégias por QUAL RISCO NÓS DEIXAMOS DE MEDIR, premiando a que esconde melhor",
    "rebalanceamento — a carteira é de peso igual e NUNCA rebalanceia; rebalancear custa, "
      + "e a Fase 4 mostrou que custo de entrada não é desprezível em fatia pequena",
    "imposto, que é o maior custo isolado para o peixe pequeno",
    `o funding usa UM símbolo âncora (${SIMBOLO_FUNDING}), não a cesta da Fase 3 — `
      + "misturar as duas responderia duas perguntas ao mesmo tempo",
    ...(diasSemBase > 0
      ? [`⚠️ ${diasSemBase} pontos usaram \`apy\` total por falta de \`apyBase\` — nesses, `
         + "recompensa em token de incentivo pode estar embutida"]
      : []),
  ];

  if (db && runId) {
    try {
      await finishRun(db, runId, {
        netAnnualizedPct: carteiraLiquidaPct,
        grossPct: carteira?.anualizadoPct ?? null,
        costPct: Number(custoEntradaPct.toFixed(4)),
        // A amostra é o número de DIAS em comum: é ele que sustenta a correlação.
        sampleN: dias.length,
        effectiveN: fluxos.length > 0 ? effectiveSampleSize(fluxos.length, rho) : null,
        correlationRho: rho == null ? null : Math.round(rho * 1000) / 1000,
        maxDrawdownPct: carteira?.tomboPct ?? null,
        // ⚠️ O denominador desta fase é a MELHOR PARTE, não comprar-e-segurar:
        // é ela a alternativa real que o dono tem a combinar.
        benchmarkPct: melhor?.liquidoPct ?? null,
        verdict: veredito.status,
        verdictText: veredito.verdict,
        perSymbol: [
          ...partes.map((p) => ({ tipo: "fluxo", ...p })),
          ...correl.map((linha, i) => ({
            tipo: "correlacao",
            de: fluxos[i]?.slug ?? String(i),
            com: linha.map((v, j) => ({
              slug: fluxos[j]?.slug ?? String(j), rho: Math.round(v * 1000) / 1000,
            })),
          })),
        ],
        notMeasured: naoMedido,
      }, Date.now() - t0);
    } catch (e) {
      try {
        await failRun(db, runId, "falha ao gravar a medição", String(e).slice(0, 200), Date.now() - t0);
      } catch { /* o laboratório é registro, não pré-requisito da medição */ }
    }
  }

  await recordEvent("combinacao_study", { meta: {
    fluxos: fluxos.map((f) => f.slug), diasComuns: dias.length, rho,
    carteiraLiquidaPct, melhor: melhor?.slug ?? null,
    melhorLiquidaPct: melhor?.liquidoPct ?? null,
    status: veredito.status, falhas: falhas.join(" · ") || null,
    tookMs: Date.now() - t0,
  } });

  return NextResponse.json({
    veredito,
    resumo: {
      fluxos: fluxos.length,
      diasComuns: dias.length,
      primeiroDia: dias[0] ?? null,
      ultimoDia: dias[dias.length - 1] ?? null,
      rho: rho == null ? null : Math.round(rho * 1000) / 1000,
      apostasEfetivas: fluxos.length > 0
        ? Math.round(effectiveSampleSize(fluxos.length, rho) * 100) / 100 : null,
      capitalUsd: capital,
      fatiaUsd: fluxos.length > 0 ? Math.round(capital / fluxos.length) : null,
      custoEntradaPct: Number(custoEntradaPct.toFixed(4)),
      carteiraBrutaPct: carteira?.anualizadoPct ?? null,
      carteiraLiquidaPct,
      carteiraVolPct: carteira?.volAnualPct ?? null,
      carteiraTomboPct: carteira?.tomboPct ?? null,
      melhorParteNome: melhor?.nome ?? null,
      melhorParteLiquidaPct: melhor?.liquidoPct ?? null,
      melhorParteTomboPct: melhor?.tomboPct ?? null,
      medianaDiasProprios: median(fluxos.map((f) => f.porDia.size)),
      fonte: hostUsado || null,
    },
    partes,
    correlacao: { slugs: fluxos.map((f) => f.slug), matriz: correl },
    falhas: falhas.length ? falhas : null,
    naoMedido,
    aviso: "Leitura pura. A carteira é de peso igual, NUNCA rebalanceia, e é medida "
      + "líquida do custo de entrada de CADA fluxo sobre a fatia dele.",
    tookMs: Date.now() - t0,
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
