import type { CexBalance } from "@/lib/cex/types";

export type PrecheckSaldoDca =
  | { ok: true; free: number }
  | { ok: false; motivo: "quote_ausente" | "saldo_livre_invalido" | "saldo_livre_insuficiente"; free?: number };

export type GateSaldoDca<T> =
  | { ok: true; free: number; valor: T }
  | { ok: false; motivo: "leitura_falhou"; detalhe: string }
  | Extract<PrecheckSaldoDca, { ok: false }>;

/**
 * A97 — usa exclusivamente FREE. `total` pode incluir saldo travado em ordens
 * e por isso nunca autoriza uma BUY nova.
 */
export function avaliarSaldoLivreDca(
  balances: readonly CexBalance[], quote: string, necessario: number,
): PrecheckSaldoDca {
  if (!Number.isFinite(necessario) || necessario <= 0) {
    return { ok: false, motivo: "saldo_livre_invalido" };
  }
  const alvo = quote.toUpperCase();
  const linha = balances.find((b) => String(b.asset).toUpperCase() === alvo);
  if (!linha) return { ok: false, motivo: "quote_ausente" };

  const free = Number(linha.free);
  if (!Number.isFinite(free) || free < 0) {
    return { ok: false, motivo: "saldo_livre_invalido" };
  }
  // Pequena tolerância só contra ruído de ponto flutuante do adapter CCXT.
  if (free + 1e-12 < necessario) {
    return { ok: false, motivo: "saldo_livre_insuficiente", free };
  }
  return { ok: true, free };
}

/**
 * A97 — fronteira assíncrona testável. A leitura da venue e a autorização do
 * próximo efeito ficam acopladas por contrato: `continuar` só é chamado depois
 * de um snapshot FREE válido e suficiente.
 *
 * Isto NÃO torna o saldo atômico. Depois do preflight a venue ainda pode mudar
 * e recusar a ordem. A propriedade é apenas: leitura falhou/quote ausente/FREE
 * insuficiente => nenhum efeito posterior deste callback é executado.
 */
export async function comSaldoLivreDca<T>(p: {
  quote: string;
  necessario: number;
  ler: () => Promise<{ balances: readonly CexBalance[] }>;
  continuar: () => Promise<T>;
}): Promise<GateSaldoDca<T>> {
  let snapshot: { balances: readonly CexBalance[] };
  try {
    snapshot = await p.ler();
  } catch (e) {
    return {
      ok: false,
      motivo: "leitura_falhou",
      detalhe: (e instanceof Error ? e.message : String(e)).slice(0, 200),
    };
  }

  const saldo = avaliarSaldoLivreDca(snapshot.balances, p.quote, p.necessario);
  if (!saldo.ok) return saldo;

  return { ok: true, free: saldo.free, valor: await p.continuar() };
}
