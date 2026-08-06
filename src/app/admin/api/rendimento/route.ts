import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { recordEvent } from "@/lib/admin/track";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { startRun, finishRun, failRun } from "@/lib/lab/store";
import { BY_SLUG } from "@/lib/lab/registry";
import { fetchLlamaYields, resumoFalhas } from "@/lib/api/defillama-yields";
import { fetchLiFiQuote, LIFI_CHAIN_IDS, LIFI_NATIVE, type LfQuote } from "@/lib/api/lifi";
import { findToken } from "@/lib/tokens";
import { median } from "@/lib/zion/stats";
import {
  ALVOS, FAIXAS_PADRAO, casaAlvo, escolherApy, custoDaFaixa, produtosDistintos,
  liquidoPrimeiroAnoPct, equilibrioDias, vereditoRendimento,
  type PiscinaMedida, type CustoFaixa,
} from "@/lib/lab/rendimento";
import type { ChainId } from "@/lib/chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * RENDIMENTO INTEGRADO — C1 a C4, o que sobra depois de entrar e sair.
 *
 * Ver a nota grande em `src/lib/lab/rendimento.ts` para as decisões (lista
 * declarada em vez de ranking, `apyBase` mandando sobre `apyReward`, custo
 * medido em vez de constante) e para o que esta conta NÃO inclui.
 *
 * ⚠️ LEITURA PURA. Não abre posição, não escreve em `admin_kv`, não altera
 * mesa nenhuma. Mesma regra do 🪙 e do 🧭.
 *
 * ⚠️ QUATRO ESTRATÉGIAS, QUATRO RODADAS. `stablecoin_lending`,
 * `tokenized_treasury`, `liquid_staking` e `restaking` são coisas diferentes,
 * com capital declarado diferente e risco diferente. Uma rodada só, com as
 * quatro somadas, seria a mistura que o dono proibiu — e impediria o painel de
 * dizer qual delas está viva.
 */

/**
 * ⚠️ ENDEREÇO DE LEITURA, e ele não assina nada.
 *
 * A `/v1/quote` da LI.FI EXIGE `fromAddress` para montar a rota assinável — a
 * própria `fetchLiFiQuote` recusa localmente sem ele (código 1011 do lado
 * deles). Cotação é leitura: não há transação, não há aprovação, não há chave.
 * Uso o endereço nulo, que é público e não pertence a ninguém.
 */
const ENDERECO_LEITURA = "0x000000000000000000000000000000000000dEaD";

/** Cadeia da DefiLlama → cadeia daqui. O que não estiver aqui não é cotável. */
const CADEIA_LLAMA: Record<string, ChainId> = {
  Ethereum: "ethereum", Base: "base", Arbitrum: "arbitrum",
  Polygon: "polygon", Optimism: "optimism", Avalanche: "avalanche", BSC: "bsc",
};

interface CustoCadeia {
  cadeia: ChainId;
  /** Dólares por unidade de gás — MEDIDO, sai da cotação. */
  usdPorGas: number;
  /** Custo percentual de UMA troca, por faixa de capital — MEDIDO. */
  trocaPctPorFaixa: Map<number, number>;
  /**
   * \u26a0\ufe0f\u26a0\ufe0f A COTA\u00c7\u00c3O TROUXE `gasCosts`? (06/08)
   *
   * `gasDaCotacao` devolve null quando o campo vem vazio, e a\u00ed o meu `gasUsd`
   * virava ZERO em sil\u00eancio. O efeito na rodada de 06/08: o custo mal se mexeu
   * entre $500 e $50.000, o que se l\u00ea como "o g\u00e1s deixou de ser barreira" \u2014 a
   * hip\u00f3tese central desta fase, refutada. S\u00f3 que "g\u00e1s barato" e "g\u00e1s n\u00e3o lido"
   * davam EXATAMENTE a mesma tela, e eu n\u00e3o tinha como separar as duas.
   *
   * \u00c9 o padr\u00e3o que esta semana j\u00e1 achou seis vezes \u2014 dois estados diferentes com
   * a mesma apar\u00eancia \u2014 desta vez dentro do c\u00f3digo que escrevi no mesmo dia.
   */
  cotacoes: number;
  cotacoesComGas: number;
  falha?: string;
}

