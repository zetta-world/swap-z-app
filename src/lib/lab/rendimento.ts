/**
 * RENDIMENTO INTEGRADO — C1 a C4 do Mapa do Lucro.
 *
 * ⚠️ O QUE ESTA FASE MEDE, E POR QUE ELA NÃO É "LER O APY DA AAVE".
 *
 * Aave rende 3,5–9%, tesouro tokenizado 3,3–8%, staking líquido ~2,4%. Esses
 * números estão publicados e não precisam de nós. O que **ninguém publica** é
 * quanto sobra depois de entrar e sair — e a resposta muda de sinal conforme o
 * capital: um gás de $12 é 2,4% de $500 e 0,024% de $50.000.
 *
 * É a mesma variável que a auditoria de 05/08 achou faltando nas 23 mesas
 * antigas. Mesa sub-capitalizada não rende menos, rende NEGATIVO por custo
 * fixo, e o resultado é lido como "a estratégia não presta".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ A CONTA COMPARA UM ANO COM UM CUSTO PAGO UMA VEZ, DE PROPÓSITO.
 *
 * Foi o erro do `netPct` do funding, ao contrário: lá eu comparava um ganho
 * ACUMULADO NUMA JANELA CURTA com um custo de ida e volta, e o resultado dizia
 * "não paga" quando o que dizia era "a janela é curta". Aqui a janela é um ano
 * por definição, então a comparação é honesta — mas o rótulo tem que dizer
 * **1º ANO**, porque no segundo ano não há entrada para pagar de novo.
 *
 * Os dois números vão para a tela: o do primeiro ano (que é o que decide se
 * vale entrar) e o de regime (que é o que decide se vale ficar).
 */

import { median } from "@/lib/zion/stats";

/** As faixas fixas do critério do dono. A da estratégia entra junto na rota. */
export const FAIXAS_PADRAO = [500, 5_000, 50_000] as const;

/**
 * ⚠️ PISO DE TAMANHO DA PISCINA — palpite declarado, não medição.
 *
 * APY de piscina com $200 mil de depósito é ruído: uma tomada de empréstimo
 * grande move a taxa e ela volta em horas. Cinco milhões é o ponto em que a
 * taxa passa a refletir oferta e demanda de verdade. Não medi isso; declarei.
 */
export const TVL_MINIMO_USD = 5_000_000;

/**
 * ⚠️ UNIDADES DE GÁS — CONSTANTES DECLARADAS, e a tela diz isso.
 *
 * O PREÇO de cada unidade é MEDIDO (sai da cotação da LI.FI, que devolve o
 * custo em dólar e o número de unidades na mesma resposta). O que é constante
 * aqui é só QUANTAS unidades cada operação gasta, e esses valores vêm da faixa
 * típica publicada pelos próprios protocolos.
 *
 * Separar as duas coisas importa: se eu chutasse o preço do gás, estaria
 * inventando exatamente o número que esta fase existe para descobrir.
 */
export const GAS_UNIDADES = {
  /** Autorizar o contrato a gastar o token. Padrão ERC-20. */
  aprovar: 46_000,
  /** Depositar em mercado de empréstimo tipo Aave v3. */
  depositar: 250_000,
  /** Sacar do mercado de empréstimo. */
  sacar: 230_000,
} as const;

/** Uma piscina declarada — a lista passa por PR, não sai de ranking de APY. */
export interface AlvoPiscina {
  /** Slug da estratégia no laboratório. Uma estratégia, várias piscinas. */
  slug: string;
  /** Projetos aceitos, em slug da DefiLlama. Apelidos porque eles renomeiam. */
  projetos: string[];
  /** Símbolos aceitos, maiúsculo e exato. */
  simbolos: string[];
  /** Cadeias aceitas, no nome que a DefiLlama usa. */
  cadeias: string[];
  /**
   * Precisa TROCAR de ativo para entrar?
   *
   * C1 não: quem entra em empréstimo de stablecoin já tem stablecoin, e o
   * custo dele é só gás. Os outros três exigem sair de USDC e voltar, e aí o
   * impacto e a taxa da troca entram na conta — medidos, não estimados.
   */
  precisaTroca: boolean;
  /** Transações de gás além da troca (aprovar, depositar, sacar). */
  gasUnidadesExtras: number;
}

