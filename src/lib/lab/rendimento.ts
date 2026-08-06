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
  /**
   * ⚠️ A COTAÇÃO DEVOLVEU CUSTO NEGATIVO — entrar e sair PAGANDO você.
   *
   * Isso é impossível, e na rodada de 06/08 aconteceu: o restaking fechou com
   * custo −0,40% em todas as cinco faixas, líquido (2,89%) MAIOR que o bruto
   * (2,49%) e equilíbrio de −58 dias. A causa é o `priceUSD` dos dois lados da
   * troca discordarem ~0,4% na fonte; a troca aparece como ganho.
   *
   * O custo é achatado em zero para a conta não ficar impossível, MAS a
   * bandeira sobe — porque zero também é mentira, e um custo que não sabemos
   * medir tem que reprovar a leitura, não enfeitá-la. É a mesma regra do
   * `inconclusivo ≠ aprovado`.
   */
  precoIncoerente: boolean;
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
  const precoIncoerente = trocaPctUnitario < 0;
  const trocaPct = Math.max(0, trocaPctUnitario) * 2;
  const gasPct = faixaUsd > 0 ? Math.max(0, gasUsdUnitario / faixaUsd) * 100 : 0;
  return {
    faixaUsd,
    trocaPct: Number(trocaPct.toFixed(4)),
    gasPct: Number(gasPct.toFixed(4)),
    idaEVoltaPct: Number((trocaPct + gasPct).toFixed(4)),
    precoIncoerente,
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
  /**
   * ⚠️ O LÍQUIDO NUNCA PODE PASSAR DO BRUTO. Custo negativo já é achatado em
   * `custoDaFaixa`, mas a trava fica aqui também de propósito: esta função é
   * chamada de fora e a invariante é dela, não de quem a chama. Na rodada de
   * 06/08 o restaking passou VERDE com líquido acima do bruto porque ninguém
   * afirmava isso em lugar nenhum.
   */
  return Number((apyPct - Math.max(0, idaEVoltaPct)).toFixed(4));
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
  /**
   * ⚠️ CUSTO NEGATIVO TAMBÉM NÃO TEM EQUILÍBRIO. Sem esta linha a rodada de
   * 06/08 imprimiu "equilíbrio −58 dias" — uma frase sem significado que
   * ninguém questiona porque tem número e unidade.
   */
  if (idaEVoltaPct < 0) return null;
  return Number(((idaEVoltaPct / apyPct) * 365).toFixed(1));
}

// ─── Veredito ───────────────────────────────────────────────────────────

export interface VereditoRendimento {
  readable: boolean;
  verdict: string;
  status: "verde" | "cinza" | "morta";
}

/**
 * ⚠️⚠️ O MESMO PRODUTO EM N CADEIAS NÃO É N OBSERVAÇÕES (06/08).
 *
 * A rodada de 06/08 anunciou "12 piscinas" no Tesouro tokenizado. Eram
 * BUIDL contado SEIS vezes — Ethereum ×2, Polygon, Solana, Avalanche,
 * Arbitrum — todas com o mesmo 3,5%. São ~5 produtos, não 12.
 *
 * No restaking foi pior: 3 piscinas, das quais duas eram o MESMO
 * `ether.fi-stake` em duas cadeias com APY idêntico. Duas taxas distintas
 * passando por um piso de três.
 *
 * É a lição do ρ do funding reaparecendo com outra roupa: lá 50 símbolos
 * valiam 11,7 apostas independentes porque o funding é variável de
 * posicionamento; aqui o mesmo emissor implantado em seis cadeias tem UMA taxa,
 * definida pelo título que ele guarda, não pela cadeia onde o token mora.
 *
 * Um produto = emissor + ativo. Dentro dele fica a piscina de MAIOR depósito,
 * porque é onde o capital de verdade está.
 */
export function produtosDistintos(piscinas: PiscinaMedida[]): PiscinaMedida[] {
  const porProduto = new Map<string, PiscinaMedida>();
  for (const p of piscinas) {
    const chave = `${p.projeto.toLowerCase()}|${p.simbolo.toUpperCase()}`;
    const atual = porProduto.get(chave);
    if (!atual || p.tvlUsd > atual.tvlUsd) porProduto.set(chave, p);
  }
  return [...porProduto.values()].sort((a, b) => b.tvlUsd - a.tvlUsd);
}

/**
 * ⚠️ O PISO É DE PRODUTOS, NÃO DE PISCINAS — a mesma trava do `MIN_ROBUSTOS`.
 *
 * Um produto só não é uma estratégia: é a taxa de um emissor num dia. E contar
 * implantações em vez de emissores derrota o piso sozinho — ver
 * `produtosDistintos`.
 */
export const MIN_PRODUTOS = 3;

