import { createHash } from "node:crypto";

/**
 * PROVEDOR DE MINT FALSO E DETERMINÍSTICO — nenhuma rede, nenhuma chain.
 *
 * `MAINNET_MINT=OFF`. Serve para exercitar o ciclo inteiro (reserva → mint →
 * confirmação → falhas) em teste local. O id da "transação" é derivado da
 * chave de idempotência: o mesmo pedido devolve o mesmo id (replay seguro), e
 * o prefixo `fake-` impede confundir com id real.
 */
export interface PedidoMint { chave: string; carteira: string; unidades: number }
export type ResultadoMint =
  | { ok: true; txId: string; replay: boolean }
  | { ok: false; codigo: "transitorio" | "permanente"; replay: boolean };

export interface OpcoesMintFalso {
  /** Chaves que falham transitoriamente nas N primeiras tentativas. */
  transitorias?: Map<string, number>;
  /** Chaves que sempre falham de forma permanente. */
  permanentes?: Set<string>;
}

export class MintFalso {
  readonly rede = "FAKE_LOCAL_ONLY" as const;
  private readonly concluidos = new Map<string, string>();
  private readonly tentativas = new Map<string, number>();
  constructor(private readonly opcoes: OpcoesMintFalso = {}) {}

  async mintar(p: PedidoMint): Promise<ResultadoMint> {
    const pronto = this.concluidos.get(p.chave);
    if (pronto) return { ok: true, txId: pronto, replay: true };
    const n = (this.tentativas.get(p.chave) ?? 0) + 1;
    this.tentativas.set(p.chave, n);
    if (this.opcoes.permanentes?.has(p.chave)) return { ok: false, codigo: "permanente", replay: n > 1 };
    const falhas = this.opcoes.transitorias?.get(p.chave) ?? 0;
    if (n <= falhas) return { ok: false, codigo: "transitorio", replay: false };
    const txId = "fake-" + createHash("sha256").update(`mint-falso\0${p.chave}\0${p.carteira}\0${p.unidades}`).digest("hex").slice(0, 32);
    this.concluidos.set(p.chave, txId);
    return { ok: true, txId, replay: false };
  }

  tentativasDe(chave: string): number { return this.tentativas.get(chave) ?? 0; }
}
