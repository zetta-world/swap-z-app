import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * SESSÃO ADMIN CORPORATIVA — primitivas (R1, Admin CC 2.0). NADA AQUI ESTÁ LIGADO.
 *
 * ⚠️ Enquanto `ADMIN_AUTH_MODE` estiver ausente (= legacy), nenhum caminho usa
 * este módulo: login corporativo (Google/Microsoft via Supabase Auth PKCE) e
 * MFA TOTP (aal2) dependem de IdP, contas reais e da migration 0083 aplicada —
 * BLOQUEADO até autorização do dono (docs/ADMIN-SSO-MFA-RBAC-DESIGN.md §9).
 * O que existe é o que não depende de nada disso, testado:
 *
 *   · token opaco `za1_` + 32 bytes aleatórios (base64url); o banco guarda só
 *     o SHA-256 (`admin_sessions.token_hash`, 32 bytes) — vazamento da tabela
 *     não entrega sessão;
 *   · cookie `__Host-zswap_admin`: Secure, HttpOnly, SameSite=Strict, Path=/,
 *     sem Domain (o prefixo __Host- exige isso no navegador);
 *   · validade: expiração ABSOLUTA e por INATIVIDADE, MFA obrigatório para
 *     sessão corp ativa, step-up com janela própria — tudo fail-closed.
 */

export const COOKIE_ADMIN = "__Host-zswap_admin";
export const PREFIXO_TOKEN = "za1_";

/** Padrões do desenho §4.4 (ajustáveis por env quando R1 entrar). */
export const DURACAO_ABSOLUTA_S = 8 * 3600;
export const INATIVIDADE_S = 30 * 60;
export const JANELA_STEP_UP_S = 5 * 60;

export function novoTokenDeSessao(): string {
  return PREFIXO_TOKEN + randomBytes(32).toString("base64url");
}

/** Formato antes de qualquer hash/consulta: lixo nunca chega ao banco. */
export function formatoDeTokenValido(t: unknown): t is string {
  return typeof t === "string" && /^za1_[A-Za-z0-9_-]{43}$/.test(t);
}

export function hashDoToken(t: string): Buffer {
  return createHash("sha256").update(t, "utf8").digest();
}

/** Comparação em tempo constante (hash × hash, mesmo tamanho). */
export function hashesIguais(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function atributosDoCookie(maxAgeS = DURACAO_ABSOLUTA_S): {
  name: string; httpOnly: true; secure: true; sameSite: "strict"; path: "/"; maxAge: number;
} {
  return { name: COOKIE_ADMIN, httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: maxAgeS };
}

export interface SessaoLida {
  kind: "corp" | "breakglass";
  state: "mfa_pending" | "active";
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
  idleTimeoutS: number;
  aal: "aal1" | "aal2" | null;
  mfaVerifiedAt: number | null;
  stepUpAt: number | null;
  revokedAt: number | null;
}

export type Veredito =
  | { ok: true; precisaStepUp: boolean }
  | { ok: false; motivo: "revogada" | "expirada" | "inativa" | "mfa_pendente" | "sem_mfa" | "relogio_invalido" };

/**
 * A sessão vale AGORA? Ordem fixa, primeira falha decide. Qualquer campo
 * incoerente (tempo não finito, criada no futuro) = inválida: na dúvida, fecha.
 */
export function avaliarSessao(s: SessaoLida, agoraMs: number, exigeStepUp = false): Veredito {
  const tempos = [s.createdAt, s.lastSeenAt, s.absoluteExpiresAt, agoraMs];
  if (tempos.some((t) => !Number.isFinite(t)) || s.createdAt > agoraMs + 60_000) return { ok: false, motivo: "relogio_invalido" };
  if (s.revokedAt != null) return { ok: false, motivo: "revogada" };
  if (agoraMs >= s.absoluteExpiresAt) return { ok: false, motivo: "expirada" };
  if (agoraMs - s.lastSeenAt > s.idleTimeoutS * 1000) return { ok: false, motivo: "inativa" };
  if (s.state !== "active") return { ok: false, motivo: "mfa_pendente" };
  if (s.kind === "corp" && (s.aal !== "aal2" || s.mfaVerifiedAt == null)) return { ok: false, motivo: "sem_mfa" };
  const stepUpValido = s.stepUpAt != null && agoraMs - s.stepUpAt <= JANELA_STEP_UP_S * 1000;
  return { ok: true, precisaStepUp: exigeStepUp && !stepUpValido };
}
