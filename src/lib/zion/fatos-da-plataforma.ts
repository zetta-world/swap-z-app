/**
 * OS FATOS OFICIAIS DA PLATAFORMA PARA O ZION (RM-09, audit remediation) — DERIVADOS, nunca digitados.
 *
 * ⚠️⚠️ O ACHADO: no modo `ask` o ZION não recebia fato nenhum da plataforma. Perguntado sobre redes,
 * taxas, planos ou Founders, respondia de memória — e "a resposta institucional pode errar taxa ou
 * plano" (CE-08a, aberto no round de custo).
 *
 * ⚠️⚠️ NÃO É UMA SEGUNDA FONTE DE VERDADE. Cada linha do bloco sai de uma constante que o PRODUTO já
 * usa para cobrar, limitar ou exibir:
 *   · redes ............ `chains.ts` (`CHAINS`, `comingSoon`)
 *   · taxas ............ `tier/fees.ts` (`TIER_FEE_BPS`, `CONTA_TAXA_SOLANA`, `MOTIVOS_SOLANA_SEM_TAXA`)
 *   · planos ........... `tier/types.ts` (`TIER_DAILY_ANALYSES`, `BANCADA_COTAS`, `FEATURE_TIER`)
 *   · preço mensal ..... `pricing/plans.ts` (`normalMonthlyUsd` — o que `/pricing` mostra)
 *   · preço Founders ... `pricing/plans.ts` (`precoPublicoUsd` — `null` enquanto PROVISÓRIO)
 *   · Founders ......... `founders-sale/config.ts` (`CONFIG_APROVADA`) + `beneficios.ts`
 *   · orçamento ........ `bancada/cotas.ts` (`orcamentoDiarioDeUnidades`)
 * Se o produto mudar, o bloco muda junto. Os testes (`fatos-da-plataforma.test.ts`) amarram cada fato à
 * constante e cada item do gabarito de qualidade (`regressao-qualidade.ts`) ao bloco.
 *
 * ⚠️ A VITRINE MANDA. O preço do passe Founders é PROVISÓRIO (OD-NFT-02) e NENHUMA superfície pública
 * o mostra — `/pricing` diz "preço em definição". O ZION fala com o cliente, então é superfície
 * pública: o bloco diz "em definição" e PROÍBE citar números, exatamente como a página.
 *
 * ⚠️ CUSTO: o bloco entra só no modo `ask` (pergunta livre), DEPOIS da fundação e ANTES do modo — ele
 * é estável entre chamadas, então fica no prefixo cacheável. Tamanho medido no teste.
 */
import { CHAINS } from "@/lib/chains";
import { TIER_FEE_BPS, CONTA_TAXA_SOLANA, MOTIVOS_SOLANA_SEM_TAXA } from "@/lib/tier/fees";
import { ALL_TIERS, BANCADA_COTAS, FEATURE_TIER, TIER_DAILY_ANALYSES, type Tier } from "@/lib/tier/types";
import { PLAN_TIERS, FOUNDERS_PRICE_STATUS, normalMonthlyUsd, precoPublicoUsd } from "@/lib/pricing/plans";
import { CONFIG_APROVADA } from "@/lib/founders-sale/config";
import { BENEFICIOS } from "@/lib/founders-sale/beneficios";
import { orcamentoDiarioDeUnidades } from "@/lib/bancada/cotas";
import type { ZionOp } from "@/lib/zion/mode-prompts";

const PAGOS = ["pro", "trader", "pilot"] as const;
const NOME: Record<Tier, string> = { free: "Free", pro: "Pro", trader: "Trader", pilot: "Pilot" };
const pct = (bps: number) => `${(bps / 100).toString()}%`;
const usd = (n: number) => `$${n % 1 === 0 ? n.toLocaleString("en-US") : n.toFixed(2)}`;

export interface FatosDaPlataforma {
  redes: { disponiveis: string[]; emBreve: string[] };
  taxas: { evm: Record<Tier, number>; solanaCobra: boolean; solanaMotivo: string };
  planos: Array<{
    tier: Tier; analisesZionPorDia: number; backtestsPor24h: number; ativosPorBacktest: number;
    historicoMaxDias: number; mesasDePapel: number; capitalMaxUsd: number; orcamentoDiarioUnidades: number;
    mensalUsd: number | null; suportePrioritario: boolean;
  }>;
  founders: {
    precoStatus: typeof FOUNDERS_PRICE_STATUS;
    /** `null` = a vitrine NÃO mostra o número (provisório). */
    precosPublicosUsd: Record<(typeof PAGOS)[number], number | null>;
    premiumMeses: number;
    premiumComecaEm: string;
    premiumSegueOHolder: true;
    janelaReiniciaNaTransferencia: false;
    royaltyParaHolders: boolean;
    disponiveis: Record<(typeof PAGOS)[number], string[]>;
    roadmap: string[];
    excluidos: string[];
    nftEPlanoMensalSeparados: boolean;
    dataDeLancamento: string | null;
  };
}