/** Soma os `gasCosts` de uma cotação: dólares e unidades, na mesma resposta. */
function gasDaCotacao(q: LfQuote): { usd: number; unidades: number } | null {
  const cs = q.estimate?.gasCosts ?? [];
  let usd = 0, unidades = 0;
  for (const c of cs) {
    const u = parseFloat(c.amountUSD ?? "");
    const n = parseFloat(c.estimate ?? c.limit ?? "");
    if (Number.isFinite(u)) usd += u;
    if (Number.isFinite(n)) unidades += n;
  }
  if (usd <= 0 || unidades <= 0) return null;
  return { usd, unidades };
}

/**
 * O custo percentual de UMA troca naquela faixa.
 *
 * ⚠️ IMPACTO + TAXA + GÁS, os três, e nenhum estimado. `fromToken.priceUSD` e
 * `toToken.priceUSD` vêm na resposta; a diferença entre o que entra e o que sai
 * É o custo, e ela já contém a taxa da rota. O gás entra por fora porque a
 * LI.FI o cobra em moeda nativa, não descontado do token.
 */
function custoDaTroca(q: LfQuote): number | null {
  const pFrom = parseFloat(q.action?.fromToken?.priceUSD ?? "");
  const pTo = parseFloat(q.action?.toToken?.priceUSD ?? "");
  const dFrom = q.action?.fromToken?.decimals;
  const dTo = q.action?.toToken?.decimals;
  const aFrom = parseFloat(q.estimate?.fromAmount ?? "");
  const aTo = parseFloat(q.estimate?.toAmount ?? "");
  if (![pFrom, pTo, aFrom, aTo].every(Number.isFinite)) return null;
  if (typeof dFrom !== "number" || typeof dTo !== "number") return null;
  const entraUsd = (aFrom / 10 ** dFrom) * pFrom;
  const saiUsd = (aTo / 10 ** dTo) * pTo;
  if (entraUsd <= 0) return null;
  const gas = gasDaCotacao(q);
  const gasUsd = gas?.usd ?? 0;
  return ((entraUsd - saiUsd + gasUsd) / entraUsd) * 100;
}

/**
 * Mede, numa cadeia, o preço do gás e o custo de troca em cada faixa.
 *
 * A âncora é USDC porque ela vale $1: converter uma faixa em dólares para
 * unidades não exige consultar preço nenhum, e uma consulta a menos é uma
 * fonte de erro a menos. O destino é o token nativo — é a troca mais líquida
 * que existe naquela cadeia, então o custo medido é o PISO, e piso declarado
 * é melhor que média inventada.
 */
async function medirCadeia(
  cadeia: ChainId, faixas: number[], deadline: number,
): Promise<CustoCadeia> {
  const usdc = findToken(cadeia, "USDC");
  const chainId = LIFI_CHAIN_IDS[cadeia];
  const vazio: CustoCadeia = {
    cadeia, usdPorGas: 0, trocaPctPorFaixa: new Map(), cotacoes: 0, cotacoesComGas: 0,
  };
  if (!usdc || chainId == null) return { ...vazio, falha: "sem USDC ou sem id na LI.FI" };

  let usdPorGas = 0;
  let cotacoes = 0, cotacoesComGas = 0;
  const porFaixa = new Map<number, number>();
  const erros: string[] = [];

  for (const faixa of faixas) {
    if (Date.now() > deadline) { erros.push(`${faixa}:tempo`); break; }
    /**
     * ⚠️ POTÊNCIA EM BigInt, NÃO `faixa * 10 ** decimals` (06/08).
     *
     * A USDC da BSC tem 18 casas. `50000 * 1e18` é 5e22 — muito acima do
     * inteiro seguro do JavaScript (9e15), então o número já chega ao `BigInt`
     * arredondado pelo ponto flutuante. Aqui o erro seria pequeno, mas a
     * família do defeito não é: é o mesmo "parece exato e não é" que faz uma
     * conta de dinheiro passar despercebida até o dia em que não passa.
     */
    const bruto = BigInt(Math.round(faixa)) * 10n ** BigInt(usdc.decimals);
    try {
      const q = await fetchLiFiQuote({
        fromChainId: chainId, toChainId: chainId,
        fromToken: usdc.address, toToken: LIFI_NATIVE,
        fromAmount: bruto.toString(),
        fromAddress: ENDERECO_LEITURA,
        slippageBps: 50,
      }, process.env.LIFI_API_KEY);
      cotacoes++;
      const custo = custoDaTroca(q);
      if (custo != null) porFaixa.set(faixa, custo);
      const g = gasDaCotacao(q);
      if (g) {
        cotacoesComGas++;
        // O preço por unidade é o mesmo em qualquer faixa; o primeiro serve.
        if (usdPorGas === 0) usdPorGas = g.usd / g.unidades;
      }
    } catch (e) {
      erros.push(`${faixa}:${String(e).slice(0, 40)}`);
    }
  }
  return {
    cadeia, usdPorGas, trocaPctPorFaixa: porFaixa, cotacoes, cotacoesComGas,
    falha: erros.length ? erros.join(" ") : undefined,
  };
}

