import { createHash, createHmac } from "node:crypto";

/**
 * CARTEIRA E CHAIN FALSAS (local) — arquitetura pronta para Solana, sem mainnet, sem rede.
 *
 *   · `REDE_DA_VENDA` é a rede falsa local. Carteira em outra rede = WRONG_NETWORK e o CTA trava;
 *   · assinatura de posse da carteira: mensagem determinística (formato pensado para `signMessage` da
 *     Solana); aqui a "assinatura" é um HMAC com segredo LOCAL de teste — trocar por ed25519 real é o
 *     trabalho do ensaio em devnet. Nenhuma chave real existe;
 *   · `CadeiaFalsa`: envio devolve uma assinatura `fakesig-…`; o recibo fica `pending` por N ticks e então
 *     `confirmed` ou `failed`. SUCESSO SÓ COM RECIBO `confirmed` — assinar não é sucesso. Recibo corrompido
 *     ou desconhecido nunca vira sucesso.
 */
export const REDE_DA_VENDA = "solana:localnet-fake" as const;

export const ESTADOS_CARTEIRA = [
  "disconnected", "connecting", "connected", "wrong_network", "eligibility_checking", "eligible", "not_eligible",
  "allocation_exhausted", "signing", "signing_rejected", "submitted", "pending", "confirmed", "failed", "timeout",
] as const;
export type EstadoCarteira = (typeof ESTADOS_CARTEIRA)[number];

export type EventoCarteira =
  | { t: "conectar" } | { t: "conectou"; rede: string } | { t: "desconectar" }
  | { t: "checar_elegibilidade" } | { t: "elegibilidade"; elegivel: boolean; restante: number | null }
  | { t: "assinar" } | { t: "recusou" } | { t: "enviou" } | { t: "recibo"; status: "pending" | "confirmed" | "failed" }
  | { t: "tempo_esgotado" } | { t: "reiniciar" };

/** Transição do UX da carteira. Evento inválido para o estado = estado inalterado. */
export function proximoEstadoCarteira(s: EstadoCarteira, e: EventoCarteira): EstadoCarteira {
  if (e.t === "desconectar") return "disconnected";
  switch (s) {
    case "disconnected": return e.t === "conectar" ? "connecting" : s;
    case "connecting": return e.t === "conectou" ? (e.rede === REDE_DA_VENDA ? "connected" : "wrong_network") : s;
    case "wrong_network": return e.t === "conectou" && e.rede === REDE_DA_VENDA ? "connected" : s;
    case "connected": return e.t === "checar_elegibilidade" ? "eligibility_checking" : s;
    case "eligibility_checking":
      if (e.t !== "elegibilidade") return s;
      if (!e.elegivel) return "not_eligible";
      return e.restante === 0 ? "allocation_exhausted" : "eligible";
    case "eligible": return e.t === "assinar" ? "signing" : s;
    case "signing": return e.t === "recusou" ? "signing_rejected" : e.t === "enviou" ? "submitted" : s;
    case "submitted":
    case "pending":
      if (e.t === "recibo") return e.status === "confirmed" ? "confirmed" : e.status === "failed" ? "failed" : "pending";
      return e.t === "tempo_esgotado" ? "timeout" : s;
    case "signing_rejected": case "failed": case "timeout":
      return e.t === "reiniciar" ? "eligible" : s;
    default: return s;
  }
}

export function mensagemDePosse(carteira: string, nonce: string, emitidaEm: number): string {
  return `Z-SWAP Founders allowlist\nwallet:${carteira}\nnonce:${nonce}\nissued:${emitidaEm}\nnetwork:${REDE_DA_VENDA}`;
}

/** Assinador FALSO (só teste/ensaio). O segredo é por instância e nunca sai daqui. */
export class AssinadorFalso {
  constructor(private readonly segredoLocal: string) {}
  assinar(mensagem: string): string { return createHmac("sha256", this.segredoLocal).update(mensagem).digest("hex"); }
  verificar(mensagem: string, assinatura: string): boolean {
    const esperado = this.assinar(mensagem);
    return assinatura.length === esperado.length && createHash("sha256").update(esperado).digest("hex") === createHash("sha256").update(assinatura).digest("hex");
  }
}

export interface TransacaoFalsa { chave: string; carteira: string; tier: string; lamports: string; rede: string; precoFingerprint: string }
export type StatusRecibo = "pending" | "confirmed" | "failed" | "unknown";
export interface Recibo { assinatura: string; status: StatusRecibo }

export interface OpcoesCadeia { ticksAteConfirmar?: number; falhar?: Set<string>; corromper?: Set<string> }

export class CadeiaFalsa {
  readonly rede = REDE_DA_VENDA;
  private fora = false;
  private enviadas = new Map<string, { tx: TransacaoFalsa; ticks: number }>();
  constructor(private readonly opcoes: OpcoesCadeia = {}) {}
  derrubar(sim: boolean) { this.fora = sim; }

  enviar(tx: TransacaoFalsa): { ok: true; assinatura: string } | { ok: false; erro: "cadeia_indisponivel" | "rede_errada" } {
    if (this.fora) return { ok: false, erro: "cadeia_indisponivel" };
    if (tx.rede !== REDE_DA_VENDA) return { ok: false, erro: "rede_errada" };
    const assinatura = "fakesig-" + createHash("sha256").update(`cadeia-falsa\0${tx.chave}\0${tx.carteira}\0${tx.tier}\0${tx.lamports}`).digest("hex").slice(0, 40);
    if (!this.enviadas.has(assinatura)) this.enviadas.set(assinatura, { tx, ticks: 0 }); // reenvio = mesma assinatura
    return { ok: true, assinatura };
  }

  /** Recibo cru, como viria de um RPC. Pode vir "corrompido" (formato inválido) quando configurado. */
  reciboCru(assinatura: string): unknown {
    if (this.fora) throw new Error("cadeia_indisponivel");
    const e = this.enviadas.get(assinatura);
    if (!e) return { assinatura, status: "unknown" };
    if (this.opcoes.corromper?.has(e.tx.chave)) return { assinatura, status: 42, lixo: true };
    e.ticks++;
    if (this.opcoes.falhar?.has(e.tx.chave)) return { assinatura, status: "failed" };
    return { assinatura, status: e.ticks >= (this.opcoes.ticksAteConfirmar ?? 2) ? "confirmed" : "pending" };
  }
}

/** Interpreta o recibo cru com desconfiança: qualquer coisa fora do formato = `unknown` (nunca sucesso). */
export function lerRecibo(cru: unknown, assinaturaEsperada: string): Recibo {
  if (!cru || typeof cru !== "object") return { assinatura: assinaturaEsperada, status: "unknown" };
  const o = cru as Record<string, unknown>;
  const status = o.status;
  if (o.assinatura !== assinaturaEsperada) return { assinatura: assinaturaEsperada, status: "unknown" };
  if (status === "pending" || status === "confirmed" || status === "failed") return { assinatura: assinaturaEsperada, status };
  return { assinatura: assinaturaEsperada, status: "unknown" };
}
