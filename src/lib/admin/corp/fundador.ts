import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { avaliarSessao, formatoDeTokenValido, hashDoToken } from "@/lib/admin/sessao-corporativa";
import { novoCodigoDeAtivacao } from "./fluxo";
import { repoCorp, type LinhaAuditoria, type SessaoLinha } from "./repo";
import { repoGovernanca } from "./governanca-repo";

/**
 * SOLO FOUNDER MODE — bootstrap, recuperação e transição (`docs/ADMIN-SOLO-FOUNDER-MODE.md`).
 *
 * O bootstrap SUBSTITUI as 3 identidades da 0083 por FATORES SIMULTÂNEOS, nenhum suficiente sozinho:
 *   1. configuração do servidor nomeia o fundador (`ADMIN_FOUNDER_EMAIL`, nunca `NEXT_PUBLIC_*`);
 *   2. identidade corporativa ativa, vinculada por provider+sub, com TOTP matriculado;
 *   3. sessão `aal2` com step-up nos últimos 5 min (MFA recente);
 *   4. autorização operacional de uso único `zfb_…`, gerada OFFLINE pelo dono; a Vercel guarda só o
 *      sha256 e uma janela ≤ 24 h — independente da sessão que recebe o privilégio;
 *   5. a RPC `admin_private.founder_bootstrap` re-confere tudo no banco, sob trava, e grava tudo ou nada.
 *
 * Toda recusa devolve o MESMO código genérico ao navegador; o motivo real vai para `admin_audit` e
 * para um evento de segurança aguardado.
 */

export const PREFIXO_AUTORIZACAO = "zfb_";
const JANELA_MAX_MS = 24 * 3600_000;
const ATIVACAO_H = 72;

export interface JanelaAutorizacao { sha256: Buffer; ate: number }
export interface ConfigFundador {
  email: string;
  bootstrap: JanelaAutorizacao | null;
  recuperacao: JanelaAutorizacao | null;
}

const emailValido = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) && s.length <= 200;

function janela(hashBruto: string | undefined, ateBruto: string | undefined, agora: number): JanelaAutorizacao | null {
  const h = (hashBruto ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) return null;
  const ate = Date.parse(ateBruto ?? "");
  // Janela no futuro e a no máximo 24 h: autorização esquecida na Vercel expira sozinha.
  if (!Number.isFinite(ate) || ate <= agora || ate - agora > JANELA_MAX_MS) return null;
  return { sha256: Buffer.from(h, "hex"), ate };
}

/** `null` = recurso desligado (as rotas respondem 404). Só lê variáveis do SERVIDOR. */
export function lerConfigFundador(env: Record<string, string | undefined> = process.env, agora = Date.now()): ConfigFundador | null {
  const email = (env.ADMIN_FOUNDER_EMAIL ?? "").trim().toLowerCase();
  if (!emailValido(email)) return null;
  return {
    email,
    bootstrap: janela(env.ADMIN_FOUNDER_BOOTSTRAP_SHA256, env.ADMIN_FOUNDER_BOOTSTRAP_UNTIL, agora),
    recuperacao: janela(env.ADMIN_FOUNDER_RECOVERY_SHA256, env.ADMIN_FOUNDER_RECOVERY_UNTIL, agora),
  };
}

/** `zfb_` + 32 bytes base64url (43 caracteres). */
export function formatoDeAutorizacao(t: unknown): t is string {
  return typeof t === "string" && /^zfb_[A-Za-z0-9_-]{43}$/.test(t);
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();

function autorizacaoConfere(t: unknown, j: JanelaAutorizacao): t is string {
  if (!formatoDeAutorizacao(t)) return false;
  return timingSafeEqual(sha256(t), j.sha256);
}

export type CodigoFundador =
  | "desligado" | "sessao_invalida" | "sem_mfa_recente" | "identidade_nao_verificada" | "nao_e_o_fundador"
  | "autorizacao_invalida" | "carteira_nao_autorizada" | "banco" | "recusado_no_banco";
export type FalhaFundador = { ok: false; codigo: CodigoFundador; detalhe?: string };

const TETO_MS = 1_500;
async function comTeto(p: Promise<unknown>): Promise<void> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([p, new Promise((r) => { t = setTimeout(r, TETO_MS); })]); } catch { /* sinal */ } finally { clearTimeout(t); }
}

