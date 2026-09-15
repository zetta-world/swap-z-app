/**
 * QUANDO UMA ORDEM CONDICIONAL DISPARA — e qual preço se vigia.
 *
 * ⚠️⚠️ ACHADO A22 DA AUDITORIA EXTERNA: o observador usava condição e preço
 * incorretos. São QUATRO defeitos no mesmo trecho, e dois deles trocam o
 * resultado de lado.
 *
 * ── 1. O LADO DE COMPRA VIGIAVA A MOEDA ERRADA ──────────────────────────
 *
 *     const sym = o.card.from?.symbol ?? o.card.to?.symbol;
 *
 * `from` é o que SAI da carteira e `to` é o que ENTRA. Numa compra
 * (`buy_limit`, `sniper_watch`, `limit`) o `from` é a stablecoin com que se
 * paga — então o observador media o preço do USDC, não o do token.
 *
 * Com USDC ≈ US$ 1,00 a conta vira absurda nos dois sentidos:
 *   · gatilho de US$ 0,85 num token  →  `1 <= 0,85` é falso  →  NUNCA dispara;
 *   · gatilho de US$ 2.500 em ETH    →  `1 <= 2500` é verdade →  dispara na
 *     PRIMEIRA sondagem, qualquer que seja o preço do ETH.
 *
 * ── 2. O `stop_loss` ESTAVA INVERTIDO ───────────────────────────────────
 *
 * Ele caía no ramo `atual >= gatilho`, junto com as vendas de realização. Um
 * stop existe para o lado que CAI: disparar na subida é vender dentro da alta
 * e não proteger queda nenhuma — o oposto exato da função dele.
 *
 * ── 3. O PREÇO ERA LIDO APAGANDO CARACTERES ─────────────────────────────
 *
 *     parseFloat(bruto.replace(/[^0-9.]/g, ""))
 *
 * `"1e-5"` perde o `e` e o `-` e vira `"15"`: um gatilho de 0,00001 lido como
 * QUINZE, um milhão e meio de vezes maior. Cartão de memecoin emite expoente o
 * tempo todo.
 *
 * ── 4. `kind` DESCONHECIDO CAÍA NO RAMO DE VENDA ────────────────────────
 *
 * A união de `kind` termina em `(string & {})` de propósito — o modelo pode
 * inventar um nome. O `else` mudo dava semântica de venda a qualquer invenção.
 * Aqui isso vira `null`: não sei, não disparo.
 */

export type Direcao =
  /** Comprar quando o preço CAIR até o gatilho. */
  | "compra"
  /** Vender quando o preço SUBIR até o alvo (realização). */
  | "venda_alvo"
  /** Vender quando o preço CAIR até o stop (proteção). */
  | "venda_stop";

const COMPRA = new Set(["buy_limit", "sniper_watch", "limit"]);
const VENDA_ALVO = new Set(["sell_safe", "sell_medium", "sell_aggressive"]);
const VENDA_STOP = new Set(["stop_loss"]);

/**
 * ⚠️ `null` = NÃO SEI, e quem chama NÃO dispara.
 *
 * Uma ordem condicional que deixa de disparar é recuperável — o dono vê o
 * cartão e age. Uma que dispara na direção errada gasta dinheiro. Entre as
 * duas, só uma dá para desfazer.
 */
export function direcaoDoGatilho(kind: string): Direcao | null {
  if (COMPRA.has(kind)) return "compra";
  if (VENDA_ALVO.has(kind)) return "venda_alvo";
  if (VENDA_STOP.has(kind)) return "venda_stop";
  return null;
}

/**
 * O símbolo cujo preço decide o gatilho.
 *
 * ⚠️ NA COMPRA É O `to`. É o token que se quer adquirir, e é o preço DELE que
 * precisa cair. O `from` é com o que se paga — vigiá-lo foi o defeito.
 */
export function simboloVigiado(
  card: { kind: string; from?: { symbol?: string }; to?: { symbol?: string } },
): string | null {
  const dir = direcaoDoGatilho(card.kind);
  if (!dir) return null;
  const alvo = dir === "compra" ? card.to?.symbol : card.from?.symbol;
  return alvo && alvo.trim() ? alvo.trim() : null;
}

/**
 * Lê o preço do gatilho sem falsificá-lo.
 *
 * ⚠️ NOTAÇÃO CIENTÍFICA PRESERVADA. Apagar `[^0-9.]` transformava `1e-5` em
 * `15`. Aqui o número é EXTRAÍDO com o formato dele inteiro, e o que não casar
 * devolve `null` em vez de um palpite.
 *
 * ⚠️ Vírgula só sai quando é separador de milhar (seguida de exatamente três
 * dígitos). `"1,5"` é ambíguo entre 1,5 e 15 — e ambíguo em preço devolve
 * `null`, não um dos dois.
 */
export function lerPrecoDoGatilho(bruto: unknown): number | null {
  if (typeof bruto !== "string") return null;
  const limpo = bruto.replace(/(\d),(\d{3})(?!\d)/g, "$1$2").trim();
  // Uma vírgula sobrando = ambiguidade; recusa.
  if (limpo.includes(",")) return null;
  /**
   * ⚠️ O SINAL É CAPTURADO, NÃO ENGOLIDO. A primeira versão desta função usava
   * `(?:^|[^\d.])` como delimitador, e o `-` de `"-3"` casava ali: o número saía
   * `3`, com o sinal apagado. Um preço negativo tem de virar `null` — não o
   * positivo dele. Foi o meu próprio teste de entrada inválida que pegou.
   */
  const m = /(?:^|[^\d.eE+-])(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?![\d.])/.exec(` ${limpo} `);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * O gatilho foi atingido?
 *
 * ⚠️ `compra` e `venda_stop` olham para BAIXO; `venda_alvo` olha para cima.
 * Eram dois ramos onde precisavam ser três.
 */
export function gatilhoAtingido(
  direcao: Direcao, precoAtual: number, gatilho: number,
): boolean {
  if (!Number.isFinite(precoAtual) || !Number.isFinite(gatilho)) return false;
  if (!(precoAtual > 0) || !(gatilho > 0)) return false;
  return direcao === "venda_alvo" ? precoAtual >= gatilho : precoAtual <= gatilho;
}
