/**
 * Formato do token de verificação — PURO (sem `node:crypto`), para que a
 * validação de corpo (`validate.ts`) possa conferir o formato sem puxar
 * módulo de servidor. Geração e hash ficam em `token.ts`.
 */
export const TOKEN_FORMATO = /^[A-Za-z0-9_-]{43}$/;

export function tokenValido(t: unknown): t is string {
  return typeof t === "string" && TOKEN_FORMATO.test(t);
}
