/**
 * RETORNO ÷ TOMBO — a coluna que faltava.
 *
 * ⚠️ POR QUE ISTO EXISTE (14/08).
 *
 * O laboratório grava `max_drawdown_pct` desde sempre e NUNCA leu. A tela
 * ordena e destaca pelo retorno, e o tombo fica numa célula ao lado sem
 * participar de nenhuma decisão. O resultado é que estas duas linhas apareciam
 * como se a única diferença fosse o tamanho:
 *
 *     Venda de opção coberta   9,26%/ano   ·   tombo 46,10%   →  razão 0,20
 *     Funding / cash-and-carry 0,68%/ano   ·   tombo  5,88%   →  razão 0,12
 *
 * A razão muda a leitura: a coberta rende 13× mais e é só 1,7× melhor por
 * unidade de tombo. E muda a decisão, porque **exposição se aumenta em cima da
 * razão, não do retorno** — uma estratégia de 15%/ano com 10% de tombo suporta
 * alavancagem que uma de 30%/ano com 45% de tombo não suporta.
 *
 * Veio de uma auditoria externa, e o crédito é dela.
 */

/**
 * Por que uma linha pode não ter razão. Cada motivo pede uma leitura diferente,
 * e por isso são quatro e não um `null` anônimo — invariante nº 6.
 */
export type MotivoSemRazao =
  /** Não há retorno medido. */
  | "sem_retorno"
  /** Não há tombo medido — a medição não observa curva de capital. */
  | "sem_tombo"
  /** Tombo medido é ZERO. Quase sempre amostra curta, não ausência de risco. */
  | "tombo_zero"
  /** Retorno negativo. Quem perde é julgado pelo retorno, não pela razão. */
  | "retorno_negativo"
  /** A unidade do numerador não foi confirmada — ver `UnidadeDoRetorno`. */
  | "unidade_desconhecida";

/**
 * ⚠️ A UNIDADE DO NUMERADOR, E POR QUE ELA É OBRIGATÓRIA.
 *
 * Este laboratório publica DOIS tipos de número anualizado na mesma coluna:
 *
 *   NÍVEL     staking, tesouro, empréstimo → "rende 3,04%/ano"
 *   VANTAGEM  coberta, rotação             → "rende 9,26 pontos A MAIS que segurar"
 *
 * São grandezas diferentes, e a razão HERDA a unidade do numerador. "Vantagem
 * por unidade de tombo" e "rendimento por unidade de tombo" não se ordenam na
 * mesma coluna — é a invariante nº 17 ("diferença não se compara com nível")
 * aplicada à razão.
 *
 * ⚠️ E O PADRÃO É `desconhecida`, DE PROPÓSITO. Assumir "nível" quando ninguém
 * conferiu produziria exatamente a mistura que este campo existe para impedir,
 * e produziria em silêncio. Quem sabe a unidade declara; quem não sabe não
 * recebe razão. É a mesma postura do caminho do dinheiro: falha fechado.
 */
export type UnidadeDoRetorno = "nivel" | "vantagem" | "desconhecida";

export type Razao =
  | { razao: number; unidade: Exclude<UnidadeDoRetorno, "desconhecida"> }
  | { razao: null; motivo: MotivoSemRazao };

/**
 * `retorno ÷ |tombo|`, com as guardas que a conta crua não tem.
 *
 * ⚠️ TOMBO ZERO NÃO É RAZÃO INFINITA. `15 / 0` é `Infinity`, que numa coluna
 * ordenada senta no topo para sempre. Tombo zero quase nunca quer dizer "não
 * tem risco" — quer dizer que a janela foi curta demais para observar um. A
 * `carteira_verde` mediu tombo 0,00 com amostra EFETIVA de 4: coroar essa linha
 * seria premiar a falta de dado.
 *
 * ⚠️ RETORNO NEGATIVO NÃO VIRA "RAZÃO RUIM". `−5 / 10 = −0,5` senta acima de
 * `−0,8` numa ordenação crescente e sugere que perder menos é uma qualidade
 * medida pela razão. Não é: a razão só responde "quanto retorno por unidade de
 * tombo", e retorno negativo já foi julgado antes de chegar aqui.
 */
