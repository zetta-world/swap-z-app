/**
 * ⚠️⚠️ VÍNCULO COTAÇÃO ↔ TRANSAÇÃO (W3, revisão independente 21/10).
 *
 * Bytes idênticos provam que o SERVIDOR não alterou a transação — não provam que ela é a que a
 * Z-SWAP cotou (com a taxa da escada). Este vínculo prova:
 *
 *   Na cotação firme (`/api/quote`), o servidor monta a transação e emite um token HMAC com:
 *     h = sha256(mensagem que ELE montou) · o = pagador · b = bps de taxa que ELE decidiu ·
 *     f = conta de taxa (ou null quando o fail-open legítimo desligou a taxa) · x = expiração.
 *   Na transmissão, a mensagem ASSINADA tem de ter exatamente aquele hash, o pagador tem de bater e o
 *   token tem de ser válido e não expirado. Qualquer adulteração — tirar a taxa, mudar a conta de
 *   taxa, outra rota, outro valor — muda o hash e é recusada ANTES do RPC.
 *
 * O navegador não forja: não tem o segredo. Nada do token vem de parâmetro declarado pelo navegador.
 *
 * ⚠️ LIMITE CONHECIDO: se a carteira alterar a mensagem ao assinar (algumas inserem asserções), o hash
 * não bate e o envio é recusado sem transmitir — o mesmo resultado que a allowlist de programas já dava.
 * Liberar exige evidência real de qual alteração a carteira faz.
 *
 * Segredo: `TX_VINCULO_SECRET`, ou derivado de `AUTH_JWT_SECRET` com separação de domínio. Sem nenhum,
 * nada é emitido e a transmissão recusa (falha fechada).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { VersionedTransaction } from "@solana/web3.js";

const VALIDADE_MS = 3 * 60_000;   // > validade do blockhash (~60–90 s) com folga; nunca permanente

export interface DadosVinculo {
  v: 1;
  h: string;            // sha256 hex da mensagem montada pelo servidor
  o: string;            // pagador (carteira do taker)
  b: number;            // bps de taxa decididos no servidor (0 = sem taxa)
  f: string | null;     // conta de taxa (null quando b = 0)
  x: number;            // expiração (ms)
  /**
   * `lastValidBlockHeight` da transação montada (W3-C). A trava durável por carteira usa ESTE valor —
   * assinado pelo servidor — para decidir quando a tentativa não pode mais pousar; nunca o do navegador.
   */
  l: number;
}

function chave(): Buffer | null {
  const propria = (process.env.TX_VINCULO_SECRET ?? "").trim();
  if (propria.length >= 32) return Buffer.from(propria);
  const base = process.env.AUTH_JWT_SECRET;
  if (!base || base.length < 16) return null;
  return createHmac("sha256", base).update("zswap:tx-vinculo:v1").digest();
}

const b64u = (b: Buffer) => b.toString("base64url");
export const hashDaMensagem = (msg: Uint8Array) => createHash("sha256").update(msg).digest("hex");

/** Emite o vínculo para a mensagem que o SERVIDOR montou. `null` se não houver segredo. */
export function emitirVinculo(a: { mensagem: Uint8Array; owner: string; bps: number; feeAccount: string | null; validoAteBloco: number; agora?: number }): string | null {
  const k = chave();
  if (!k) return null;
  const dados: DadosVinculo = {
    v: 1, h: hashDaMensagem(a.mensagem), o: a.owner,
    b: a.bps > 0 && a.feeAccount ? a.bps : 0, f: a.bps > 0 && a.feeAccount ? a.feeAccount : null,
    x: (a.agora ?? Date.now()) + VALIDADE_MS,
    l: a.validoAteBloco,
  };
  const corpo = b64u(Buffer.from(JSON.stringify(dados)));
  return `${corpo}.${b64u(createHmac("sha256", k).update(corpo).digest())}`;
}

export type ConferenciaVinculo = { ok: true; dados: DadosVinculo } | { ok: false; motivo: string };

/** A transação assinada é EXATAMENTE a que o servidor cotou para este pagador, e o token é válido? */
export function conferirVinculo(token: unknown, tx: VersionedTransaction, agora = Date.now()): ConferenciaVinculo {
  const k = chave();
  if (!k) return { ok: false, motivo: "vinculo_indisponivel" };
  if (typeof token !== "string" || token.length > 1024) return { ok: false, motivo: "vinculo_ausente" };
  const partes = token.split(".");
  if (partes.length !== 2) return { ok: false, motivo: "vinculo_formato" };
  const [corpo, mac] = partes;
  const esperado = createHmac("sha256", k).update(corpo).digest();
  let recebido: Buffer;
  try { recebido = Buffer.from(mac, "base64url"); } catch { return { ok: false, motivo: "vinculo_formato" }; }
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return { ok: false, motivo: "vinculo_assinatura" };
  let d: DadosVinculo;
  try { d = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")); } catch { return { ok: false, motivo: "vinculo_formato" }; }
  if (d?.v !== 1 || typeof d.h !== "string" || typeof d.o !== "string" || typeof d.b !== "number" || typeof d.x !== "number"
      || !Number.isSafeInteger(d.l) || d.l < 0) {
    return { ok: false, motivo: "vinculo_formato" };
  }
  if (agora > d.x) return { ok: false, motivo: "vinculo_expirado" };
  if (tx.message.staticAccountKeys[0]?.toBase58() !== d.o) return { ok: false, motivo: "vinculo_pagador" };
  if (hashDaMensagem(tx.message.serialize()) !== d.h) return { ok: false, motivo: "vinculo_mensagem_diferente" };
  if ((d.b > 0) !== (d.f !== null)) return { ok: false, motivo: "vinculo_taxa_inconsistente" };
  return { ok: true, dados: d };
}
