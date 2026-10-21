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

/** base58 → bytes; `null` se houver caractere fora do alfabeto. */
export function deBase58(s: string): Uint8Array | null {
  let n = 0n;
  for (const c of s) { const i = ALFABETO.indexOf(c); if (i < 0) return null; n = n * 58n + BigInt(i); }
  const b: number[] = [];
  while (n > 0n) { b.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of s) { if (c === "1") b.unshift(0); else break; }
  return Uint8Array.from(b);
}
