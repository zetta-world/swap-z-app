import { createHash, randomBytes } from "node:crypto";
import { tokenValido } from "./token-formato";

export { TOKEN_FORMATO, tokenValido } from "./token-formato";

/**
 * TOKEN DE VERIFICAÇÃO DE EMAIL (Fase 2, F-01) — só servidor.
 *
 * ⚠️⚠️ O TOKEN CRU NUNCA É PERSISTIDO. Ele nasce aqui, vira hash para o banco
 * (`early_access_verificacoes.token_hash`) e só existe em claro dentro do link
 * do email. Nem log, nem evento, nem `logSecurity` recebem o token ou o hash.
 *
 * · 32 bytes de CSPRNG → base64url sem padding (43 caracteres). 256 bits:
 *   adivinhar é inviável, e por isso o hash em repouso pode ser SHA-256 sem
 *   segredo — trocar `EARLY_ACCESS_HMAC_SECRET` não pode matar links em trânsito.
 * · Separação de domínio no hash: o mesmo valor nunca colide com outro uso.
 * · O formato é conferido ANTES de qualquer acesso ao banco: lixo não custa query.
 *
 * TTL (24 h), uso único e "um ativo por inscrição" são invariantes do BANCO
 * (0069), não daqui — a aplicação não tem como estendê-los.
 */
export const TOKEN_BYTES = 32;
export const HASH_FORMATO = /^[0-9a-f]{64}$/;

/** Espelho documental das constantes da 0069 (a verdade está no SQL; um teste compara). */
export const TOKEN_TTL_HORAS = 24;
export const RETENCAO_NAO_VERIFICADO_DIAS = 7;

export function gerarToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** sha256("zswap-ea:verify\0" + token), hex. Recusa token fora do formato. */
export function hashToken(token: string): string | null {
  if (!tokenValido(token)) return null;
  return createHash("sha256").update(`zswap-ea:verify\u0000${token}`).digest("hex");
}
