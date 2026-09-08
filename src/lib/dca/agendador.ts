/**
 * ⚠️⚠️ O QUE A TELA PODE DIZER SOBRE O AGENDADOR DO DCA — 08/09.
 *
 * ACHADO CAÇANDO "tela afirma sobre A o que só é verdade sobre B", e este é o
 * caso com DINHEIRO REAL do cliente dentro.
 *
 * O painel decidia entre "vivo" e "parado" com UM número: há quantos minutos o
 * cron passou. Só que o cron do DCA grava o heartbeat ANTES de ler o gate — de
 * propósito, para que o watchdog não acuse "cron parado" quando a causa é uma
 * trava nossa. Consequência: com `pause_dca` ligado, o cron passa a cada 5 min,
 * carimba, lê a trava e volta sem executar NADA — e o cliente lia
 * *"Agendador vivo — última passada há 3 min"* sobre uma fila congelada.
 *
 * "Passou" e "executa" são coisas diferentes. Um agendador pausado NÃO é um
 * agendador vivo, e também não é um agendador parado: é um terceiro estado,
 * cuja causa é nossa e cuja explicação o cliente merece — ele está com o
 * orçamento comprometido esperando ordens que não vão sair.
 *
 * ⚠️ E A PAUSA GANHA DO RELÓGIO. Se as duas coisas forem verdade — pausado E
 * sem passar há muito tempo —, o que o cliente precisa ler primeiro é que a
 * casa parou a execução. É a informação que muda o que ele faz agora.
 */

export type EstadoDoAgendador =
  /** A casa travou a execução. O cron até passa; ele não executa. */
  | "pausado"
  /** Nunca passou. ⚠️ NÃO é "passou e faz tempo" — não existe agendador. */
  | "nunca"
  /** Passou, mas faz tempo demais para a janela de 5 min do cron. */
  | "parado"
  /** Passou agora há pouco e nada o trava: aí sim, executa. */
  | "vivo";

/**
 * ⚠️ VINTE MINUTOS sobre um cron de 5: quatro passadas perdidas. Um único
 * atraso da Vercel não pode pintar a tela de vermelho, e uma hora de silêncio
 * não pode passar por normal.
 */
export const MINUTOS_ATE_PARADO = 20;

export function estadoDoAgendador(
  cron: { haMinutos: number | null; pausado?: boolean } | null,
): EstadoDoAgendador | null {
  // ⚠️ `null` = a rota nem respondeu ainda. Não é "vivo" nem "parado", e
  // afirmar qualquer um dos dois durante o carregamento seria inventar.
  if (!cron) return null;
  if (cron.pausado === true) return "pausado";
  // ⚠️ `null` = NUNCA rodou, e `Number(null)` seria 0 — "passou agora".
  if (cron.haMinutos == null) return "nunca";
  return cron.haMinutos > MINUTOS_ATE_PARADO ? "parado" : "vivo";
}

/** Só um estado autoriza a tela a dizer que as ordens vão sair. */
export function agendadorExecuta(e: EstadoDoAgendador | null): boolean {
  return e === "vivo";
}
