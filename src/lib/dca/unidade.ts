/**
 * Unidade monetária do DCA.
 *
 * Batch 2 / A96: um valor expresso na moeda QUOTE só pode receber semântica
 * USD quando a quote pertence à allowlist explícita abaixo. Não inferimos
 * "stablecoin" por nome nem ampliamos silenciosamente a política.
 */
export const DCA_USD_LIKE_QUOTES = ["USD", "USDT", "USDC"] as const;

export type DcaUsdLikeQuote = typeof DCA_USD_LIKE_QUOTES[number];

const USD_LIKE = new Set<string>(DCA_USD_LIKE_QUOTES);

export type UnidadeDca =
  | { ok: true; base: string; quote: DcaUsdLikeQuote }
  | { ok: false; motivo: "par_invalido" | "quote_nao_usd_like"; base?: string; quote?: string };

/**
 * Lê BASE/QUOTE e só aceita quotes cuja unidade pode ser tratada, por política
 * explícita deste batch, como USD-like.
 */
export function unidadeDca(symbol: string): UnidadeDca {
  const partes = String(symbol ?? "").trim().toUpperCase().split("/");
  if (partes.length !== 2 || !partes[0] || !partes[1]
      || !/^[A-Z0-9]{2,12}$/.test(partes[0])
      || !/^[A-Z0-9]{2,12}$/.test(partes[1])) {
    return { ok: false, motivo: "par_invalido" };
  }
  const [base, quote] = partes;
  if (!USD_LIKE.has(quote)) {
    return { ok: false, motivo: "quote_nao_usd_like", base, quote };
  }
  return { ok: true, base, quote: quote as DcaUsdLikeQuote };
}
