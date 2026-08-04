/**
 * LIVROS DE PERPÉTUO — a mesa de futuros precisa do livro dela, não do spot.
 *
 * ⚠️ POR QUE UMA MESA DE FUTUROS (04/08).
 *
 * O censo de profundidade mostrou que o custo de ATRAVESSAR o livro spot mata
 * a arbitragem entre venues antes de qualquer taxa. O perpétuo é um mercado
 * diferente, com livro próprio, e há duas razões concretas para o pedágio dele
 * ser menor nos majors:
 *
 *  · o volume de perp em BTC/ETH é múltiplo do spot na maioria das venues, e
 *    livro mais fundo costuma vir com bid-ask mais estreito;
 *  · vender não exige estoque. No spot, a perna vendida precisa de moeda
 *    parada na venue cara; no perp, basta margem. Isso remove o capital
 *    imobilizado que o modelo dos "dois bolsos" exige.
 *
 * ⚠️ E DUAS RAZÕES PARA DESCONFIAR, que a medição tem que responder:
 *
 *  · perp tem FUNDING. Ficar vendido numa venue e comprado noutra acumula
 *    funding dos dois lados, e a medição de funding desta semana mostrou
 *    mediana de +1.4% ao ano com cauda de −16%. Não é ruído desprezível.
 *  · perp tem LIQUIDAÇÃO. A perna vendida some se a margem acabar, e aí a
 *    posição deixa de ser neutra no pior momento possível.
 *
 * ⚠️ HOSTS: só gate.io e okx. A binance de futuros (`fapi`) devolveu 451 —
 * bloqueio jurisdicional — e a bybit 403, ambos medidos em 04/08 com 57
 * símbolos cada. Não são suposição: estão gravados em `funding_study_failed`.
 * Incluí-los aqui só produziria linhas vazias com cara de "sem oportunidade".
 */

import type { Level } from "@/lib/zion/arb-realism";

export type PerpVenue = "gateio" | "okx";

export const PERP_VENUES: PerpVenue[] = ["gateio", "okx"];

export interface PerpBook { asks: Level[]; bids: Level[] }

/** Converte `[["1.5","10"], …]` em pares numéricos, descartando lixo. */
function clean(raw: unknown): Level[] {
  if (!Array.isArray(raw)) return [];
  const out: Level[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const p = parseFloat(String(row[0])), q = parseFloat(String(row[1]));
    if (p > 0 && q > 0) out.push([p, q]);
  }
  return out;
}

async function json(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 15 } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/**
 * O livro do perpétuo USDT de um símbolo numa venue.
 *
 * ⚠️ A gate.io devolve `{asks:[{p,s}], bids:[{p,s}]}` — OBJETO, não par. O
 * formato é diferente do spot da própria gate.io, e tratá-los igual devolveria
 * livro vazio silenciosamente, que nesta casa vira "sem oportunidade" na tela.
 */
export async function fetchPerpBook(venue: PerpVenue, base: string, limit = 20): Promise<PerpBook | null> {
  const s = base.toUpperCase();
  if (venue === "gateio") {
    const d = await json(
      `https://api.gateio.ws/api/v4/futures/usdt/order_book?contract=${s}_USDT&limit=${limit}`,
    ) as { asks?: Array<{ p?: string; s?: number }>; bids?: Array<{ p?: string; s?: number }> } | null;
    if (!d) return null;
    const conv = (rows?: Array<{ p?: string; s?: number }>): Level[] =>
      (rows ?? []).map((r) => [parseFloat(r.p ?? ""), Number(r.s ?? 0)] as Level)
        .filter(([p, q]) => p > 0 && q > 0);
    const asks = conv(d.asks), bids = conv(d.bids);
    return asks.length && bids.length ? { asks, bids } : null;
  }

  // OKX: mesmo formato do spot, instrumento com sufixo -SWAP.
  const d = await json(
    `https://www.okx.com/api/v5/market/books?instId=${s}-USDT-SWAP&sz=${limit}`,
  ) as { data?: Array<{ asks?: unknown; bids?: unknown }> } | null;
  const first = d?.data?.[0];
  if (!first) return null;
  const asks = clean(first.asks), bids = clean(first.bids);
  return asks.length && bids.length ? { asks, bids } : null;
}

/**
 * ⚠️ A GATE.IO COTA EM CONTRATOS, NÃO EM MOEDA.
 *
 * O campo `s` do livro de futuros é o número de CONTRATOS, e cada contrato vale
 * `quanto_multiplier` unidades do ativo (0.0001 BTC, 0.01 ETH, e por aí). Somar
 * `preço × contratos` daria uma profundidade em dólares completamente errada —
 * para mais ou para menos conforme a moeda.
 *
 * Como a comparação que interessa aqui é o BID-ASK (uma razão entre preços, que
 * não depende da unidade), e não a profundidade absoluta, o censo de perp usa
 * só o topo do livro. A profundidade em USD fica declarada como NÃO MEDIDA em
 * vez de ser calculada errado — número errado com cara de certo é pior que
 * número ausente, e esta semana inteira é sobre isso.
 */
export const PERP_DEPTH_IS_UNRELIABLE = true;
