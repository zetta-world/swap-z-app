import { randomInt } from "node:crypto";

/**
 * CÓDIGOS DE INDICAÇÃO — CSPRNG, alfabeto fechado, tamanho fixo.
 *
 * Crockford base32 (sem I, L, O, U): nada que se confunda lendo em voz alta ou
 * copiando à mão. 10 caracteres = 32¹⁰ ≈ 1,1 × 10¹⁵ — adivinhar um código
 * existente é impraticável, e mesmo assim a rota nunca diz se um código vale.
 *
 * `randomInt` é CSPRNG e sem viés de módulo. A colisão (improvável) é tratada
 * pela RPC `early_access_inscrever`, que tenta os candidatos em ordem e falha
 * explicitamente se todos colidirem — retry LIMITADO, nunca laço infinito.
 *
 * ⚠️ NÃO HÁ RECOMPENSA POR INDICAÇÃO NESTA FASE. O vínculo é só registro; um
 * prêmio financeiro por indicação tem implicação jurídica própria.
 */
export const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const TAMANHO = 10;
export const CANDIDATOS = 5;

export function gerarCodigo(): string {
  let s = "";
  for (let i = 0; i < TAMANHO; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return s;
}

/** Candidatos DISTINTOS, para a RPC tentar em ordem. */
export function gerarCandidatos(n = CANDIDATOS): string[] {
  const out = new Set<string>();
  while (out.size < n) out.add(gerarCodigo());
  return [...out];
}