interface LinhaEstrategia {
  slug: string;
  nome: string;
  capitalUsd: number;
  piscinas: PiscinaMedida[];
  naoEncontrados: string[];
  faixas: Array<CustoFaixa & {
    /** A cadeia MAIS BARATA naquela faixa — sem ela o líquido não é acionável. */
    cadeia: ChainId | null;
    apyBrutoPct: number | null;
    liquido1oAnoPct: number | null;
    equilibrioDias: number | null;
  }>;
  apyBrutoMedianoPct: number | null;
  liquidoNaFaixaDeclaradaPct: number | null;
  /** A cotação devolveu custo negativo em alguma faixa? Ver `custoDaFaixa`. */
  precoIncoerente: boolean;
  /** `gasCosts` veio nas cotações desta estratégia? null = não houve cotação. */
  gasLido: boolean | null;
  /** Produtos distintos (emissor+ativo), que é a amostra de verdade. */
  produtos: number;
  veredito: ReturnType<typeof vereditoRendimento>;
}

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();
  // Margem de 12s para montar o resultado e gravar quatro rodadas depois.
  const deadline = t0 + (maxDuration - 12) * 1000;
  const db = getSupabaseAdmin();

  // ── 1. O rendimento. Host separado do `defillama.ts`; ver a nota lá.
  const { pools, hostUsado, falhas } = await fetchLlamaYields(deadline);
  const falhasTexto = resumoFalhas(falhas);

  if (pools.length === 0) {
    await recordEvent("rendimento_study_failed", { meta: {
      motivo: "nenhuma piscina retornada", detalhe: falhasTexto || "sem status capturado",
      tookMs: Date.now() - t0,
    } });
    return NextResponse.json({
      error: "a fonte de rendimento não respondeu",
      detail: falhasTexto || "sem status capturado",
    }, { status: 503 });
  }

  // ── 2. Casar com a lista DECLARADA, e guardar o que ela não achou.
  const porSlug = new Map<string, PiscinaMedida[]>();
  const naoAchados = new Map<string, string[]>();
  const cadeiasUsadas = new Set<ChainId>();

  for (const alvo of ALVOS) {
    const achadas: PiscinaMedida[] = [];
    const projetosAchados = new Set<string>();
    for (const p of pools) {
      if (!casaAlvo(p, alvo)) continue;
      const apy = escolherApy(p);
      if (!apy) continue;
      achadas.push({
        slug: alvo.slug,
        poolId: String(p.pool ?? ""),
        projeto: String(p.project ?? ""),
        cadeia: String(p.chain ?? ""),
        simbolo: String(p.symbol ?? ""),
        tvlUsd: Number(p.tvlUsd ?? 0),
        apyPct: apy.apyPct,
        apyDe: apy.apyDe,
        apyRecompensaPct: typeof p.apyReward === "number" ? p.apyReward : null,
      });
      projetosAchados.add(String(p.project ?? "").toLowerCase());
      const c = CADEIA_LLAMA[String(p.chain ?? "")];
      if (c) cadeiasUsadas.add(c);
    }
    achadas.sort((a, b) => b.tvlUsd - a.tvlUsd);
    porSlug.set(alvo.slug, achadas);
    /**
     * ⚠️ O QUE A LISTA NÃO ACHOU VAI PARA A TELA. Projeto declarado que some da
     * fonte pode ter mudado de slug, ter sido despriorizado ou ter quebrado —
     * as três coisas mudam a leitura, e nenhuma delas aparece num agregado.
     */
    naoAchados.set(alvo.slug, alvo.projetos.filter((x) => !projetosAchados.has(x)));
  }

  // ── 3. O custo, MEDIDO, nas cadeias que as piscinas realmente usam.
  const faixasBase = [...FAIXAS_PADRAO];
  const capitais = ALVOS.map((a) => BY_SLUG.get(a.slug)?.capitalRequiredUsd ?? 1000);
  const faixas = [...new Set([...faixasBase, ...capitais])].sort((a, b) => a - b);

  /**
   * ⚠️ AS CADEIAS EM PARALELO, e isto é correção de defeito, não otimização.
   *
   * Sequencial eram até 7 cadeias × 4 faixas = 28 cotações em fila, a ~1,5s
   * cada: 42 segundos, dentro de uma função de 60 que ainda precisa gravar
   * quatro rodadas. O `deadline` cortaria no meio e devolveria uma tabela
   * PARCIAL — que é a janela curta silenciosa do funding reencarnada em outra
   * rota, três dias depois de eu a consertar.
   *
   * As faixas seguem sequenciais dentro de cada cadeia, para não bater na LI.FI
   * com 28 pedidos no mesmo instante.
   */
  const medidas = await Promise.all(
    [...cadeiasUsadas].map((c) => medirCadeia(c, faixas, deadline)),
  );
  const custos = new Map<ChainId, CustoCadeia>(medidas.map((m) => [m.cadeia, m]));

  /**
   * ⚠️ A CADEIA MAIS BARATA NAQUELA FAIXA, não a da maior piscina (06/08).
   *
   * A primeira versão usava a cadeia da piscina com mais depósito — que para o
   * empréstimo de stablecoin é a Ethereum, a mais cara que existe. O efeito
   * seria o C1 aparecer NEGATIVO em $500 e a fase concluir "não serve para o
   * peixe pequeno", quando a resposta verdadeira é "serve, na Base".
   *
   * Seria matar um produto bom com uma escolha de roteamento que nem é a que
   * faríamos — e "provavelmente já matamos ideias boas assim" é literalmente o
   * que a auditoria de 05/08 escreveu sobre o capital fixo das mesas antigas.
   *
   * A cadeia escolhida vai NA LINHA, porque "líquido de +4,1%" sem dizer onde
   * não é acionável.
   */
  function cadeiasDe(ps: PiscinaMedida[]): ChainId[] {
    const out = new Set<ChainId>();
    for (const p of ps) {
      const c = CADEIA_LLAMA[p.cadeia];
      if (c && custos.has(c)) out.add(c);
    }
    return [...out];
  }

  // ── 4. A conta, faixa por faixa.
  const linhas: LinhaEstrategia[] = [];
  for (const alvo of ALVOS) {
    const ps = porSlug.get(alvo.slug) ?? [];
    const reg = BY_SLUG.get(alvo.slug);
    const capital = reg?.capitalRequiredUsd ?? 1000;
    const apyMediano = ps.length ? median(ps.map((p) => p.apyPct)) : null;
    const candidatas = cadeiasDe(ps);

    const linhasFaixa = faixas.map((f) => {
      // A mais barata NAQUELA faixa — o gás fixo e o impacto proporcional
      // trocam de importância conforme o capital, então a resposta muda de
      // cadeia entre $500 e $50.000. É esse o produto.
      let melhor: { cadeia: ChainId; c: ReturnType<typeof custoDaFaixa> } | null = null;
      for (const cad of candidatas) {
        const custo = custos.get(cad);
        if (!custo) continue;
        const trocaUnit = alvo.precisaTroca ? custo.trocaPctPorFaixa.get(f) : 0;
        if (trocaUnit == null) continue;
        const c = custoDaFaixa(f, trocaUnit, custo.usdPorGas * alvo.gasUnidadesExtras);
        if (!melhor || c.idaEVoltaPct < melhor.c.idaEVoltaPct) melhor = { cadeia: cad, c };
      }
      if (!melhor) {
        return {
          faixaUsd: f, trocaPct: 0, gasPct: 0, idaEVoltaPct: 0, cadeia: null,
          precoIncoerente: false,
          apyBrutoPct: apyMediano, liquido1oAnoPct: null, equilibrioDias: null,
        };
      }
      const { cadeia, c } = melhor;
      return {
        ...c,
        cadeia,
        apyBrutoPct: apyMediano,
        liquido1oAnoPct: apyMediano == null ? null : liquidoPrimeiroAnoPct(apyMediano, c.idaEVoltaPct),
        equilibrioDias: apyMediano == null ? null : equilibrioDias(apyMediano, c.idaEVoltaPct),
      };
    });

    const naDeclarada = linhasFaixa.find((l) => l.faixaUsd === capital)?.liquido1oAnoPct ?? null;

    /**
     * ⚠️ AS DUAS RESSALVAS QUE REPROVAM A LEITURA (06/08).
     *
     * `precoIncoerente`: alguma faixa devolveu custo NEGATIVO — impossível, e
     * achatar em zero infla o líquido. `gasLido`: as cotações desta estratégia
     * trouxeram `gasCosts`? Sem isso "gás barato" e "gás não lido" dão a mesma
     * tela. Ver as notas em `CustoCadeia` e em `vereditoRendimento`.
     */
    const precoIncoerente = linhasFaixa.some((l) => l.precoIncoerente);
    const usadas = [...new Set(linhasFaixa.map((l) => l.cadeia).filter(Boolean))] as ChainId[];
    const gasLido = usadas.length === 0
      ? undefined
      : usadas.every((c) => (custos.get(c)?.cotacoesComGas ?? 0) > 0);
    linhas.push({
      slug: alvo.slug,
      nome: reg?.name ?? alvo.slug,
      capitalUsd: capital,
      piscinas: ps,
      produtos: produtosDistintos(ps).length,
      naoEncontrados: naoAchados.get(alvo.slug) ?? [],
      faixas: linhasFaixa,
      apyBrutoMedianoPct: apyMediano,
      liquidoNaFaixaDeclaradaPct: naDeclarada,
      precoIncoerente,
      gasLido: gasLido ?? null,
      veredito: vereditoRendimento(ps, naDeclarada, capital, { precoIncoerente, gasLido }),
    });
  }

  const naoMedido = [
    "risco de contrato — auditoria, tempo em pé e concentração de custódia",
    "despegue do ativo: USDM, USDY e stETH já negociaram abaixo da paridade",
    "corte no staking e no restaking — o C4 empilha uma camada a mais",
    "imposto, que é o maior custo isolado para o peixe pequeno em quase toda jurisdição",
    "fila de saque: stETH e Tesouro tokenizado resgatam com prazo, e prazo é custo",
    "\u26a0\ufe0f o custo de TROCA \u00e9 cotado contra o token nativo, o par mais l\u00edquido da "
      + "cadeia \u2014 entrar em USDY, USDM ou weETH custa MAIS que isso. Ent\u00e3o o l\u00edquido "
      + "das tr\u00eas estrat\u00e9gias que exigem troca \u00e9 TETO, n\u00e3o medi\u00e7\u00e3o",
  ];

  // ── 5. Uma rodada por estratégia. Sem mistura, como o dono mandou.
  if (db) {
    for (const l of linhas) {
      let runId: string | null = null;
      try {
        runId = await startRun(db, {
          slug: l.slug,
          capitalUsd: l.capitalUsd,
          // Rendimento é contínuo: a janela é o ano que a conta projeta.
          windowDays: 365,
          params: {
            fonte: hostUsado, faixas,
            piscinas: l.piscinas.length, produtos: l.produtos,
            precoIncoerente: l.precoIncoerente, gasLido: l.gasLido,
            naoEncontrados: l.naoEncontrados,
          },
        });
        await finishRun(db, runId, {
          netAnnualizedPct: l.liquidoNaFaixaDeclaradaPct,
          grossPct: l.apyBrutoMedianoPct,
          costPct: l.faixas.find((f) => f.faixaUsd === l.capitalUsd)?.idaEVoltaPct ?? null,
          /**
           * ⚠️ A AMOSTRA É DE PRODUTOS, NÃO DE IMPLANTAÇÕES (06/08).
           *
           * A rodada de 06/08 gravou `sample_n = 12` no Tesouro tokenizado.
           * Eram BUIDL contado seis vezes, em seis cadeias, com o mesmo 3,5%:
           * cinco produtos apresentados como doze observações. Ver
           * `produtosDistintos`.
           */
          sampleN: l.produtos,
          verdict: l.veredito.status,
          verdictText: l.veredito.verdict,
          perSymbol: [
            ...l.faixas.map((f) => ({
              tipo: "faixa", usd: f.faixaUsd, cadeia: f.cadeia,
              custo: f.idaEVoltaPct, liqAno: f.liquido1oAnoPct, equilibrio: f.equilibrioDias,
            })),
            ...l.piscinas.slice(0, 20).map((p) => ({
              tipo: "piscina", projeto: p.projeto, cadeia: p.cadeia, simbolo: p.simbolo,
              apy: Math.round(p.apyPct * 100) / 100, de: p.apyDe,
              tvl: Math.round(p.tvlUsd), recompensa: p.apyRecompensaPct,
            })),
          ],
          notMeasured: [
            ...naoMedido,
            ...(l.precoIncoerente
              ? ["⚠️ a cotação devolveu custo NEGATIVO em alguma faixa — os preços dos "
                 + "dois lados da troca discordam na fonte; o custo foi achatado em zero"]
              : []),
            ...(l.gasLido === false
              ? ["⚠️ a cotação NÃO trouxe custo de gás — o que está na tabela é impacto e "
                 + "taxa, sem gás"]
              : []),
            ...(l.piscinas.length !== l.produtos
              ? [`${l.piscinas.length} implantações correspondem a ${l.produtos} produtos `
                 + "distintos — o mesmo emissor em várias cadeias tem UMA taxa"]
              : []),
            ...(l.naoEncontrados.length
              ? [`⚠️ projetos declarados NÃO encontrados na fonte: ${l.naoEncontrados.join(", ")}`]
              : []),
          ],
        }, Date.now() - t0);
      } catch (e) {
        if (runId) {
          try {
            await failRun(db, runId, "falha ao gravar a medição", String(e).slice(0, 200), Date.now() - t0);
          } catch { /* o laboratório é registro, não pré-requisito da medição */ }
        }
      }
    }
  }

  await recordEvent("rendimento_study", { meta: {
    fonte: hostUsado, falhasPorHost: falhasTexto || null,
    piscinasLidas: pools.length, faixas,
    cadeiasMedidas: [...custos.keys()],
    cadeiasComFalha: [...custos.values()].filter((c) => c.falha).map((c) => `${c.cadeia}:${c.falha}`),
    linhas: linhas.map((l) => ({
      slug: l.slug, piscinas: l.piscinas.length, produtos: l.produtos,
      capital: l.capitalUsd,
      bruto: l.apyBrutoMedianoPct, liq: l.liquidoNaFaixaDeclaradaPct,
      precoIncoerente: l.precoIncoerente, gasLido: l.gasLido,
      status: l.veredito.status, naoEncontrados: l.naoEncontrados,
    })),
    tookMs: Date.now() - t0,
  } });

  return NextResponse.json({
    fonte: hostUsado,
    falhasPorHost: falhasTexto || null,
    piscinasLidas: pools.length,
    faixas,
    cadeias: [...custos.values()].map((c) => ({
      cadeia: c.cadeia,
      usdPorGas: c.usdPorGas,
      faixasMedidas: c.trocaPctPorFaixa.size,
      cotacoes: c.cotacoes,
      cotacoesComGas: c.cotacoesComGas,
      falha: c.falha ?? null,
    })),
    linhas,
    naoMedido,
    aviso: "Leitura pura: não abre posição, não escreve em admin_kv, não altera mesa nenhuma. "
      + "LÍQUIDO 1º ANO desconta uma ida e volta; no 2º ano a entrada já foi paga.",
    tookMs: Date.now() - t0,
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