export function fatosDaPlataforma(): FatosDaPlataforma {
  const tierDaVenda = (t: (typeof PAGOS)[number]) => t.toUpperCase() as "PRO" | "TRADER" | "PILOT";
  return {
    redes: {
      disponiveis: CHAINS.filter((c) => !c.comingSoon).map((c) => `${c.name} (${c.short})`),
      emBreve: CHAINS.filter((c) => c.comingSoon).map((c) => c.name),
    },
    taxas: {
      evm: { ...TIER_FEE_BPS },
      solanaCobra: CONTA_TAXA_SOLANA != null,
      solanaMotivo: MOTIVOS_SOLANA_SEM_TAXA[0],
    },
    planos: ALL_TIERS.map((t) => {
      const c = BANCADA_COTAS[t];
      const plano = PLAN_TIERS.find((p) => p.tier === t);
      return {
        tier: t, analisesZionPorDia: TIER_DAILY_ANALYSES[t],
        backtestsPor24h: c.backtestsPorDia, ativosPorBacktest: c.simbolosPorTeste, historicoMaxDias: c.janelaMaxDias,
        mesasDePapel: c.mesasDePapel, capitalMaxUsd: c.capitalMaxUsd, orcamentoDiarioUnidades: orcamentoDiarioDeUnidades(t),
        mensalUsd: plano ? normalMonthlyUsd(plano) : null,
        suportePrioritario: ALL_TIERS.indexOf(t) >= ALL_TIERS.indexOf(FEATURE_TIER.prioritySupport),
      };
    }),
    founders: {
      precoStatus: FOUNDERS_PRICE_STATUS,
      precosPublicosUsd: Object.fromEntries(PAGOS.map((t) => [t, precoPublicoUsd(PLAN_TIERS.find((p) => p.tier === t)!)])) as FatosDaPlataforma["founders"]["precosPublicosUsd"],
      premiumMeses: CONFIG_APROVADA.premium.meses,
      premiumComecaEm: CONFIG_APROVADA.premium.inicio,
      // `premiumAtivo(cfg, enc, agora, detemPasse)`: depende de QUEM detém o passe, e a janela só do
      // encerramento oficial — o teste prova as duas coisas contra as funções.
      premiumSegueOHolder: true,
      janelaReiniciaNaTransferencia: false,
      royaltyParaHolders: CONFIG_APROVADA.royalty.distribuicaoAHolders,
      disponiveis: Object.fromEntries(PAGOS.map((t) => [t,
        BENEFICIOS.filter((b) => b.grupo === "A_DISPONIVEL" && b.tiers.includes(tierDaVenda(t))).map((b) => b.id)])) as FatosDaPlataforma["founders"]["disponiveis"],
      roadmap: BENEFICIOS.filter((b) => b.grupo === "B_ROADMAP").map((b) => b.id),
      excluidos: BENEFICIOS.filter((b) => b.grupo === "C_EXCLUIDO").map((b) => b.id),
      nftEPlanoMensalSeparados: CONFIG_APROVADA.relacaoPlanoMensal.estado === "CONFIGURADO"
        && CONFIG_APROVADA.relacaoPlanoMensal.valor.modelo === "PRODUTOS_COMERCIAIS_SEPARADOS",
      dataDeLancamento: CONFIG_APROVADA.dataLancamento.estado === "CONFIGURADO" ? String(CONFIG_APROVADA.dataLancamento.valor) : null,
    },
  };
}

