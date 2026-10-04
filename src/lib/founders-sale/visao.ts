import type { Venda } from "./maquina";
import type { EstadoTx } from "./ciclo-tx";
import type { Contagem } from "./relogio";

/**
 * MODELO DE VISÃO DA VENDA — decide QUAL estado de UI aparece. Puro e determinístico; sem rede, sem relógio
 * próprio. É PROJEÇÃO do estado autoritativo (`autoridade.ts`): o navegador não decide nada.
 *
 * ⚠️ NÃO EXISTE SUCESSO FABRICADO: `TRANSACTION_CONFIRMED` só aparece com o evento de finalização (estado
 * `confirmada`) E um id de transação. Sem o id, a UI fica em `TRANSACTION_PENDING`.
 *
 * Estados de falha (nunca beco sem saída — cada um tem ação segura na UI): WALLET_LIMIT_REACHED, WRONG_NETWORK,
 * PRICE_UNAVAILABLE, CONFIG_INVALID, UNKNOWN_STATE, ELIGIBILITY_PENDING (política jurídica/do dono pendente).
 */
export const ESTADOS_UI = [
  "COMING_SOON", "APPLICATION_OPEN", "ALLOWLIST_CHECK", "ELIGIBLE", "NOT_ELIGIBLE", "ELIGIBILITY_PENDING",
  "SALE_NOT_STARTED", "SALE_ACTIVE", "PAUSED", "SOLD_OUT", "ENDED", "WALLET_LIMIT_REACHED", "WRONG_NETWORK",
  "PRICE_UNAVAILABLE", "CONFIG_INVALID", "UNKNOWN_STATE", "TRANSACTION_PREPARING", "WALLET_CONFIRMATION",
  "TRANSACTION_PENDING", "TRANSACTION_CONFIRMED", "TRANSACTION_FAILED",
] as const;
export type EstadoUI = (typeof ESTADOS_UI)[number];

export type Elegibilidade = "desconhecida" | "verificando" | "elegivel" | "nao_elegivel" | "pendente_juridico" | "pendente_politica";

export interface EntradaVisao {
  /** `null` = venda ainda não configurada (decisões do dono pendentes). */
  venda:        Venda | null;
  contagem:     Contagem;
  elegibilidade: Elegibilidade;
  tx:           EstadoTx;
  /** Id da transação devolvido pelo provedor. Obrigatório para mostrar sucesso. */
  txId:         string | null;
  /** Configuração da venda inválida (fingerprint divergente, validação falhou) — fecha tudo. */
  configValida?: boolean;
  /** Carteira conectada na rede errada. */
  redeErrada?: boolean;
  /** Preço congelado da fase disponível? (`false` = referência indisponível/velha). */
  precoDisponivel?: boolean;
  /** Unidades restantes da alocação da carteira neste tier (null = desconhecido). */
  restante?: number | null;
}

const ESTADOS_VENDA_CONHECIDOS = new Set(["rascunho", "inscricao_aberta", "allowlist_congelada", "allowlist_aberta", "publica_aberta", "pausada", "esgotada", "encerrada", "cancelada"]);

export function estadoDaUI(e: EntradaVisao): EstadoUI {
  if (e.configValida === false) return "CONFIG_INVALID";
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
    default:            return "UNKNOWN_STATE";
  }
  // 2. estado da venda
  const v = e.venda;
  if (!v || v.estado === "rascunho") return "COMING_SOON";
  if (!ESTADOS_VENDA_CONHECIDOS.has(v.estado)) return "UNKNOWN_STATE";
  if (v.estado === "cancelada" || v.estado === "encerrada" || e.contagem.tipo === "depois") return "ENDED";
  if (v.estado === "esgotada") return "SOLD_OUT";
  if (v.estado === "pausada") return "PAUSED";
  if (v.estado === "inscricao_aberta") return "APPLICATION_OPEN";
  if (v.estado === "allowlist_congelada" || e.contagem.tipo === "antes") return "SALE_NOT_STARTED";
  // 3. venda aberta
  if (e.redeErrada) return "WRONG_NETWORK";
  if (e.precoDisponivel === false) return "PRICE_UNAVAILABLE";
  if (e.elegibilidade === "pendente_juridico" || e.elegibilidade === "pendente_politica") return "ELIGIBILITY_PENDING";
  if (v.estado === "allowlist_aberta") {
    if (e.elegibilidade === "nao_elegivel") return "NOT_ELIGIBLE";
    if (e.elegibilidade !== "elegivel") return "ALLOWLIST_CHECK";
    return e.restante === 0 ? "WALLET_LIMIT_REACHED" : "ELIGIBLE";
  }
  if (e.elegibilidade === "nao_elegivel") return "NOT_ELIGIBLE";
  return e.restante === 0 ? "WALLET_LIMIT_REACHED" : "SALE_ACTIVE";
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