export function razaoRetornoTombo(
  retornoPct: number | null | undefined,
  tomboPct: number | null | undefined,
  unidade: UnidadeDoRetorno = "desconhecida",
): Razao {
  if (unidade === "desconhecida") return { razao: null, motivo: "unidade_desconhecida" };
  if (retornoPct == null || !Number.isFinite(retornoPct)) {
    return { razao: null, motivo: "sem_retorno" };
  }
  if (tomboPct == null || !Number.isFinite(tomboPct)) {
    return { razao: null, motivo: "sem_tombo" };
  }
  if (retornoPct < 0) return { razao: null, motivo: "retorno_negativo" };

  // O tombo é gravado como magnitude positiva em umas medições e como negativo
  // em outras. `abs` aceita as duas sem precisar que todas concordem primeiro.
  const tombo = Math.abs(tomboPct);
  if (!(tombo > 0)) return { razao: null, motivo: "tombo_zero" };

  return { razao: retornoPct / tombo, unidade };
}

/** Frase curta para a tela quando não há razão. Sem isto a célula fica só vazia. */
export const PORQUE_SEM_RAZAO: Record<MotivoSemRazao, string> = {
  sem_retorno:          "sem retorno anualizado medido",
  sem_tombo:            "esta medição não observa curva de capital",
  tombo_zero:           "tombo medido é zero — quase sempre janela curta, não ausência de risco",
  retorno_negativo:     "retorno negativo: julgue pelo retorno, não pela razão",
  unidade_desconhecida: "unidade do numerador não confirmada (nível ou vantagem?)",
};

/**
 * Leitura da razão, para quem não vive nisso.
 *
 * ⚠️ AS FAIXAS SÃO CONVENÇÃO, NÃO MEDIÇÃO. Elas não saíram de nenhum teste
 * deste laboratório — são a régua de mercado para retorno sobre tombo, e estão
 * aqui para dar palavra a um número, não para dar veredito. Nenhum portão deste
 * repositório deve consultar esta função: ela é texto de tela. Se um dia ela
 * virar condição de decisão, o número que a alimenta precisa de medição própria
 * primeiro (é a invariante nº 28 — declaração que vira portão sem virar dado).
 */
export function lerRazao(razao: number): string {
  if (razao >= 1.5) return "forte: o retorno paga bem o tombo";
  if (razao >= 1.0) return "boa: retorno da ordem do tombo";
  if (razao >= 0.5) return "modesta: o tombo custa caro pelo que rende";
  return "fraca: muito tombo para pouco retorno";
}

/**
 * As duas razões podem ser comparadas?
 *
 * A resposta é NÃO sempre que as unidades diferem, e a função existe para que a
 * tela nunca ordene as duas juntas por engano.
 */
export function comparaveis(a: Razao, b: Razao): boolean {
  return a.razao !== null && b.razao !== null && a.unidade === b.unidade;
}

/**
 * A UNIDADE DO ANUALIZADO DE CADA ESTRATÉGIA — conferida uma por uma.
 *
 * ⚠️ CADA ENTRADA SAIU DO TEXTO DO VEREDITO GRAVADO, não de suposição:
 *
 *   covered_call        "a vantagem é 0.76 ponto"                       → vantagem
 *   momentum_rotation   "-4.43 ponto(s) ABAIXO de não escolher nada"    → vantagem
 *   amm_lp              "fica 0.82% de segurar os mesmos ativos"        → vantagem
 *   carteira_verde      "carteira 2.73%/ano líquido"                    → nível
 *   liquid_staking      "líquido do 1º ano 1.78%"                       → nível
 *   tokenized_treasury  "líquido do 1º ano 3.04%"                       → nível
 *   stablecoin_lending  "líquido do 1º ano 3.44%"                       → nível
 *   restaking           mesma família de carrego                        → nível
 *   funding_basis       "mediana 0.68%/ano depois das 4 pernas"         → nível
 *   grid_bot            "perdeu 50.87% do capital"                      → nível
 *   dex_cex_arb         "mediana da borda líquida +0.019%"              → nível
 *   tendencia_baixa_freq  retorno próprio fora da amostra               → nível
 *
 * ⚠️ QUEM NÃO ESTÁ AQUI NÃO RECEBE RAZÃO. Um slug novo cai em
 * `desconhecida` e a célula fica vazia com o motivo — em vez de entrar na
 * coluna com a unidade errada e ser ordenado junto com quem não se compara.
 * Acrescentar uma linha aqui exige ler o texto do veredito daquela estratégia;
 * é chato de propósito.
 */
export const UNIDADE_DO_RETORNO: Readonly<Record<string, UnidadeDoRetorno>> = {
  covered_call:         "vantagem",
  momentum_rotation:    "vantagem",
  amm_lp:               "vantagem",
  carteira_verde:       "nivel",
  liquid_staking:       "nivel",
  tokenized_treasury:   "nivel",
  stablecoin_lending:   "nivel",
  restaking:            "nivel",
  funding_basis:        "nivel",
  grid_bot:             "nivel",
  dex_cex_arb:          "nivel",
  tendencia_baixa_freq: "nivel",
};
