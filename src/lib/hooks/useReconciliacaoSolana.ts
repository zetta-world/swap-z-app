"use client";

import { useEffect } from "react";
import { useTxHistory, statusDaEtapa, ETAPAS_EM_ABERTO, type TxHistoryEntry } from "@/lib/store/txHistory";
import { consultarStatusOnChain } from "@/lib/solana/transmissao-cliente";

const INTERVALO_MS = 15_000;
/** "solicitada" sem assinatura há mais que isto: o usuário saiu antes de assinar — nada pode pousar. */
const ABANDONO_MS = 10 * 60_000;

/**
 * ⚠️ RECONCILIAÇÃO DAS TENTATIVAS SOLANA EM ABERTO (W3, 21/10).
 *
 * Uma tentativa pode ficar `assinada`/`envio_incerto`/`pendente` se a página fechar ou o
 * acompanhamento acabar sem desfecho. Ao abrir o app (e a cada 15 s enquanto houver alguma), o
 * status on-chain é consultado PELO SERVIDOR e a etapa resolvida: confirmada (só com err nulo),
 * falhou na rede, ou expirada (o blockhash venceu sem pousar — nada pode mais executar). Status
 * desconhecido NÃO muda nada: a tentativa continua em aberto (e bloqueia nova assinatura da carteira).
 */
export async function reconciliarUma(e: TxHistoryEntry, agora = Date.now()): Promise<Partial<TxHistoryEntry> | null> {
  if (e.route !== "jupiter" || !e.etapa) return null;
  if (e.etapa === "solicitada") {
    return agora - e.ts > ABANDONO_MS ? { etapa: "cancelada", status: "canceled", motivo: "nao_assinada" } : null;
  }
  if (!ETAPAS_EM_ABERTO.has(e.etapa) || !e.txHash) return null;
  const s = await consultarStatusOnChain(e.txHash, e.validoAteBloco);
  if (s.estado === "confirmada") return { etapa: "confirmada", status: statusDaEtapa("confirmada") };
  if (s.estado === "falhou_na_rede") return { etapa: "falhou_na_rede", status: "failed", motivo: s.erro.slice(0, 120) };
  if (s.estado === "expirada") return { etapa: "expirada", status: "failed", motivo: e.motivo ?? "nao_pousou" };
  if (s.estado === "pendente" && e.etapa === "assinada") return null;   // ainda pode pousar; sem prova de envio
  return null;
}

export function useReconciliacaoSolana(): void {
  const entries = useTxHistory((s) => s.entries);
  const update = useTxHistory((s) => s.update);
  const haAberta = entries.some((e) => e.route === "jupiter" && !!e.etapa && (ETAPAS_EM_ABERTO.has(e.etapa) || e.etapa === "solicitada"));

  useEffect(() => {
    if (!haAberta) return;
    let vivo = true;
    const rodar = async () => {
      for (const e of useTxHistory.getState().entries) {
        if (!vivo) return;
        const patch = await reconciliarUma(e).catch(() => null);
        if (patch && vivo) update(e.id, patch);
      }
    };
    void rodar();
    const t = setInterval(() => { void rodar(); }, INTERVALO_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [haAberta, update]);
}
