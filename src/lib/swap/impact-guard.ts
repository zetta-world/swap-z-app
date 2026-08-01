/**
 * GUARDA DE IMPACTO DE PREÇO — a perda que o usuário assina sem perceber.
 *
 * O QUE ESTAVA ERRADO (achado na auditoria de 30/07):
 *
 * O impacto de preço era exibido e COLORIDO — verde abaixo de 0,5%, dourado até
 * 2%, vermelho acima. E era só isso. Nada impedia a execução. Um swap com 40%
 * de impacto ficava vermelho e seguia em frente com um clique.
 *
 * Texto vermelho não é proteção. Para quem "não pode perder nem US$100", perder
 * US$40 num clique porque a cor mudou é exatamente a falha que o disclaimer não
 * cobre — e a plataforma sabia o número antes de deixar acontecer.
 *
 * A REGRA AQUI:
 *   · abaixo de AVISO      → segue (o custo é normal do mercado)
 *   · entre AVISO e BLOQUEIO → segue, mas o usuário precisa CONFIRMAR o valor
 *     em dinheiro que está perdendo, escrito em dólar, não em porcentagem
 *   · acima de BLOQUEIO    → RECUSA. Em pool raso, impacto assim quase sempre é
 *     erro de digitação no valor ou token sem liquidez, não intenção.
 *
 * Por que em DÓLAR e não em porcentagem: "3% de impacto" não dói; "você perde
 * $37 nesta troca" dói — e é a mesma informação. Porcentagem é a unidade que
 * deixa o usuário aceitar o que não aceitaria se visse o valor.
 */

/** Acima disto, exige confirmação explícita do valor perdido. */
export const IMPACT_WARN_PCT = Number(process.env.NEXT_PUBLIC_IMPACT_WARN_PCT ?? 2);
/** Acima disto, recusa: é quase sempre erro, não intenção. */
export const IMPACT_BLOCK_PCT = Number(process.env.NEXT_PUBLIC_IMPACT_BLOCK_PCT ?? 15);

export type ImpactLevel = "ok" | "warn" | "block";

export interface ImpactVerdict {
  level: ImpactLevel;
  /** Perda estimada em dólar — o número que o usuário realmente entende. */
  lossUsd: number | null;
  /** Frase pronta, em dinheiro. Vazia quando `ok`. */
  message: string;
}

/**
 * Avalia o impacto. `impactPct` negativo (preço a favor) nunca bloqueia — só a
 * perda importa; ganho inesperado não é risco para quem está trocando.
 */
export function assessImpact(impactPct: number | null, notionalUsd: number | null): ImpactVerdict {
  if (impactPct == null || !Number.isFinite(impactPct)) {
    return { level: "ok", lossUsd: null, message: "" };
  }
  // Só perda conta. Impacto positivo a favor do usuário não é motivo de alarme.
  const loss = Math.max(0, -impactPct);
  const lossUsd = notionalUsd != null && notionalUsd > 0 ? (notionalUsd * loss) / 100 : null;
  const money = lossUsd != null ? `$${lossUsd.toFixed(2)}` : `${loss.toFixed(1)}%`;

  if (loss >= IMPACT_BLOCK_PCT) {
    return {
      level: "block", lossUsd,
      message: `Troca bloqueada: você perderia ${money} (${loss.toFixed(1)}%) só no impacto de preço. `
        + "Isso quase sempre significa valor digitado errado ou token sem liquidez. Reduza o valor ou escolha outro par.",
    };
  }
  if (loss >= IMPACT_WARN_PCT) {
    return {
      level: "warn", lossUsd,
      message: `Atenção: você perde ${money} (${loss.toFixed(1)}%) no impacto de preço desta troca. Confirme para seguir.`,
    };
  }
  return { level: "ok", lossUsd, message: "" };
}

/** Conveniência para o caminho de execução: pode assinar? */
export function impactBlocks(impactPct: number | null): boolean {
  return assessImpact(impactPct, null).level === "block";
}