/**
 * ⚠️ LISTA DECLARADA, NUNCA "AS DE MAIOR APY".
 *
 * Ordenar por rendimento seleciona duas coisas ao mesmo tempo: token de
 * fazenda (APY alto pago em moeda que despenca) e sobrevivente (as que
 * quebraram não estão na lista para baixar a média). É viés de seleção com
 * cara de pesquisa.
 *
 * O que esta lista NÃO achar aparece na tela como não encontrado. Omissão que
 * só existe no comentário vira, semanas depois, um número lido como completo.
 */
export const ALVOS: AlvoPiscina[] = [
  {
    slug: "stablecoin_lending",
    projetos: ["aave-v3", "aave-v2", "compound-v3", "morpho-blue", "spark"],
    simbolos: ["USDC", "USDT", "DAI", "USDC.E"],
    cadeias: ["Ethereum", "Base", "Arbitrum", "Polygon", "Optimism", "Avalanche"],
    precisaTroca: false,
    gasUnidadesExtras: GAS_UNIDADES.aprovar + GAS_UNIDADES.depositar + GAS_UNIDADES.sacar,
  },
  {
    slug: "tokenized_treasury",
    projetos: [
      "ondo-finance", "ondo-yield-assets", "openeden-tbill", "openeden-usdo",
      "mountain-protocol", "superstate-ustb", "superstate", "hashnote-usyc",
      "blackrock-buidl", "franklin-templeton-benji", "usual",
    ],
    simbolos: ["USDY", "OUSG", "USDM", "TBILL", "USYC", "USTB", "BUIDL", "USD0", "USDO"],
    cadeias: ["Ethereum", "Base", "Arbitrum", "Polygon", "Optimism", "Avalanche", "Solana"],
    precisaTroca: true,
    gasUnidadesExtras: 0,
  },
  {
    slug: "liquid_staking",
    projetos: ["lido", "rocket-pool", "coinbase-wrapped-staked-eth", "frax-ether", "stakewise-v3"],
    simbolos: ["STETH", "WSTETH", "RETH", "CBETH", "SFRXETH"],
    cadeias: ["Ethereum", "Base", "Arbitrum", "Optimism"],
    precisaTroca: true,
    gasUnidadesExtras: 0,
  },
  {
    slug: "restaking",
    projetos: ["ether.fi-stake", "ether.fi", "renzo", "kelp-dao", "puffer-finance", "eigenlayer"],
    simbolos: ["WEETH", "EETH", "EZETH", "RSETH", "PUFETH"],
    cadeias: ["Ethereum", "Base", "Arbitrum"],
    precisaTroca: true,
    gasUnidadesExtras: 0,
  },
];

/** De onde saiu o APY que estamos usando. Vai para a tela, sempre. */
export type OrigemApy = "media30d" | "base" | "total";

export interface PiscinaMedida {
  slug: string;
  poolId: string;
  projeto: string;
  cadeia: string;
  simbolo: string;
  tvlUsd: number;
  /** O que julga. Ver `escolherApy`. */
  apyPct: number;
  apyDe: OrigemApy;
  /** Recompensa em token de incentivo, SEPARADA e nunca somada no titular. */
  apyRecompensaPct: number | null;
}

