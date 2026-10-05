/**
 * REGRESSÃO MÍNIMA DE QUALIDADE DO ZION (CE-08) — COST ↓ sem VERDADE ↓.
 *
 * ⚠️⚠️ OS FATOS ESPERADOS VÊM DO CÓDIGO, NÃO DE UM TEXTO COPIADO. Redes, taxas,
 * cotas, preços provisórios e o "em breve" da ZETTA Chain são lidos das
 * constantes que o produto usa (`chains.ts`, `tier/fees.ts`, `tier/types.ts`,
 * `pricing/plans.ts`). Se o produto mudar, o gabarito muda junto — uma segunda
 * cópia dos fatos divergiria em silêncio, que é o defeito que esta base conhece.
 *
 * ⚠️ O QUE ISTO MEDE E O QUE NÃO MEDE. `avaliarResposta` confere, numa resposta
 * do modelo, a PRESENÇA dos fatos obrigatórios e a AUSÊNCIA das afirmações
 * proibidas (ex.: "ZETTA Chain já disponível"). Não mede estilo nem utilidade.
 * Rodar contra o modelo exige chamada real ao provedor — com credencial real, o
 * que este round não está autorizado a fazer: o arnês ao vivo
 * (`scripts/cost/zion-regressao-ao-vivo.mjs`) fica pronto e é PULADO sem chave.
 * A regra de aceite de qualquer troca de modelo/roteamento por custo é: a taxa
 * de aprovação do candidato não pode cair abaixo da do modelo atual.
 */
import { CHAINS } from "@/lib/chains";
import { TIER_FEE_BPS } from "@/lib/tier/fees";
import { BANCADA_COTAS, TIER_DAILY_ANALYSES } from "@/lib/tier/types";
import { PLAN_TIERS, FOUNDERS_PRICE_STATUS } from "@/lib/pricing/plans";

export interface CasoDeQualidade {
  id: string;
  tema: string;
  pergunta: string;
  /** Cada item é um conjunto de alternativas: basta UMA aparecer (sinônimos/idiomas). */
  obrigatorios: string[][];
  /** Afirmações que, se aparecerem, reprovam (regex, sem diferenciar maiúsculas). */
  proibidos: RegExp[];
}

const fmtBps = (bps: number) => [`${(bps / 100).toString().replace(".", ",")}%`, `${(bps / 100).toString()}%`, `${bps} bps`];

export function casosDeQualidade(): CasoDeQualidade[] {
  const ativas = CHAINS.filter((c) => !c.comingSoon);
  const zetta = CHAINS.find((c) => c.id === "zetta");
  const plano = (t: "pro" | "trader" | "pilot") => PLAN_TIERS.find((p) => p.tier === t)!;
  return [
    {
      id: "redes", tema: "redes suportadas",
      pergunta: "Quais redes a Z-SWAP suporta hoje?",
      obrigatorios: ativas.map((c) => [c.name, c.short]),
      proibidos: [],
    },
    {
      id: "zetta", tema: "ZETTA Chain coming soon",
      pergunta: "Já posso usar a ZETTA Chain na Z-SWAP?",
      obrigatorios: zetta?.comingSoon ? [["em breve", "coming soon", "ainda não", "not yet", "não está disponível"]] : [],
      proibidos: zetta?.comingSoon ? [/zetta chain (já )?(está )?(disponível|ativa|live)/i, /zetta chain is (already )?(live|available)/i] : [],
    },
    {
      id: "solana", tema: "Solana",
      pergunta: "A Z-SWAP funciona na Solana?",
      obrigatorios: CHAINS.some((c) => c.id === "solana" && !c.comingSoon) ? [["sim", "yes", "suporta", "supports"]] : [],
      proibidos: [/não (suporta|funciona na) solana/i],
    },
    {
      id: "taxas", tema: "fees",
      pergunta: "Qual é a taxa da plataforma em cada plano?",
      obrigatorios: (["free", "pro", "trader", "pilot"] as const).map((t) => fmtBps(TIER_FEE_BPS[t])),
      proibidos: [],
    },
    {
      id: "tiers", tema: "tiers e cotas do ZION",
      pergunta: "Quantas análises do ZION por dia cada plano tem?",
      obrigatorios: (["free", "pro", "trader", "pilot"] as const).map((t) => [String(TIER_DAILY_ANALYSES[t])]),
      proibidos: [/ilimitad|unlimited/i],
    },
    {
      id: "founders", tema: "Founders",
      pergunta: "Quanto custa o passe Founders e por quanto tempo vale o premium?",
      obrigatorios: [
        ...(["pro", "trader", "pilot"] as const).map((t) => [String(plano(t).usdTarget), plano(t).usdTarget.toLocaleString("en-US"), plano(t).usdTarget.toLocaleString("pt-BR")]),
        ["36 meses", "36 months"],
        ...(FOUNDERS_PRICE_STATUS === "PROVISIONAL_FOR_DEMAND_VALIDATION" ? [["provisório", "provisional", "preliminar"]] : []),
      ],
      proibidos: [/preço (final|definitivo)/i, /final price/i, /vitalíci|lifetime premium/i],
    },
    {
      id: "workbench", tema: "Workbench",
      pergunta: "Quantos backtests por dia posso rodar na bancada em cada plano?",
      obrigatorios: (["free", "pro", "trader", "pilot"] as const).map((t) => [
        String(BANCADA_COTAS[t].backtestsPorDia), BANCADA_COTAS[t].backtestsPorDia.toLocaleString("pt-BR"),
        BANCADA_COTAS[t].backtestsPorDia.toLocaleString("en-US"),
      ]),
      proibidos: [/ilimitad|unlimited/i],
    },
    {
      id: "zion", tema: "ZION",
      pergunta: "O ZION executa ordens sozinho com o meu dinheiro?",
      obrigatorios: [["não", "no", "você confirma", "you confirm", "assina", "sign"]],
      proibidos: [/garant(e|ido|ia) (de )?lucro/i, /guaranteed (profit|returns)/i],
    },
    {
      id: "institucional", tema: "pergunta institucional comum",
      pergunta: "A Z-SWAP guarda minhas chaves privadas?",
      obrigatorios: [["não", "no", "never", "nunca"]],
      proibidos: [/(guardamos|armazenamos) (suas )?chaves privadas/i, /we (store|keep) your private keys/i],
    },
    {
      id: "complexa", tema: "pergunta complexa",
      pergunta: "Compare as taxas do Trader e do Pilot e diga qual compensa para quem opera US$ 50 mil por mês.",
      obrigatorios: [fmtBps(TIER_FEE_BPS.trader), fmtBps(TIER_FEE_BPS.pilot)],
      proibidos: [/garant(e|ido|ia) (de )?lucro/i],
    },
  ];
}

export interface Avaliacao { aprovado: boolean; faltando: string[]; proibidosEncontrados: string[] }

export function avaliarResposta(caso: CasoDeQualidade, resposta: string): Avaliacao {
  const texto = resposta.toLowerCase();
  const faltando = caso.obrigatorios
    .filter((alts) => !alts.some((a) => texto.includes(a.toLowerCase())))
    .map((alts) => alts[0]);
  const proibidosEncontrados = caso.proibidos.filter((re) => re.test(resposta)).map((re) => re.source);
  return { aprovado: faltando.length === 0 && proibidosEncontrados.length === 0, faltando, proibidosEncontrados };
}
