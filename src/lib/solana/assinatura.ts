/**
 * Assinatura pública de uma transação Solana já assinada (W3) — usada no navegador (registrar a
 * tentativa logo após a carteira assinar) e no servidor (conferir o retorno do RPC). Só leitura:
 * nenhuma chave, nenhum segredo.
 */
import type { VersionedTransaction } from "@solana/web3.js";

const ALFABETO = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let s = "";
  while (n > 0n) { s = ALFABETO[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
  return s;
}

/** A 1ª assinatura (do pagador) — é o identificador da transação na rede. */
export function assinaturaDe(tx: VersionedTransaction): string {
  return base58(tx.signatures[0]);
}