/**
 * ⚠️ QUAL APY USAR, e a ordem não é gosto.
 *
 * 1. `apyMean30d` — média de 30 dias. APY à vista de piscina de empréstimo
 *    dispara com uma alavancada grande e volta em horas; a média de 30 dias é
 *    a única das três que resiste a olhar num minuto ruim.
 * 2. `apyBase` — juros de verdade, sem incentivo.
 * 3. `apy` — total já somado pela fonte. Último recurso porque pode conter
 *    recompensa embutida, e recompensa não é a mesma coisa que juros.
 *
 * O que NÃO acontece: a ausência da média virar o à vista em silêncio. A
 * origem viaja junto com o número, e a tela mostra.
 */
export function escolherApy(p: {
  apyMean30d?: number | null; apyBase?: number | null; apy?: number | null;
}): { apyPct: number; apyDe: OrigemApy } | null {
  if (typeof p.apyMean30d === "number" && Number.isFinite(p.apyMean30d)) {
    return { apyPct: p.apyMean30d, apyDe: "media30d" };
  }
  if (typeof p.apyBase === "number" && Number.isFinite(p.apyBase)) {
    return { apyPct: p.apyBase, apyDe: "base" };
  }
  if (typeof p.apy === "number" && Number.isFinite(p.apy)) {
    return { apyPct: p.apy, apyDe: "total" };
  }
  return null;
}

/** Casa uma piscina crua com um alvo declarado. Tudo maiúsculo, tudo exato. */
export function casaAlvo(
  p: { project?: string; symbol?: string; chain?: string; tvlUsd?: number },
  alvo: AlvoPiscina,
): boolean {
  const proj = (p.project ?? "").toLowerCase();
  const sim = (p.symbol ?? "").toUpperCase();
  const cad = p.chain ?? "";
  if (!alvo.projetos.includes(proj)) return false;
  if (!alvo.simbolos.includes(sim)) return false;
  if (!alvo.cadeias.includes(cad)) return false;
  return (p.tvlUsd ?? 0) >= TVL_MINIMO_USD;
}

// ─── A conta ────────────────────────────────────────────────────────────

export interface CustoFaixa {
  faixaUsd: number;
  /** Impacto + taxa da troca, em % do capital. Zero quando não há troca. */
  trocaPct: number;
  /** Gás das transações extras, em % do capital. */
  gasPct: number;
  /** Ida e volta: entrar e sair. As duas pernas, como no funding. */
  idaEVoltaPct: number;
}

/**
 * O custo de entrar e sair numa faixa de capital.
 *
 * `trocaPctUnitario` é o custo percentual de UMA troca naquela faixa (medido
 * pela cotação); `gasUsdUnitario` é o custo em dólar do gás extra (preço
 * medido × unidades declaradas). A ida e volta cobra as duas pernas — é a
 * mesma convenção de 4 pernas do funding, para os dois números serem
 * comparáveis na mesma tabela.
 */
export function custoDaFaixa(
  faixaUsd: number, trocaPctUnitario: number, gasUsdUnitario: number,
): CustoFaixa {
  const trocaPct = trocaPctUnitario * 2;
  const gasPct = faixaUsd > 0 ? (gasUsdUnitario / faixaUsd) * 100 : 0;
  return {
    faixaUsd,
    trocaPct: Number(trocaPct.toFixed(4)),
    gasPct: Number(gasPct.toFixed(4)),
    idaEVoltaPct: Number((trocaPct + gasPct).toFixed(4)),
  };
}

/**
 * ⚠️ O NÚMERO QUE DECIDE SE VALE ENTRAR — e ele não é o APY.
 *
 * Um ano de rendimento menos UMA ida e volta. No segundo ano a entrada já foi
 * paga, então este número é pessimista de propósito para o primeiro ano e
 * otimista se alguém o ler como permanente. Por isso `apyPct` continua exposto
 * ao lado: um decide entrar, o outro decide ficar.
 */
export function liquidoPrimeiroAnoPct(apyPct: number, idaEVoltaPct: number): number {
  return Number((apyPct - idaEVoltaPct).toFixed(4));
}

