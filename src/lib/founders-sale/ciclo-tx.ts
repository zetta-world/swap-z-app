/**
 * ESTADOS DE UI DO CICLO DA TRANSAÇÃO DE MINT — independentes de carteira/chain.
 * Só transições da matriz; o resto é ignorado (a UI nunca "pula" de ocioso para confirmada).
 */
export type EstadoTx = "ocioso" | "assinando" | "enviada" | "confirmando" | "confirmada" | "falhou" | "expirada" | "rejeitada";
export type EventoTx = "iniciar" | "assinou" | "recusou_assinar" | "transmitida" | "incluida" | "finalizada" | "erro" | "tempo_esgotado" | "reiniciar";

const M: Record<EstadoTx, Partial<Record<EventoTx, EstadoTx>>> = {
  ocioso:      { iniciar: "assinando" },
  assinando:   { assinou: "enviada", recusou_assinar: "rejeitada", erro: "falhou" },
  enviada:     { transmitida: "confirmando", erro: "falhou", tempo_esgotado: "expirada" },
  confirmando: { incluida: "confirmando", finalizada: "confirmada", erro: "falhou", tempo_esgotado: "expirada" },
  confirmada:  {},
  falhou:      { reiniciar: "ocioso" },
  expirada:    { reiniciar: "ocioso" },
  rejeitada:   { reiniciar: "ocioso" },
};

export function proximoEstado(atual: EstadoTx, e: EventoTx): EstadoTx {
  return M[atual][e] ?? atual;
}

export function terminal(e: EstadoTx): boolean {
  return e === "confirmada";
}
