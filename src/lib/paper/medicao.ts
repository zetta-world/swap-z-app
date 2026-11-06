/** Corrections change the measuring instrument. Keep strategies fixed while a
 * prospective cohort is collected; legacy verdicts cannot promote this one.
 * Re-enabling requires a reviewed cohort/protocol, not elapsed wall-clock time. */
export const MEDICAO_PAPER = Object.freeze({
  versao: "paper-observed-v2",
  fase: "calibracao" as const,
  promocaoAutomatica: false,
});
