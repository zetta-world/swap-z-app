/**
 * Membership tiers, ordered free → pilot. The numeric rank lets gates ask
 * "is this wallet at least `pro`?" without enumerating every higher tier.
 *
 * Tiers map 1:1 to the /pricing cards (FASE 5.1) and, once 5.4 ships, to the
 * NFT membership passes minted on Solana.
 */
export type Tier = "free" | "pro" | "trader" | "pilot";

export const TIER_RANK: Record<Tier, number> = {
  free:   0,
  pro:    1,
  trader: 2,
  pilot:  3,
};

export const ALL_TIERS: Tier[] = ["free", "pro", "trader", "pilot"];

export function isTier(v: unknown): v is Tier {
  return typeof v === "string" && v in TIER_RANK;
}

/** True when `have` satisfies a `required` gate (e.g. trader satisfies pro). */
export function tierSatisfies(have: Tier, required: Tier): boolean {
  return TIER_RANK[have] >= TIER_RANK[required];
}

/** Where a cached tier came from — purely informational for now. */
/**
 * De onde veio o tier.
 *
 * ⚠️ `sem_pass` e `nao_checado` são ESTADOS DIFERENTES, e separá-los foi o
 * conserto de 11/08: antes os dois viravam `"nft"`, e uma carteira EVM — cuja
 * checagem nem roda, porque os passes vivem na Solana — ficava registrada como
 * se tivesse sido olhada e não tivesse passe. Ver `0022_origem_do_tier_honesta`.
 */
export type TierSource =
  | "nft" | "subscription"
  /**
   * ⚠️⚠️ `"admin"` SIGNIFICA "ESTA CARTEIRA É UM ADMIN" — e é LEGADO.
   *
   * `src/lib/admin/require.ts` honra este valor como concessão de acesso ao
   * painel (a ponte para quem foi semeado antes de `platform_admins` existir).
   * Ele NÃO deve ser escrito por mais nada: conceder um PLANO com este valor
   * entregava o painel inteiro ao cliente — achado A04, 14/09, confirmado no
   * banco com três carteiras que tinham admin sem estar em `platform_admins`.
   */
  | "admin"
  /**
   * O plano que um admin concedeu pelo painel. Diz QUEM decidiu o plano, e
   * absolutamente nada sobre quem a carteira é.
   *
   * ⚠️ A distinção entre este valor e o de cima é a correção do A04. Eles
   * couberam na mesma palavra por meses, e a palavra era a que abria a porta.
   */
  | "concessao"
  /** A checagem RODOU e a carteira não tem passe. */
  | "sem_pass"
  /** A checagem NÃO rodou. Ausência de medição, não ausência de passe. */
  | "nao_checado";

export interface TierResult {
  tier:   Tier;
  /**
   * ⚠️ `"default"` SAIU DA UNIÃO (11/08). Ele existia porque a coluna do banco
   * não aceitava um quarto estado, e era ele que virava `"nft"` na gravação —
   * a mentira que fazia "carteira de outra cadeia" parecer "checamos e não
   * tem". Agora os dois estados reais têm nome: `sem_pass` e `nao_checado`.
   */
  source: TierSource;
  /** Epoch ms when this answer should be re-checked. */
  expiresAt: number;
}

/**
 * Feature → minimum tier matrix. The single source of truth for which gate a
 * surface sits behind. Keep keys stable; UI and API both read from here.
 */
export const FEATURE_TIER: Record<string, Tier> = {
  // ⚠ CORREÇÃO 01/08 — ESTAVA "pro", CONTRA A PRÓPRIA PÁGINA DE PREÇOS.
  //
  // O card do plano Free anuncia, em quatro idiomas, "5 / day (ZION)". A tabela
  // `TIER_DAILY_ANALYSES` concorda: `free: 5`. Mas o gate exigia "pro", então
  // com os gates ligados o usuário Free recebia 402 — ZERO análises, não cinco.
  //
  // Duas fontes diziam cinco, uma dizia nenhuma, e a que dizia nenhuma era a
  // que valia. Prometer na vitrine e negar na porta é o tipo de furo que não
  // aparece em teste nenhum porque cada lado, sozinho, está coerente.
  //
  // Quem separa os planos no ZION é a COTA (5/10/25/30), não o portão. O portão
  // continua exigindo sessão: cota por carteira só faz sentido com carteira.
  zionAdvisory:  "free",  // ZION streaming analysis — diferenciado por COTA
  cexAutopilot:  "pro",   // CEX autopilot panel
  arbScanner:    "trader",
  prioritySupport: "trader",

  /**
   * ⚠️ A BANCADA ENTRA COMO `free` PELO MESMO MOTIVO DO ZION, e não por
   * generosidade: quem separa os planos aqui é a COTA, não o portão.
   *
   * Uma bancada onde o gratuito só OLHA é vitrine com botão falso — e o que ele
   * ganha (dez backtests por dia) custa milissegundos de CPU depois da tabela
   * de velas. O que ele NÃO ganha é o que RECORRE: o papel adiante, que é o
   * único custo permanente, e por isso começa em `trader`.
   */
  bancadaBacktest:  "free",
  bancadaPapelAdiante: "trader",
};

