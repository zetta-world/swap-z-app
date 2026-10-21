/**
 * ⚠️⚠️ W3-C — TRAVA DURÁVEL POR CARTEIRA (anti-duplicação ENTRE APARELHOS), 21/10/2026.
 *
 * Reproduzido: dois navegadores, mesma carteira, cotações diferentes → duas assinaturas → o servidor
 * levou as duas ao RPC. A trava do histórico local não enxerga o outro aparelho. Esta vive no banco
 * (`solana_tx_em_voo`, migration 0077) e é decidida atomicamente por carteira.
 *
 * Regras (ver o cabeçalho da 0077):
 *   · mesma assinatura → retransmissão permitida;
 *   · outra assinatura da mesma carteira em aberto → recusa ANTES do RPC;
 *   · a tentativa em aberto só é resolvida por FATO: confirmada / falhou_na_rede (on-chain),
 *     `expirada` (altura de bloco > `valido_ate_bloco` GRAVADO, que veio do vínculo assinado pelo
 *     servidor) ou recusa certa antes da rede. ⚠️ SEM TTL — "passou tempo" não prova que não pousa.
 *   · banco indisponível → FALHA FECHADA (não transmite): dinheiro em jogo.
 */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { consultarStatus, type EstadoOnChain } from "@/lib/solana/transmissao";

export type Reserva =
  | { resultado: "reservada" | "retransmissao" }
  | { resultado: "ja_resolvida"; desfecho: "confirmada" | "falhou_na_rede" | "expirada" }
  | { resultado: "bloqueada"; assinatura: string; validoAteBloco: number }
  | { resultado: "indisponivel"; motivo: string };

export interface PedidoReserva {
  carteira: string;
  assinatura: string;
  hashMensagem: string;
  blockhash: string;
  validoAteBloco: number;
}

async function chamarReserva(p: PedidoReserva): Promise<Reserva> {
  const db = getSupabaseAdmin();
  if (!db) return { resultado: "indisponivel", motivo: "sem_banco" };
  try {
    const { data, error } = await db.rpc("solana_tx_reservar", {
      p_carteira: p.carteira, p_assinatura: p.assinatura, p_hash: p.hashMensagem,
      p_blockhash: p.blockhash, p_valido_ate_bloco: p.validoAteBloco,
    });
    if (error) return { resultado: "indisponivel", motivo: `rpc:${String(error.message).slice(0, 80)}` };
    const r = data as { resultado?: unknown; desfecho?: unknown; assinatura?: unknown; valido_ate_bloco?: unknown } | null;
    if (r?.resultado === "reservada" || r?.resultado === "retransmissao") return { resultado: r.resultado };
    if (r?.resultado === "ja_resolvida"
        && (r.desfecho === "confirmada" || r.desfecho === "falhou_na_rede" || r.desfecho === "expirada")) {
      return { resultado: "ja_resolvida", desfecho: r.desfecho };
    }
    if (r?.resultado === "bloqueada" && typeof r.assinatura === "string") {
      const l = Number(r.valido_ate_bloco);
      if (Number.isSafeInteger(l)) return { resultado: "bloqueada", assinatura: r.assinatura, validoAteBloco: l };
    }
    // Resposta que não reconhecemos NÃO é permissão.
    return { resultado: "indisponivel", motivo: "resposta_ilegivel" };
  } catch {
    return { resultado: "indisponivel", motivo: "excecao" };
  }
}

export type Marca =
  | { estado: "enviada" } | { estado: "incerta"; motivo: string }
  | { estado: "resolvida"; desfecho: "confirmada" | "falhou_na_rede" | "expirada" | "nao_enviada"; motivo?: string };

/** Registra a transição. Falha aqui não libera nada: a linha continua em aberto (lado seguro). */
export async function marcarTentativa(assinatura: string, m: Marca): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  try {
    const { data, error } = await db.rpc("solana_tx_marcar", {
      p_assinatura: assinatura, p_estado: m.estado,
      p_desfecho: m.estado === "resolvida" ? m.desfecho : null,
      p_motivo: "motivo" in m ? (m.motivo ?? null) : null,
    });
    if (error) { console.warn("[sol-em-voo]", JSON.stringify({ marcar: "falhou", estado: m.estado })); return false; }
    return data === true;
  } catch { return false; }
}

/** Desfecho on-chain que ENCERRA a tentativa (com a altura GRAVADA, nunca a do navegador). */
export function desfechoTerminal(s: EstadoOnChain): "confirmada" | "falhou_na_rede" | "expirada" | null {
  return s.estado === "confirmada" || s.estado === "falhou_na_rede" || s.estado === "expirada" ? s.estado : null;
}

/**
 * Reserva a carteira para esta transação. No conflito, consulta a rede sobre a tentativa em aberto
 * (com o `valido_ate_bloco` gravado): se ela já tem desfecho definitivo, encerra e tenta UMA vez de novo.
 */
export async function reservarTransmissao(
  p: PedidoReserva,
  deps: { status?: typeof consultarStatus; reservar?: typeof chamarReserva; marcar?: typeof marcarTentativa } = {},
): Promise<Reserva> {
  const reservar = deps.reservar ?? chamarReserva;
  const status = deps.status ?? consultarStatus;
  const marcar = deps.marcar ?? marcarTentativa;
  const r = await reservar(p);
  if (r.resultado !== "bloqueada") return r;
  const fim = desfechoTerminal(await status(r.assinatura, r.validoAteBloco));
  if (!fim) return r;
  await marcar(r.assinatura, { estado: "resolvida", desfecho: fim });
  return reservar(p);
}
