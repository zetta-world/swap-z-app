import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";

/**
 * SELO E CIFRA DO LOGIN CORPORATIVO (R1, design §4.2/§4.8).
 *
 *   · cookie do FLUXO PKCE (`__Host-zswap_admin_flow`): JWE `dir`/A256GCM — o verificador PKCE, o
 *     provedor e o nonce viajam no navegador SEM poder ser lidos nem alterados; validade curta;
 *   · REFRESH TOKEN do Supabase no banco: AES-256-GCM com AAD = id da sessão admin — a cifra de uma
 *     linha não serve em outra (copiar a coluna entre linhas falha na abertura).
 * Chave: `ADMIN_SESSION_ENC_KEY` (32 bytes). Nada aqui loga ou devolve o conteúdo em erro.
 */
export interface DadosFluxo {
  verificador: string;
  provedor: "google" | "azure";
  nonce: string;
  volta: string;
}

const ALVO = "zswap-admin-fluxo";

export async function selarFluxo(d: DadosFluxo, chave: Buffer, ttlS: number, agoraS = Math.floor(Date.now() / 1000)): Promise<string> {
  return new EncryptJWT({ ...d })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(agoraS)
    .setExpirationTime(agoraS + ttlS)
    .setAudience(ALVO)
    .encrypt(chave);
}

/** `null` em QUALQUER problema: adulterado, expirado, outra chave, formato. */
export async function abrirFluxo(token: string | undefined, chave: Buffer, agoraS = Math.floor(Date.now() / 1000)): Promise<DadosFluxo | null> {
  if (!token || token.length > 4096) return null;
  try {
    const { payload } = await jwtDecrypt(token, chave, { audience: ALVO, currentDate: new Date(agoraS * 1000) });
    const p = payload as Partial<DadosFluxo>;
    if (typeof p.verificador !== "string" || typeof p.nonce !== "string" || typeof p.volta !== "string") return null;
    if (p.provedor !== "google" && p.provedor !== "azure") return null;
    return { verificador: p.verificador, provedor: p.provedor, nonce: p.nonce, volta: p.volta };
  } catch {
    return null;
  }
}

/** iv(12) | tag(16) | cifra. */
export function cifrarComAad(texto: string, chave: Buffer, aad: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const corpo = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), corpo]);
}

export function decifrarComAad(blob: Buffer | null | undefined, chave: Buffer, aad: string): string | null {
  if (!blob || blob.length < 29) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", chave, blob.subarray(0, 12));
    d.setAAD(Buffer.from(aad, "utf8"));
    d.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Caminho de volta: só relativo e dentro do Admin. Qualquer outra coisa vira `/admin`. */
export function voltaSegura(v: unknown): string {
  if (typeof v !== "string" || !v.startsWith("/admin") || v.startsWith("//") || v.includes("\\") || v.length > 200) return "/admin";
  return v;
}