/**
 * ⚠️⚠️ AS COTAS DA BANCADA — a irmã de `TIER_DAILY_ANALYSES`, e a fonte ÚNICA.
 *
 * Vem de `docs/PLANO-BANCADA-DO-CLIENTE.md` §6.2, decidida pelo critério de
 * lucro. O ranking de custo real, do mais caro para o mais barato:
 *
 *   1. papel adiante — recorrente, por estratégia, para sempre. É O custo.
 *   2. primeira busca do histórico de um símbolo — uma vez, depois zero.
 *   3. CPU do backtest — desprezível.
 *   4. IA — zero, enquanto o backtest for mecânico.
 *
 * Logo: **backtest generoso, papel adiante caro.**
 *
 * ⚠️ O PLANO TINHA DUAS TABELAS (§2.1 rascunho e §6.2 decisão) e cada uma era
 * coerente sozinha — que é exatamente a forma da cicatriz do Free/ZION. Esta
 * aqui é a §6.2, e a §2.1 está marcada como superada no documento.
 *
 * ⚠️ E NENHUM DESTES NÚMEROS É MEDIÇÃO DE DISPOSIÇÃO A PAGAR. São desenho por
 * critério de CUSTO. Preço é decisão do dono.
 */
export interface CotaDaBancada {
  /** Backtests por JANELA MÓVEL DE 24h — nunca por dia de calendário. */
  backtestsPorDia:   number;
  capitalMaxUsd:     number;
  estrategiasSalvas: number;
  janelaMaxDias:     number;
  simbolosPorTeste:  number;
  /** Mesas de papel adiante. 0 = o plano não tem. */
  mesasDePapel:      number;
}

export const BANCADA_COTAS: Record<Tier, CotaDaBancada> = {
  free:   { backtestsPorDia:   10, capitalMaxUsd:      1_000, estrategiasSalvas:   1, janelaMaxDias: 365, simbolosPorTeste:  3, mesasDePapel:  0 },
  pro:    { backtestsPorDia:  100, capitalMaxUsd:     25_000, estrategiasSalvas:  10, janelaMaxDias: 730, simbolosPorTeste: 10, mesasDePapel:  0 },
  trader: { backtestsPorDia:  500, capitalMaxUsd:    250_000, estrategiasSalvas:  50, janelaMaxDias: 730, simbolosPorTeste: 10, mesasDePapel:  3 },
  /**
   * ⚠️ "SEM TETO PRÁTICO" VIROU NÚMERO, de propósito. `Infinity` numa tela
   * aparece como "Infinity", em `JSON.stringify` vira `null`, e numa comparação
   * silencia o limite em vez de declará-lo. Um número grande e escrito é
   * auditável; o infinito não é.
   */
  pilot:  { backtestsPorDia: 5_000, capitalMaxUsd: 100_000_000, estrategiasSalvas: 200, janelaMaxDias: 730, simbolosPorTeste: 10, mesasDePapel: 10 },
};

/**
 * ZION analysis quota — analyses per DAY per tier. Source of truth for the
 * enforcement layer (dormant until TIER_GATES_ENABLED). DAILY (not monthly) so
 * a burst/bot can't drain a month's budget in one afternoon, and it maps to how
 * humans actually trade. Sized so even a maxed-out user stays profitable on the
 * current model; the hybrid (cheap models) lets these grow later without risk.
 */
export const TIER_DAILY_ANALYSES: Record<Tier, number> = {
  free:   5,
  pro:    10,
  trader: 25,
  pilot:  30,
};
