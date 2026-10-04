/**
 * ESTADOS DE UI DO CICLO DA TRANSAÇÃO DE MINT — independentes de carteira/chain.
 * Só transições da matriz; o resto é ignorado (a UI nunca "pula" de ocioso para confirmada).
 *
 * `preparando` = montando a intenção (reserva/prova) ANTES de pedir assinatura.
 * `confirmada` exige um evento `finalizada` do provedor — e a camada de visão
 * ainda exige o id da transação (`visao.ts`): não existe sucesso fabricado.
 */
export type EstadoTx =
  | "ocioso" | "preparando" | "assinando" | "enviada" | "confirmando"
  | "confirmada" | "falhou" | "expirada" | "rejeitada";
export type EventoTx =
  | "iniciar" | "preparado" | "assinou" | "recusou_assinar" | "transmitida"
  | "incluida" | "finalizada" | "erro" | "tempo_esgotado" | "reiniciar";

const M: Record<EstadoTx, Partial<Record<EventoTx, EstadoTx>>> = {
  ocioso:      { iniciar: "preparando" },
  preparando:  { preparado: "assinando", erro: "falhou" },
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