async function alerta(kind: string, meta: Record<string, unknown>, severidade: "med" | "high"): Promise<void> {
  try {
    const { logSecurityAguardado } = await import("@/lib/admin/auditoria-duravel");
    await logSecurityAguardado(kind, meta, severidade);
  } catch { /* o evento é sinal; a decisão já foi tomada */ }
}

async function recusar(acao: string, codigo: CodigoFundador, extra: Partial<LinhaAuditoria> = {}, detalhe?: string): Promise<FalhaFundador> {
  await comTeto(repoCorp().auditar({
    request_id: randomUUID(), actor_kind: extra.actor_kind ?? "corp", action: acao, authz_decision: "deny", outcome: "denied",
    failure_code: (detalhe ? `${codigo}:${detalhe}` : codigo).slice(0, 80), ...extra,
  }));
  await alerta("admin_fundador_recusado", { acao, codigo, detalhe: detalhe?.slice(0, 40) }, "high");
  return { ok: false, codigo, detalhe };
}

function comoLida(l: SessaoLinha) {
  const t = (v: string | null) => (v ? Date.parse(v) : null);
  return {
    kind: l.kind, state: l.state, createdAt: Date.parse(l.created_at), lastSeenAt: Date.parse(l.last_seen_at),
    absoluteExpiresAt: Date.parse(l.absolute_expires_at), idleTimeoutS: l.idle_timeout_s, aal: l.aal,
    mfaVerifiedAt: t(l.mfa_verified_at), stepUpAt: t(l.step_up_at), revokedAt: t(l.revoked_at),
  };
}

/** Sessão corporativa ATIVA com step-up recente + identidade ativa com TOTP. */
async function sessaoComMfaRecente(acao: string, tokenAdmin: unknown, agora: number):
  Promise<{ ok: true; sessao: SessaoLinha; identidadeId: string; email: string } | FalhaFundador> {
  if (!formatoDeTokenValido(tokenAdmin)) return recusar(acao, "sessao_invalida");
  const repo = repoCorp();
  const s = await repo.sessaoPorHash(hashDoToken(tokenAdmin));
  if (!s.ok) return recusar(acao, "banco", {}, "sessao");
  const l = s.valor;
  if (!l || l.kind !== "corp" || !l.identity_id) return recusar(acao, "sessao_invalida");
  const v = avaliarSessao(comoLida(l), agora, true);
  if (!v.ok) return recusar(acao, "sessao_invalida", { actor_session_id: l.id }, v.motivo);
  if (v.precisaStepUp) return recusar(acao, "sem_mfa_recente", { actor_session_id: l.id, actor_identity_id: l.identity_id });
  const i = await repo.identidadePorId(l.identity_id);
  if (!i.ok) return recusar(acao, "banco", { actor_session_id: l.id }, "identidade");
  const ident = i.valor;
  if (!ident || ident.status !== "active" || !ident.mfa_enrolled_at || !ident.mfa_factor_id || !ident.auth_user_id || !ident.idp_subject) {
    return recusar(acao, "identidade_nao_verificada", { actor_session_id: l.id, actor_identity_id: l.identity_id });
  }
  return { ok: true, sessao: l, identidadeId: ident.id, email: ident.email_normalized };
}

// ── 1. bootstrap ─────────────────────────────────────────────────────────────

export async function bootstrapFundador(tokenAdmin: unknown, autorizacao: unknown,
  env: Record<string, string | undefined> = process.env, agora = Date.now()): Promise<{ ok: true } | FalhaFundador> {
  const acao = "governance.founder_bootstrap";
  const cfg = lerConfigFundador(env, agora);
  if (!cfg || !cfg.bootstrap) return { ok: false, codigo: "desligado" };
  const s = await sessaoComMfaRecente(acao, tokenAdmin, agora);
  if (!s.ok) return s;
  const quem = { actor_session_id: s.sessao.id, actor_identity_id: s.identidadeId };
  if (s.email !== cfg.email) return recusar(acao, "nao_e_o_fundador", quem);
  if (!autorizacaoConfere(autorizacao, cfg.bootstrap)) return recusar(acao, "autorizacao_invalida", quem);
  const r = await repoGovernanca().bootstrap({
    identityId: s.identidadeId, sessionId: s.sessao.id, tokenSha256: cfg.bootstrap.sha256,
    emailFundador: cfg.email, requestId: randomUUID(),
  });
  if (!r.ok) return recusar(acao, "banco", quem, "rpc");
  if (r.valor !== "ok") return recusar(acao, "recusado_no_banco", quem, r.valor);
  await alerta("admin_fundador_bootstrap", { identidade: s.identidadeId.slice(0, 8), modo: "solo_founder" }, "high");
  return { ok: true };
}

