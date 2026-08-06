/**
 * POR QUE ESTA MESA ESTÁ CALADA — a leitura que faltava no painel.
 *
 * ⚠️ DE ONDE VEIO (06/08).
 *
 * A URÐR aparecia no painel com zero trades e caixa intacto. Qualquer um que
 * olhasse concluiria "quebrada" ou "esqueceram de ligar". O rastro dizia outra
 * coisa: 142 ticks, 15 com oferta, e nas 15 `vetoedByRecord: 1`.
 *
 * Ou seja — a mesa cujo mandato é escolher pelo HISTÓRICO MEDIDO recebeu
 * candidatos e recusou todos, porque o histórico da biblioteca é negativo.
 * **Ela é a única mesa fazendo exatamente o que deveria**, e no painel parecia
 * a mais morta de todas.
 *
 * Eu mesmo quase errei o diagnóstico: olhei UM tick, vi `offered: 0`, e ia
 * reportar "desconectada". Com os 142 a resposta é o contrário.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A DISTINÇÃO QUE ESTE MÓDULO EXISTE PARA FAZER:
 *
 *   silêncio por DISCIPLINA  → a mesa recebeu e recusou. É o sistema funcionando.
 *   silêncio por FOME        → sem caixa acima do piso, ela não consegue abrir.
 *   silêncio por SECA        → nada chegou. Pode ser o mercado ou a fonte.
 *   silêncio por QUEBRA      → o tick registrou erro.
 *   silêncio SEM RASTRO      → não há tick nenhum. Não dá para julgar.
 *
 * Os cinco parecem iguais numa tela que só mostra "0 trades". Três deles pedem
 * ação oposta: fome se conserta com capital, quebra com código, disciplina com
 * NADA — e desligar a mesa disciplinada seria desligar a única certa.
 *
 * ⚠️ E o quinto é o pior: sem rastro, qualquer veredito é chute. Não se
 * aposenta o que não se consegue diagnosticar.
 */

/** O que um tick de mesa reporta, no formato comum às fontes. */
export interface DeskTick {
  /** Quantos candidatos chegaram. */
  offered?: number | null;
  /** Quantos viraram posição. */
  taken?: number | null;
  /** Quantos foram recusados pelo histórico medido. */
  vetoedByRecord?: number | null;
  /** Motivos de descarte, quando a fonte os reporta. */
  skipped?: Array<{ symbol: string; reason: string }> | null;
  /** A mesa quebrou neste tick. */
  erro?: string | null;
}

export type SilenceKind =
  | "disciplina"   // recebeu e recusou — o sistema funcionando
  | "fome"         // sem caixa para abrir
  | "seca"         // nada chegou
  | "quebra"       // o tick registrou erro
  | "sem_rastro"   // não há tick — não dá para julgar
  | "operando";    // não está calada

export interface SilenceVerdict {
  kind: SilenceKind;
  /** Uma frase para a tela. Curta: cabe embaixo do nome da mesa. */
  label: string;
  /** O que fazer a respeito — ou explicitamente nada. */
  action: string;
  /** Isto reprova a mesa? Disciplina NÃO reprova. */
  isProblem: boolean;
}

/** Piso abaixo do qual `sizePosition` devolve 0 e a mesa para sem avisar. */
export const MIN_CASH_USD = 25;

/**
 * Lê o silêncio de uma mesa a partir dos ticks recentes e do caixa.
 *
 * ⚠️ `ticks` é uma JANELA, não um tick. Um tick isolado não distingue "seca de
 * agora" de "seca sempre" — foi exatamente o erro que quase cometi com a URÐR.
 * Por isso a assinatura pede a lista, e não o último.
 */
export function readSilence(
  ticks: DeskTick[],
  cashUsd: number,
  openPositions: number,
  closedPositions: number,
): SilenceVerdict {
  if (openPositions > 0 || closedPositions > 0) {
    return { kind: "operando", label: "operando", action: "", isProblem: false };
  }

  // Sem tick nenhum, qualquer veredito seria chute — e é o pior estado dos
  // cinco justamente porque parece igual aos outros.
  if (ticks.length === 0) {
    return {
      kind: "sem_rastro",
      label: "sem rastro — não dá para julgar",
      action: "a mesa precisa emitir tick antes de qualquer veredito",
      isProblem: true,
    };
  }

  // Quebra vence os outros: uma mesa que estoura não chegou a decidir nada.
  const comErro = ticks.filter((t) => t.erro);
  if (comErro.length > 0) {
    return {
      kind: "quebra",
      label: `quebrou em ${comErro.length} de ${ticks.length} ticks`,
      action: `último erro: ${String(comErro[0].erro).slice(0, 120)}`,
      isProblem: true,
    };
  }

  // Fome vem antes de seca: sem caixa a mesa não abriria nem se recebesse.
  if (cashUsd < MIN_CASH_USD) {
    return {
      kind: "fome",
      label: `sem caixa — $${cashUsd.toFixed(2)} abaixo do piso de $${MIN_CASH_USD}`,
      action: "recapitalizar, ou aposentar se a rodada dela acabou",
      isProblem: true,
    };
  }

  const ofertas = ticks.reduce((s, t) => s + (t.offered ?? 0), 0);
  const vetos = ticks.reduce((s, t) => s + (t.vetoedByRecord ?? 0), 0);

  /**
   * ⚠️ DISCIPLINA NÃO É PROBLEMA, e esta é a linha mais importante do módulo.
   *
   * Recebeu candidatos e recusou todos por veto do histórico é a mesa
   * cumprindo o mandato dela. A URÐR existe para obedecer ao que foi MEDIDO,
   * e o medido é negativo — operar seria o defeito, não o silêncio.
   */
  if (ofertas > 0 && vetos >= ofertas) {
    return {
      kind: "disciplina",
      label: `recusou ${vetos} de ${ofertas} — histórico medido negativo`,
      action: "nada a fazer: é a mesa cumprindo o mandato dela",
      isProblem: false,
    };
  }

  if (ofertas > 0) {
    return {
      kind: "disciplina",
      label: `${ofertas} oferta(s), nenhuma tomada`,
      action: "conferir por que o bracket não fechou — o veto não foi do histórico",
      isProblem: true,
    };
  }

  // Chegou aqui: ticks existem, sem erro, com caixa, e zero ofertas em todos.
  const motivos = ticks.flatMap((t) => t.skipped ?? []);
  return {
    kind: "seca",
    label: `nenhum candidato em ${ticks.length} ticks`,
    action: motivos.length > 0
      ? `motivos: ${[...new Set(motivos.map((m) => m.reason))].slice(0, 3).join(" · ")}`
      : "a fonte não reporta motivo — pode ser mercado ou pode ser a fonte caída",
    isProblem: motivos.length === 0,
  };
}