export interface RessalvasRendimento {
  /** Alguma faixa devolveu custo negativo? Ver `CustoFaixa.precoIncoerente`. */
  precoIncoerente?: boolean;
  /**
   * A cotação trouxe `gasCosts`? Quando não traz, o gás vira ZERO em silêncio —
   * e "gás barato" fica idêntico a "gás não lido". Ver a nota na rota.
   */
  gasLido?: boolean;
}

export function vereditoRendimento(
  piscinas: PiscinaMedida[],
  liquidoNaFaixaDeclaradaPct: number | null,
  faixaDeclaradaUsd: number,
  ressalvas: RessalvasRendimento = {},
  minProdutos = MIN_PRODUTOS,
): VereditoRendimento {
  const produtos = produtosDistintos(piscinas);
  const n = produtos.length;
  const quantos = `${n} produto${n === 1 ? "" : "s"}`
    + (piscinas.length !== n ? ` (${piscinas.length} implantações)` : "");

  if (n === 0) {
    return {
      readable: false, status: "cinza",
      verdict: "nenhuma piscina declarada foi encontrada na fonte — inconclusivo, "
        + "que não é o mesmo que reprovado. Ver a lista de não encontradas.",
    };
  }
  if (n < minProdutos) {
    return {
      readable: false, status: "cinza",
      verdict: `só ${quantos} distinto(s), abaixo do piso de ${minProdutos} — é a taxa `
        + "de um emissor num dia, não uma estratégia. O mesmo emissor em várias cadeias "
        + "tem UMA taxa, não várias. INCONCLUSIVO.",
    };
  }
  if (liquidoNaFaixaDeclaradaPct == null) {
    return {
      readable: false, status: "cinza",
      verdict: `${quantos}, mas o custo de entrada não foi medido — sem ele o rendimento `
        + "bruto não vira veredito.",
    };
  }

  /**
   * ⚠️ `median` DE `stats.ts`, NÃO UM ÍNDICE DO MEIO ESCRITO AQUI.
   *
   * Eu escrevi `s[Math.floor(n/2)]` na primeira versão deste arquivo — a mesma
   * linha que causou a discordância de onze pontos entre duas rotas e que fez
   * `stats.ts` existir. Com `n` par ela devolve o superior do meio, e o erro
   * tem SINAL: sempre para cima, sempre a favor do número bonito.
   *
   * ⚠️ E ELA CORRE SOBRE PRODUTOS, não piscinas: com BUIDL repetido seis vezes,
   * a mediana de "12 piscinas" é a taxa da BlackRock com seis votos.
   */
  const bruto = median(produtos.map((p) => p.apyPct)) ?? 0;
  const semMedia = produtos.filter((p) => p.apyDe !== "media30d").length;
  const ressalva = semMedia > 0
    ? ` ⚠️ ${semMedia} de ${n} sem média de 30 dias — APY à vista`
    : "";

  /**
   * ⚠️ CUSTO QUE NÃO SABEMOS MEDIR REPROVA A LEITURA — não a enfeita.
   *
   * Custo negativo é impossível e foi achatado em zero. Zero também é mentira,
   * e ele empurra o líquido PARA CIMA: seria o número bonito nascendo de uma
   * falha de medição. Vira inconclusivo, como a amostra curta.
   */
  if (ressalvas.precoIncoerente) {
    return {
      readable: false, status: "cinza",
      verdict: `${quantos}, mediana bruta ${bruto.toFixed(2)}%/ano — mas a cotação devolveu `
        + "custo NEGATIVO em pelo menos uma faixa, o que é impossível: os dois lados da "
        + "troca têm preços que discordam na fonte. O custo foi achatado em zero e por "
        + `isso o líquido está inflado. INCONCLUSIVO até a cotação fechar.${ressalva}`,
    };
  }
  if (ressalvas.gasLido === false) {
    return {
      readable: false, status: "cinza",
      verdict: `${quantos}, mediana bruta ${bruto.toFixed(2)}%/ano — mas a cotação não trouxe `
        + "custo de gás, então o que está na tabela é impacto e taxa SEM gás. 'Gás barato' e "
        + `'gás não lido' dariam a mesma tela; este veredito existe para não darem.${ressalva}`,
    };
  }

  if (liquidoNaFaixaDeclaradaPct <= 0) {
    return {
      readable: true, status: "morta",
      verdict: `${quantos}, mediana bruta ${bruto.toFixed(2)}%/ano, e mesmo `
        + `assim o 1º ano fecha em ${liquidoNaFaixaDeclaradaPct.toFixed(2)}% com $${faixaDeclaradaUsd.toLocaleString("pt-BR")} `
        + `— a entrada come tudo nessa faixa.${ressalva}`,
    };
  }
  return {
    readable: true, status: "verde",
    verdict: `${quantos}, mediana bruta ${bruto.toFixed(2)}%/ano · líquido do `
      + `1º ano ${liquidoNaFaixaDeclaradaPct.toFixed(2)}% com $${faixaDeclaradaUsd.toLocaleString("pt-BR")} `
      + `depois de entrar e sair.${ressalva}`,
  };
}