// ── 2. recuperação de MFA (sem segunda pessoa) ──────────────────────────────

/**
 * Quem pede: a carteira com sessão SIWE listada em `ADMIN_WALLETS` (config do servidor) + a
 * autorização de RECUPERAÇÃO (uso único, janela ≤ 24 h). Não exige a sessão corporativa — é
 * justamente o que se perdeu. Devolve o novo código de ativação UMA vez.
 */
export async function recuperarMfaFundador(carteira: string | null, autorizacao: unknown,
  env: Record<string, string | undefined> = process.env, agora = Date.now()):
  Promise<{ ok: true; codigoAtivacao: string; validoPorHoras: number; fatorSupabase: string } | FalhaFundador> {
  const acao = "governance.founder_mfa_reset";
  const cfg = lerConfigFundador(env, agora);
  if (!cfg || !cfg.recuperacao) return { ok: false, codigo: "desligado" };
  const redigida = carteira ? `${carteira.slice(0, 6)}…${carteira.slice(-4)}` : "";
  const lista = (env.ADMIN_WALLETS ?? "").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  const legado = { actor_kind: "legacy" as const, actor_wallet_redacted: redigida || null };
  if (!carteira || !lista.includes(carteira.toLowerCase())) return recusar(acao, "carteira_nao_autorizada", legado);
  if (!autorizacaoConfere(autorizacao, cfg.recuperacao)) return recusar(acao, "autorizacao_invalida", legado);
  const { codigo, hash } = novoCodigoDeAtivacao();
  const r = await repoGovernanca().resetMfa({
    tokenSha256: cfg.recuperacao.sha256, emailFundador: cfg.email, ativacaoHash: hash,
    ativacaoExpira: new Date(agora + ATIVACAO_H * 3600_000).toISOString(), carteiraRedigida: redigida, requestId: randomUUID(),
  });
  if (!r.ok) return recusar(acao, "banco", legado, "rpc");
  if (r.valor.codigo !== "ok") return recusar(acao, "recusado_no_banco", legado, r.valor.codigo);
  // O fator antigo também sai do Supabase Auth: um TOTP perdido/roubado não serve nem para aal2.
  let fatorSupabase = "sem_fator";
  const v = r.valor as { fatorAntigo: string | null; authUserId: string | null };
  if (v.fatorAntigo && v.authUserId) {
    try {
      const { getSupabaseAdmin } = await import("@/lib/supabase/server");
      const res = await getSupabaseAdmin()?.auth.admin.mfa.deleteFactor({ id: v.fatorAntigo, userId: v.authUserId });
      fatorSupabase = res && !res.error ? "removido" : "remocao_falhou";
    } catch { fatorSupabase = "remocao_falhou"; }
    await comTeto(repoCorp().auditar({
      request_id: randomUUID(), actor_kind: "legacy", actor_wallet_redacted: redigida, action: "governance.founder_mfa_reset.supabase_factor",
      authz_decision: "allow", outcome: fatorSupabase === "removido" ? "succeeded" : "failed", failure_code: fatorSupabase,
    }));
  }
  await alerta("admin_fundador_mfa_reset", { carteira: redigida, fator: fatorSupabase }, "high");
  return { ok: true, codigoAtivacao: codigo, validoPorHoras: ATIVACAO_H, fatorSupabase };
}

// ── 3. transição para multi_admin ───────────────────────────────────────────

export async function transicionarParaMulti(tokenAdmin: unknown, agora = Date.now()): Promise<{ ok: true } | FalhaFundador> {
  const acao = "governance.to_multi_admin";
  const s = await sessaoComMfaRecente(acao, tokenAdmin, agora);
  if (!s.ok) return s;
  const r = await repoGovernanca().paraMulti({ sessionId: s.sessao.id, requestId: randomUUID() });
  const quem = { actor_session_id: s.sessao.id, actor_identity_id: s.identidadeId };
  if (!r.ok) return recusar(acao, "banco", quem, "rpc");
  if (r.valor !== "ok") return recusar(acao, "recusado_no_banco", quem, r.valor);
  await alerta("admin_governanca_multi", { identidade: s.identidadeId.slice(0, 8) }, "high");
  return { ok: true };
}