/** O bloco de sistema que o ZION recebe. Inglês, como a fundação; o modelo responde no idioma do cliente. */
export function blocoDeFatos(f: FatosDaPlataforma = fatosDaPlataforma()): string {
  const precos = PAGOS.map((t) => f.founders.precosPublicosUsd[t]);
  const precoFinal = precos.every((p) => p != null);
  const l: string[] = [
    "═══════════════════════════════════════════════════════════════════════════════",
    "Z-SWAP PLATFORM FACTS — AUTHORITATIVE (derived from the product's own configuration)",
    "═══════════════════════════════════════════════════════════════════════════════",
    "Use ONLY these facts for questions about Z-SWAP itself (networks, fees, plans, limits, Founders, roadmap).",
    "Never contradict them. If something is not covered here, say you don't have that information — do not guess.",
    "",
    `NETWORKS AVAILABLE NOW (Z-SWAP supports these today): ${f.redes.disponiveis.join(", ")}.`,
    `COMING SOON (NOT available yet — never say it is live): ${f.redes.emBreve.join(", ") || "none"}.`,
    "",
    `PLATFORM SWAP FEE on EVM networks, by plan: ${ALL_TIERS.map((t) => `${NOME[t]} ${pct(f.taxas.evm[t])}`).join(" · ")}.`,
    f.taxas.solanaCobra
      ? "Solana: the plan fee applies."
      : `Solana: NO platform fee (owner decision; reason: ${f.taxas.solanaMotivo}). Network/gas costs are separate from the platform fee.`,
    "",
    "PLANS (ZION analyses per day · Workbench backtests per rolling 24h · assets per backtest · max history · paper desks · max capital):",
    ...f.planos.map((p) =>
      `  ${NOME[p.tier]}: ${p.analisesZionPorDia} ZION analyses/day · ${p.backtestsPor24h.toLocaleString("en-US")} backtests/24h · `
      + `${p.ativosPorBacktest} assets · ${p.historicoMaxDias} days · ${p.mesasDePapel} paper desks · ${usd(p.capitalMaxUsd)}`
      + (p.mensalUsd != null ? ` · monthly plan ${usd(p.mensalUsd)}/month` : "")
      + (p.suportePrioritario ? " · priority support" : "")),
    `WORKBENCH LIMITS ARE TWO, BOTH REAL: the backtest COUNT per rolling 24h above, AND a daily DATA budget measured in candles read `
      + `(${f.planos.filter((p) => p.tier !== "free").map((p) => `${NOME[p.tier]} ${p.orcamentoDiarioUnidades.toLocaleString("en-US")}`).join(" · ")}). `
      + `Bigger backtests (more assets, longer history, smaller candles; desk mode reads 1h+4h+1d and counts double) use more of the budget, `
      + `so the full count is reachable only with lighter backtests. Always state both limits together; the count alone is not the whole rule.`,
    "",
    "FOUNDERS PASS (NFT):",
    precoFinal
      ? `  Price: ${PAGOS.map((t, i) => `${NOME[t]} ${usd(precos[i]!)}`).join(" · ")}.`
      : "  Price: NOT FINAL — still being defined. Do NOT quote any price number for the pass; say the price is being defined and will be published on the pricing page.",
    `  Premium: ${f.founders.premiumMeses} months, counted from the OFFICIAL END OF THE SALE (not from the purchase). Not lifetime.`,
    "  Transfer: the pass is a standard NFT that can be transferred or sold; premium and Founder status follow the CURRENT holder; "
      + "transferring does NOT restart or extend the premium window. Resale and resale price are not guaranteed.",
    `  Royalties on secondary sales go to the Z-SWAP treasury${f.founders.royaltyParaHolders ? " and are shared with holders" : " and are NOT distributed to holders"}.`,
    `  Available at launch — Pro: ${f.founders.disponiveis.pro.join(", ")}; Trader: ${f.founders.disponiveis.trader.join(", ")}; Pilot: ${f.founders.disponiveis.pilot.join(", ")}.`,
    `  Roadmap (planned, NO date — never present as available): ${f.founders.roadmap.join(", ")}.`,
    `  Never promised: ${f.founders.excluidos.join(", ")}.`,
    f.founders.nftEPlanoMensalSeparados ? "  The Founders pass and the monthly plans are separate products; monthly plans are open to non-holders." : "",
    `  Sale date: ${f.founders.dataDeLancamento ?? "not announced yet"}.`,
    "",
    "ZION gives analysis only: it never moves funds by itself and never holds private keys — every transaction is signed in the user's own wallet. Profit is never guaranteed.",
  ];
  return l.filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");
}

/**
 * Os blocos de sistema do ZION, na ordem do mais estável ao mais variável (cache de prefixo).
 * ⚠️ RM-09: os FATOS entram no modo `ask` — a pergunta livre é onde o cliente pergunta "quanto custa",
 * "funciona na Solana", "quantos backtests". Os modos de análise têm os próprios dados no `<data>`.
 */
export function blocosDoSistema(op: ZionOp, fundacao: string, modo: string, idioma: string): string[] {
  return op === "ask" ? [fundacao, blocoDeFatos(), modo, idioma] : [fundacao, modo, idioma];
}
