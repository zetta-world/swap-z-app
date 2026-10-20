/**
 * Cliente do saldo Solana (W1): o navegador NÃO fala com RPC para ler saldo — pede ao servidor
 * (`/api/solana/saldo`), porque o RPC público recusa (403) chamadas com `Origin`. Ver
 * `lib/solana/saldos.ts`.
 *
 * ⚠️ Falha é ERRO (com tipo e se vale tentar de novo), nunca saldo zero. E a resposta é conferida:
 * se o servidor devolver outro dono/mint (troca de conta no meio), ela é descartada.
 */
export class ErroSaldo extends Error {
  constructor(readonly tipo: string, readonly transitorio: boolean) {
    super(`saldo indisponível: ${tipo}`);
    this.name = "ErroSaldo";
  }
}

export interface SaldoSolana { raw: bigint; decimals: number | null }

export async function buscarSaldoSolana(owner: string, mint: string, signal?: AbortSignal): Promise<SaldoSolana> {
  let res: Response;
  try {
    res = await fetch(`/api/solana/saldo?owner=${encodeURIComponent(owner)}&mint=${encodeURIComponent(mint)}`,
      { signal, cache: "no-store" });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ErroSaldo("conexao", true);
  }
  let j: { ok?: boolean; owner?: string; mint?: string; raw?: string; decimals?: number | null; erro?: string; transitorio?: boolean } = {};
  try { j = await res.json(); } catch { /* corpo ilegível: tratado abaixo */ }
  if (res.status === 429) throw new ErroSaldo("limite", true);
  if (!res.ok || j.ok !== true) throw new ErroSaldo(j.erro ?? `http_${res.status}`, j.transitorio ?? res.status >= 500);
  if (j.owner !== owner || j.mint !== mint || typeof j.raw !== "string" || !/^\d+$/.test(j.raw)) {
    throw new ErroSaldo("resposta", false);
  }
  return { raw: BigInt(j.raw), decimals: typeof j.decimals === "number" ? j.decimals : null };
}

/** Chave TanStack do saldo Solana — a MESMA em Swap, Portfólio e chip (uma leitura, vários leitores). */
export const chaveSaldoSolana = (owner: string | undefined, mint: string | undefined) =>
  ["saldo-solana", owner ?? null, mint ?? null] as const;
