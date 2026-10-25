/**
 * ⚠️⚠️ VÍNCULO COTAÇÃO ↔ TRANSAÇÃO (W3, revisão independente 21/10).
 *
 * Bytes idênticos provam que o SERVIDOR não alterou a transação — não provam que ela é a que a
 * Z-SWAP cotou (com a taxa da escada). Este vínculo prova:
 *
 *   Na cotação firme (`/api/quote`), o servidor monta a transação e emite um token HMAC com:
 *     h = sha256(mensagem que ELE montou) · o = pagador · b = bps de taxa que ELE decidiu ·
 *     f = conta de taxa (ou null quando o fail-open legítimo desligou a taxa) · x = expiração.
 *   Na transmissão, exige-se aquele hash ou a extensão Lighthouse restrita descrita abaixo; o pagador e o
 *   token têm de ser válidos e o token não expirado. Qualquer adulteração — tirar a taxa, mudar a conta de
 *   taxa, outra rota, outro valor — muda o hash e é recusada ANTES do RPC.
 *
 * O navegador não forja: não tem o segredo. Nada do token vem de parâmetro declarado pelo navegador.
 *
 * Compatibilidade Lighthouse (v2, 24/10): o hash original permanece obrigatório. A carteira pode
 * acrescentar asserções somente leitura (em qualquer posição) e elevar o `SetComputeUnitLimit`, mediante
 * comparação restrita com a mensagem original autenticada pelo mesmo HMAC — regras em `compararExtensao`
 * (`lighthouse.ts`). Nenhum campo financeiro, privilégio, assinante ou blockhash é excluído da comparação.
 *
 * Segredo: `TX_VINCULO_SECRET`, ou derivado de `AUTH_JWT_SECRET` com separação de domínio. Sem nenhum,
 * nada é emitido e a transmissão recusa (falha fechada).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { VersionedMessage, type VersionedTransaction } from "@solana/web3.js";

import { compararExtensao } from "@/lib/solana/lighthouse";

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

export type ConferenciaVinculo =
  /** `extensao`: presente quando a carteira acrescentou asserções Lighthouse à mensagem autenticada. */
  | { ok: true; dados: DadosVinculo; extensao?: { assercoes: number; cuElevado: boolean } }
  /** `detalhe`: a regra que falhou (nome curto, sem bytes nem token) — para o log e o suporte. */
  | { ok: false; motivo: string; detalhe?: string };

/** Authenticate the quoted message, then require exact bytes or a restricted Lighthouse extension of it. */
export function conferirVinculo(token: unknown, tx: VersionedTransaction, agora = Date.now(), mensagemOriginal?: unknown): ConferenciaVinculo {
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
  let extensao: { assercoes: number; cuElevado: boolean } | undefined;
  if (hashDaMensagem(tx.message.serialize()) !== d.h) {
    // The browser supplies evidence, not authority: authenticate the original bytes
    // with the EXISTING HMAC before considering the narrowly allowed extension.
    const recusa = (detalhe: string): ConferenciaVinculo => ({ ok: false, motivo: "vinculo_mensagem_diferente", detalhe });
    if (typeof mensagemOriginal !== "string" || mensagemOriginal.length > 1644) return recusa("original_ausente");
    const bytes = Buffer.from(mensagemOriginal, "base64");
    if (bytes.toString("base64") !== mensagemOriginal || hashDaMensagem(bytes) !== d.h) return recusa("original_hash");
    let original: VersionedMessage;
    try { original = VersionedMessage.deserialize(bytes); } catch { return recusa("original_formato"); }
    if (original.version !== 0 || tx.message.version !== 0 || !Buffer.from(original.serialize()).equals(bytes)) {
      return recusa("original_formato");
    }
    const r = compararExtensao(original, tx.message);
    if (!r.ok) return recusa(r.regra);
    extensao = { assercoes: r.assercoes, cuElevado: r.cuElevado };
  }
  if ((d.b > 0) !== (d.f !== null)) return { ok: false, motivo: "vinculo_taxa_inconsistente" };
  return extensao ? { ok: true, dados: d, extensao } : { ok: true, dados: d };
}
