/**
 * CONFIGURAÇÃO DO EMAIL DO EARLY ACCESS — só servidor, só `process.env`.
 *
 * ⚠️ NENHUM VALOR MORA NO CÓDIGO. Os nomes estão em `docs/RUNBOOK.md`; os
 * valores reais só entram por mecanismo server-side autorizado pelo dono
 * (D-1/D-2). Sem configuração VÁLIDA completa, `configEmail()` é `null` e o
 * gate do early access FECHA (5ª condição de `gate.ts`): sem como provar
 * posse de email, não se coleta email.
 *
 * ⚠️ O LINK NUNCA VEM DA REQUISIÇÃO. A base é `EARLY_ACCESS_PUBLIC_BASE_URL`,
 * https, sem caminho/consulta/fragmento. Montar o link com `Host` ou
 * `X-Forwarded-Host` deixaria qualquer um mandar, pelo NOSSO remetente, um
 * link de confirmação apontando para o domínio dele (envenenamento de link).
 *
 * Provider aprovado: RESEND (D-1). Região de ENVIO `sa-east-1` é configuração
 * do domínio no painel do Resend, não desta aplicação; o armazenamento do
 * provider é nos EUA (D-9, Política de Privacidade).
 */
export const PROVEDORES = ["resend"] as const;
export type Provedor = (typeof PROVEDORES)[number];

export interface ConfigEmail {
  provedor: Provedor;
  apiKey:   string;
  from:     string;
  /** Origem https, sem barra final. */
  baseUrl:  string;
}

const API_KEY_RESEND = /^re_[A-Za-z0-9_-]{16,200}$/;
const ENDERECO = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** "addr@dominio" ou "Nome <addr@dominio>". Sem CR/LF nem controle (injeção de cabeçalho). */
export function remetenteValido(s: string | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (t.length === 0 || t.length > 200 || /[\u0000-\u001f\u007f]/.test(t)) return null;
  const m = /^(?:([^<>"]{1,100}) )?<([^<>\s]+)>$/.exec(t);
  const endereco = m ? m[2] : t;
  return ENDERECO.test(endereco) ? t : null;
}

export function baseUrlValida(s: string | undefined): string | null {
  if (typeof s !== "string" || s.trim() === "") return null;
  let u: URL;
  try { u = new URL(s.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return null;
  return u.origin;
}

export function configEmail(env: NodeJS.ProcessEnv = process.env): ConfigEmail | null {
  if (env.EARLY_ACCESS_EMAIL_PROVIDER !== "resend") return null;
  const apiKey = env.EARLY_ACCESS_RESEND_API_KEY?.trim();
  if (!apiKey || !API_KEY_RESEND.test(apiKey)) return null;
  const from = remetenteValido(env.EARLY_ACCESS_EMAIL_FROM);
  if (!from) return null;
  const baseUrl = baseUrlValida(env.EARLY_ACCESS_PUBLIC_BASE_URL);
  if (!baseUrl) return null;
  return { provedor: "resend", apiKey, from, baseUrl };
}

export function emailConfigurado(): boolean {
  return configEmail() !== null;
}

/**
 * Segredo do webhook do Resend (Svix): `whsec_` + base64. A CHAVE do HMAC são
 * os bytes decodificados. Inválido ou ausente → `null` e o webhook recusa
 * TUDO (nenhum estado muda sem autenticação — D-10).
 */
export function segredoWebhook(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const s = env.EARLY_ACCESS_RESEND_WEBHOOK_SECRET?.trim();
  if (!s || !s.startsWith("whsec_")) return null;
  const b64 = s.slice(6);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) return null;
  const bytes = Buffer.from(b64, "base64");
  if (bytes.toString("base64") !== b64 || bytes.length < 24) return null;
  return bytes;
}