/**
 * Dias só para pagar a ida e volta.
 *
 * Sem rendimento positivo NÃO existe ponto de equilíbrio: devolver um número
 * grande sugeriria "é só esperar mais", que é falso. Mesma regra do
 * `breakEvenDays` do funding.
 */
export function equilibrioDias(apyPct: number, idaEVoltaPct: number): number | null {
  if (apyPct <= 0) return null;
  return Number(((idaEVoltaPct / apyPct) * 365).toFixed(1));
}

// ─── Veredito ───────────────────────────────────────────────────────────

export interface VereditoRendimento {
  readable: boolean;
  verdict: string;
  status: "verde" | "cinza" | "morta";
}

/**
 * ⚠️ O PISO DE PISCINAS — a mesma trava do `MIN_ROBUSTOS` do funding.
 *
 * Uma piscina só não é uma estratégia: é uma taxa de um protocolo num dia. Se
 * a lista declarada achou uma, a resposta é INCONCLUSIVO — que não é
 * reprovado, e não é aprovado.
 */
export const MIN_PISCINAS = 3;

export function vereditoRendimento(
  piscinas: PiscinaMedida[],
  liquidoNaFaixaDeclaradaPct: number | null,
  faixaDeclaradaUsd: number,
  minPiscinas = MIN_PISCINAS,
): VereditoRendimento {
  if (piscinas.length === 0) {
    return {
      readable: false, status: "cinza",
      verdict: "nenhuma piscina declarada foi encontrada na fonte — inconclusivo, "
        + "que não é o mesmo que reprovado. Ver a lista de não encontradas.",
    };
  }
  if (piscinas.length < minPiscinas) {
    return {
      readable: false, status: "cinza",
      verdict: `só ${piscinas.length} piscina(s) encontrada(s), abaixo do piso de `
        + `${minPiscinas} — é a taxa de um protocolo num dia, não uma estratégia. `
        + "INCONCLUSIVO.",
    };
  }
  if (liquidoNaFaixaDeclaradaPct == null) {
    return {
      readable: false, status: "cinza",
      verdict: `${piscinas.length} piscinas encontradas, mas o custo de entrada não `
        + "foi medido — sem ele o rendimento bruto não vira veredito.",
    };
  }

  /**
   * ⚠️ `median` DE `stats.ts`, NÃO UM ÍNDICE DO MEIO ESCRITO AQUI.
   *
   * Eu escrevi `s[Math.floor(n/2)]` na primeira versão deste arquivo — a mesma
   * linha que causou a discordância de onze pontos entre duas rotas e que fez
   * `stats.ts` existir. Com `n` par ela devolve o superior do meio, e o erro
   * tem SINAL: sempre para cima, sempre a favor do número bonito.
   */
  const bruto = median(piscinas.map((p) => p.apyPct)) ?? 0;
  const semMedia = piscinas.filter((p) => p.apyDe !== "media30d").length;
  const ressalva = semMedia > 0
    ? ` ⚠️ ${semMedia} de ${piscinas.length} sem média de 30 dias — APY à vista`
    : "";

  if (liquidoNaFaixaDeclaradaPct <= 0) {
    return {
      readable: true, status: "morta",
      verdict: `${piscinas.length} piscinas, mediana bruta ${bruto.toFixed(2)}%/ano, e mesmo `
        + `assim o 1º ano fecha em ${liquidoNaFaixaDeclaradaPct.toFixed(2)}% com $${faixaDeclaradaUsd.toLocaleString("pt-BR")} `
        + `— a entrada come tudo nessa faixa.${ressalva}`,
    };
  }
  return {
    readable: true, status: "verde",
    verdict: `${piscinas.length} piscinas, mediana bruta ${bruto.toFixed(2)}%/ano · líquido do `
      + `1º ano ${liquidoNaFaixaDeclaradaPct.toFixed(2)}% com $${faixaDeclaradaUsd.toLocaleString("pt-BR")} `
      + `depois de entrar e sair.${ressalva}`,
  };
}
