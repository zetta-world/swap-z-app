/**
 * O IMPACTO DE PREÇO, EM UM LUGAR SÓ.
 *
 * ⚠️⚠️ ACHADO A21 DA AUDITORIA EXTERNA: a proteção de impacto media uma cotação
 * e o usuário assinava outra.
 *
 * O `SwapCard` calcula o impacto a partir da cotação INDICATIVA e trava o botão
 * com ele. Ao abrir, o `ExecuteSwap` busca uma cotação FIRME — e, no caminho do
 * 0x, uma TERCEIRA logo antes de enviar, porque *"calldata embeds pricing and
 * goes stale fast"*. Nenhuma das duas era conferida.
 *
 * Em pool raso é exatamente aí que o número se move. O usuário passava por um
 * impacto de 1% e assinava um de 40% — a guarda existia, media a coisa certa, e
 * apontava para a cotação errada. Mesma família do A13, onde a venda conferia o
 * símbolo e mandava outra quantidade.
 *
 * ⚠️ E A FÓRMULA MORAVA INLINE NUM `useMemo`. Recalculá-la à mão no outro lado
 * seria a segunda validação do mesmo campo — o que o `lerCiclos` do DCA já
 * nomeia como a porta dos fundos por onde valor impossível entra. Aqui ela é
 * uma função só, e os dois lados a chamam.
 */

/**
 * Quanto se perde entre o que entra e o que sai, em porcento.
 *
 * ⚠️ NEGATIVO É PERDA e positivo é ganho — a mesma convenção que `assessImpact`
 * espera receber (ele faz `Math.max(0, -impactPct)`).
 *
 * ⚠️ SEM PREÇO É `null`, NUNCA 0 (invariante nº 33). Zero aqui seria a
 * afirmação "não há impacto", e o que houve foi o feed não responder — e um
 * zero PASSA em todo limiar de bloqueio, silenciosamente.
 */
export function impactoPct(entradaUsd: number | null, saidaUsd: number | null): number | null {
  if (entradaUsd == null || saidaUsd == null) return null;
  if (!Number.isFinite(entradaUsd) || !Number.isFinite(saidaUsd)) return null;
  if (!(entradaUsd > 0) || !(saidaUsd > 0)) return null;
  return ((saidaUsd - entradaUsd) / entradaUsd) * 100;
}

export interface Lados {
  /** Quantidade que sai da carteira, em unidades do token (não base units). */
  entradaDec:      number | null;
  /** Quantidade que a cotação promete entregar, em unidades do token. */
  saidaDec:        number | null;
  precoEntradaUsd: number | null;
  precoSaidaUsd:   number | null;
}

export interface Impacto {
  impactoPct: number | null;
  entradaUsd: number | null;
  saidaUsd:   number | null;
}

/**
 * O impacto de UMA cotação concreta. Quem chama passa a cotação que vai valer:
 * a indicativa na tela, a firme no modal.
 */
export function impactoDaCotacao(p: Lados): Impacto {
  const ok = (n: number | null): n is number => n != null && Number.isFinite(n) && n > 0;
  const entradaUsd = ok(p.entradaDec) && ok(p.precoEntradaUsd) ? p.entradaDec * p.precoEntradaUsd : null;
  const saidaUsd   = ok(p.saidaDec)   && ok(p.precoSaidaUsd)   ? p.saidaDec   * p.precoSaidaUsd   : null;
  return { impactoPct: impactoPct(entradaUsd, saidaUsd), entradaUsd, saidaUsd };
}
