import type { Venda } from "./maquina";
import type { EstadoTx } from "./ciclo-tx";
import type { Contagem } from "./relogio";

/**
 * MODELO DE VISÃO DA VENDA — decide QUAL dos 14 estados a UI mostra.
 * Puro e determinístico; nenhuma chamada de rede, nenhum relógio próprio.
 *
 * ⚠️ NÃO EXISTE SUCESSO FABRICADO: `TRANSACTION_CONFIRMED` só aparece com o
 * evento de finalização do provedor (estado `confirmada`) E um id de transação.
 * Sem o id, a UI fica em `TRANSACTION_PENDING`.
 */
export const ESTADOS_UI = [
  "COMING_SOON", "ALLOWLIST_CHECK", "ELIGIBLE", "NOT_ELIGIBLE", "SALE_NOT_STARTED",
  "SALE_ACTIVE", "PAUSED", "SOLD_OUT", "ENDED", "TRANSACTION_PREPARING",
  "WALLET_CONFIRMATION", "TRANSACTION_PENDING", "TRANSACTION_CONFIRMED", "TRANSACTION_FAILED",
] as const;
export type EstadoUI = (typeof ESTADOS_UI)[number];

export type Elegibilidade = "desconhecida" | "verificando" | "elegivel" | "nao_elegivel";

export interface EntradaVisao {
  /** `null` = venda ainda não configurada (decisões do dono pendentes). */
  venda:        Venda | null;
  contagem:     Contagem;
  elegibilidade: Elegibilidade;
  tx:           EstadoTx;
  /** Id da transação devolvido pelo provedor. Obrigatório para mostrar sucesso. */
  txId:         string | null;
}

export function estadoDaUI(e: EntradaVisao): EstadoUI {
  // 1. transação em curso tem precedência — o usuário precisa ver o que está acontecendo
  switch (e.tx) {
    case "preparando":  return "TRANSACTION_PREPARING";
    case "assinando":   return "WALLET_CONFIRMATION";
    case "enviada":
    case "confirmando": return "TRANSACTION_PENDING";
    case "confirmada":  return e.txId ? "TRANSACTION_CONFIRMED" : "TRANSACTION_PENDING";
    case "falhou":
    case "expirada":
    case "rejeitada":   return "TRANSACTION_FAILED";
    case "ocioso":      break;
  }
  // 2. estado da venda
  const v = e.venda;
  if (!v || v.estado === "rascunho" || v.estado === "cancelada") return "COMING_SOON";
  if (v.estado === "esgotada") return "SOLD_OUT";
  if (v.estado === "encerrada" || e.contagem.tipo === "depois") return "ENDED";
  if (v.estado === "pausada") return "PAUSED";
  if (v.estado === "agendada" || e.contagem.tipo === "antes") return "SALE_NOT_STARTED";
  // 3. venda aberta
  if (v.estado === "allowlist_aberta") {
    if (e.elegibilidade === "elegivel") return "ELIGIBLE";
    if (e.elegibilidade === "nao_elegivel") return "NOT_ELIGIBLE";
    return "ALLOWLIST_CHECK";
  }
  return "SALE_ACTIVE";
}

/** Só estes estados oferecem a ação de mint. */
export function podeMintar(estado: EstadoUI): boolean {
  return estado === "ELIGIBLE" || estado === "SALE_ACTIVE";
}

// ── progresso: só números reais; percentual só quando é aritmética honesta ──
export interface EntradaProgresso { supply: number | null; mintados: number | null; reservados: number | null }
export type VisaoProgresso =
  | { tipo: "indisponivel" }
  | { tipo: "inconsistente" }
  | { tipo: "ok"; supply: number; mintados: number; reservados: number; disponiveis: number; percentualMintado: number };

export function visaoProgresso(p: EntradaProgresso): VisaoProgresso {
  const { supply, mintados, reservados } = p;
  if (supply === null || mintados === null || reservados === null) return { tipo: "indisponivel" };
  const inteiros = [supply, mintados, reservados].every((n) => Number.isInteger(n) && n >= 0);
  if (!inteiros || supply === 0 || mintados + reservados > supply) return { tipo: "inconsistente" };
  return {
    tipo: "ok", supply, mintados, reservados,
    disponiveis: supply - mintados - reservados,
    // arredonda para BAIXO: nunca anunciar mais vendido do que foi
    percentualMintado: Math.floor((mintados / supply) * 1000) / 10,
  };
}

// ── alocação da carteira: campos abstratos, nada inventado ──
export type StatusProva = "ausente" | "verificando" | "valida" | "invalida";
export interface EntradaAlocacao { alocacao: number | null; usado: number | null; elegibilidade: Elegibilidade; prova: StatusProva }
export interface VisaoAlocacao {
  alocacao: number | null; usado: number | null; restante: number | null;
  elegibilidade: Elegibilidade; prova: StatusProva; consistente: boolean;
}

export function visaoAlocacao(a: EntradaAlocacao): VisaoAlocacao {
  const conhecidos = a.alocacao !== null && a.usado !== null;
  const validos = conhecidos && Number.isInteger(a.alocacao) && Number.isInteger(a.usado) && a.alocacao! >= 0 && a.usado! >= 0 && a.usado! <= a.alocacao!;
  return {
    alocacao: a.alocacao, usado: a.usado,
    restante: validos ? a.alocacao! - a.usado! : null,
    elegibilidade: a.elegibilidade, prova: a.prova,
    consistente: !conhecidos || validos,
  };
}
