import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Papel } from "@/lib/admin/rbac";
import {
  avaliarSessao, formatoDeTokenValido, hashDoToken, novoTokenDeSessao,
  DURACAO_ABSOLUTA_S, INATIVIDADE_S, type SessaoLida,
} from "@/lib/admin/sessao-corporativa";
import {
  BLOQUEIO_MFA_S, BREAKGLASS_MAX_S, FLUXO_TTL_S, MAX_FALHAS_MFA, MAX_SESSOES_ATIVAS, PRE_MFA_TTL_S,
  type ConfigCorp, type Provedor,
} from "./config";
import { clienteAuthCorp, provaDeMfa } from "./auth-cliente";
import { abrirFluxo, cifrarComAad, decifrarComAad, selarFluxo, voltaSegura } from "./selo";
import { deBytea, repoCorp, type Identidade, type LinhaAuditoria, type SessaoLinha } from "./repo";

/**
 * O LOGIN CORPORATIVO DO ADMIN, ponta a ponta (R1, `docs/ADMIN-SSO-MFA-RBAC-DESIGN.md` §4).
 *
 *   iniciarLogin → (IdP → Supabase) → concluirCallback → sessão PRÉ-MFA → etapaMfa → sessão ATIVA
 *   stepUp (TOTP recente, id novo) · logout · break-glass (só em `corp`, janela do dono)
 *
 * ⚠️ Regras que este arquivo existe para manter:
 *   · NEGAÇÃO É GENÉRICA para o navegador (`{ ok:false, codigo }` com códigos internos que a rota
 *     traduz para a mesma página "não foi possível entrar") e AUDITADA em `admin_audit`;
 *   · leitura que falha NUNCA vira permissão: qualquer `ok:false` do repositório nega;
 *   · id de sessão NOVO depois do callback, do MFA e do step-up (fixação de sessão, A-FIX);
 *   · e-mail/domínio são só sinais no 1º login: depois, vale `provider` + `sub` (D-6).
 */

export type Codigo =
  | "config" | "provedor" | "fluxo_ausente" | "fluxo_invalido" | "nonce" | "idp_erro" | "troca_falhou"
  | "identidade_desconhecida" | "identidade_inativa" | "vinculo_divergente" | "email_nao_verificado"
  | "emissor_divergente" | "banco" | "sessao_invalida" | "bloqueado" | "codigo_invalido"
  | "ativacao_invalida" | "sem_fator" | "mfa_sem_prova" | "refresh_invalido" | "janela_fechada" | "carteira_nao_autorizada";

export type Falha = { ok: false; codigo: Codigo };

const agoraIso = (ms = Date.now()) => new Date(ms).toISOString();
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();
const redigir = (s: string | null | undefined) => (s ? `${s.slice(0, 6)}…` : null);
const TETO_AUDITORIA_MS = 1_500;

async function auditar(l: LinhaAuditoria): Promise<void> {
  // A trilha de LOGIN é observação de segurança: tenta com teto e nunca derruba a resposta;
  // os comandos sensíveis do Admin continuam com a trilha durável fail-closed (`comandoAuditado`).
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([repoCorp().auditar(l), new Promise((r) => { timer = setTimeout(r, TETO_AUDITORIA_MS); })]);
  } catch { /* nunca lança */ } finally { clearTimeout(timer); }
}

const negar = async (codigo: Codigo, acao: string, extra: Partial<LinhaAuditoria> = {}): Promise<Falha> => {
  await auditar({ request_id: randomUUID(), actor_kind: "corp", action: acao, authz_decision: "deny", outcome: "denied", failure_code: codigo, ...extra });
  return { ok: false, codigo };
};

// ── 1. início ────────────────────────────────────────────────────────────────

export async function iniciarLogin(cfg: ConfigCorp, provedor: string, volta: unknown, dicaDominio?: string):
  Promise<{ ok: true; url: string; cookieFluxo: string } | Falha> {
  if (!cfg.provedores.includes(provedor as Provedor)) return { ok: false, codigo: "provedor" };
  const nonce = randomBytes(16).toString("base64url");
  const qp: Record<string, string> = { prompt: "select_account" };
  if (provedor === "google" && dicaDominio) qp.hd = dicaDominio;   // só dica de UI — quem decide é o vínculo
  const r = await clienteAuthCorp(cfg).iniciarOAuth({
    provedor: provedor as Provedor, redirectTo: `${cfg.origem}/api/admin-auth/callback?f=${nonce}`, queryParams: qp,
  });
  if (!r) return { ok: false, codigo: "idp_erro" };
  const cookieFluxo = await selarFluxo({ verificador: r.verificador, provedor: provedor as Provedor, nonce, volta: voltaSegura(volta) }, cfg.chave, FLUXO_TTL_S);
  return { ok: true, url: r.url, cookieFluxo };
}

// ── 2. callback + vínculo/allowlist ─────────────────────────────────────────

export async function concluirCallback(cfg: ConfigCorp, p: { code: string | null; f: string | null; erroIdp: string | null; cookieFluxo: string | undefined }):
  Promise<{ ok: true; tokenPre: string; volta: string } | Falha> {
  const fluxo = await abrirFluxo(p.cookieFluxo, cfg.chave);
  if (!p.cookieFluxo) return negar("fluxo_ausente", "login.callback");
  if (!fluxo) return negar("fluxo_invalido", "login.callback");
  if (!p.f || p.f.length !== fluxo.nonce.length || !timingSafeEqual(Buffer.from(p.f), Buffer.from(fluxo.nonce))) return negar("nonce", "login.callback");
  if (p.erroIdp || !p.code) return negar("idp_erro", "login.callback");

  const auth = clienteAuthCorp(cfg);
  const troca = await auth.trocarCodigo(p.code, fluxo.verificador);
  if (!troca) return negar("troca_falhou", "login.callback");
  const u = troca.usuario;
  const sair = async () => { await sairGlobalBestEffort(troca.tokens.accessToken); };

  const repo = repoCorp();
  let ident: Identidade | null;
  const vinculada = await repo.identidadePorAuthUser(u.authUserId);
  if (!vinculada.ok) { await sair(); return negar("banco", "login.callback"); }
  ident = vinculada.valor;
  if (ident) {
    // Já vinculada: provider + sub TÊM de bater (o e-mail pode ter mudado no IdP — não importa).
    if (ident.provider !== fluxo.provedor || u.provedor !== ident.provider || !u.sujeito || u.sujeito !== ident.idp_subject) {
      await sair(); return negar("vinculo_divergente", "login.callback", { actor_identity_id: ident.id });
    }
  } else {
    // 1º login: só identidade CONVIDADA, mesmo provedor, e-mail normalizado igual e VERIFICADO, emissor esperado.
    if (!u.email || !u.emailVerificado) { await sair(); return negar("email_nao_verificado", "login.callback"); }
    const conv = await repo.identidadeConvidada(u.email.trim().toLowerCase(), fluxo.provedor);
    if (!conv.ok) { await sair(); return negar("banco", "login.callback"); }
    if (!conv.valor || u.provedor !== fluxo.provedor || !u.sujeito) { await sair(); return negar("identidade_desconhecida", "login.callback", { target_ref_redacted: redigir(u.email) }); }
    if (u.issuer && conv.valor.expected_issuer && u.issuer !== conv.valor.expected_issuer) {
      await sair(); return negar("emissor_divergente", "login.callback", { actor_identity_id: conv.valor.id });
    }
    if (u.tenant && conv.valor.expected_tenant && u.tenant !== conv.valor.expected_tenant) {
      await sair(); return negar("emissor_divergente", "login.callback", { actor_identity_id: conv.valor.id });
    }
    const v = await repo.vincular(conv.valor.id, u.authUserId, u.sujeito);
    if (!v.ok) { await sair(); return negar("banco", "login.callback"); }
    if (!v.valor) { await sair(); return negar("vinculo_divergente", "login.callback", { actor_identity_id: conv.valor.id }); }
    ident = { ...conv.valor, auth_user_id: u.authUserId, idp_subject: u.sujeito };
  }
  if (ident.status !== "active" && ident.status !== "invited") { await sair(); return negar("identidade_inativa", "login.callback", { actor_identity_id: ident.id }); }

  const tokenPre = novoTokenDeSessao();
  const id = randomUUID();
  const cr = await repo.criarSessao({
    id, token_hash: hashDoToken(tokenPre), kind: "corp", state: "mfa_pending", identity_id: ident.id, breakglass_wallet: null,
    absolute_expires_at: agoraIso(Date.now() + PRE_MFA_TTL_S * 1000), idle_timeout_s: PRE_MFA_TTL_S, aal: "aal1",
    mfa_verified_at: null, step_up_at: null, sb_user_id: u.authUserId,
    sb_refresh_token_enc: cifrarComAad(troca.tokens.refreshToken, cfg.chave, id), rotated_from: null,
  });
  if (!cr.ok) { await sair(); return negar("banco", "login.callback", { actor_identity_id: ident.id }); }
  await auditar({ request_id: randomUUID(), actor_kind: "corp", actor_identity_id: ident.id, actor_session_id: id, action: "login.callback", authz_decision: "allow", outcome: "succeeded" });
  return { ok: true, tokenPre, volta: fluxo.volta };
}

async function sairGlobalBestEffort(accessToken: string): Promise<void> {
  try {
    const { getSupabaseAdmin } = await import("@/lib/supabase/server");
    const db = getSupabaseAdmin();
    await db?.auth.admin.signOut(accessToken, "global");
  } catch { /* best-effort; a sessão admin nunca foi criada */ }
}

// ── 3. MFA (TOTP do Supabase, aal2) ─────────────────────────────────────────

/** Sessão PRÉ-MFA viva + identidade, ou negação. */
async function lerPre(token: unknown): Promise<{ ok: true; s: SessaoLinha; ident: Identidade } | Falha> {
  if (!formatoDeTokenValido(token)) return { ok: false, codigo: "sessao_invalida" };
  const repo = repoCorp();
  const s = await repo.sessaoPorHash(hashDoToken(token));
  if (!s.ok) return { ok: false, codigo: "banco" };
  const l = s.valor;
  if (!l || l.kind !== "corp" || l.state !== "mfa_pending" || l.revoked_at || !l.identity_id
      || Date.parse(l.absolute_expires_at) <= Date.now()) return { ok: false, codigo: "sessao_invalida" };
  const i = await repo.identidadePorId(l.identity_id);
  if (!i.ok) return { ok: false, codigo: "banco" };
  if (!i.valor || (i.valor.status !== "active" && i.valor.status !== "invited")) return { ok: false, codigo: "identidade_inativa" };
  return { ok: true, s: l, ident: i.valor };
}

/** Restaura a sessão do Supabase a partir do refresh cifrado e GRAVA o refresh girado. */
async function restaurarSupabase(cfg: ConfigCorp, s: SessaoLinha) {
  const refresh = decifrarComAad(deBytea(s.sb_refresh_token_enc), cfg.chave, s.id);
  if (!refresh) return null;
  const auth = clienteAuthCorp(cfg);
  const t = await auth.restaurar(refresh);
  if (!t) return null;
  const g = await repoCorp().atualizarRefresh(s.id, cifrarComAad(t.refreshToken, cfg.chave, s.id));
  if (!g.ok) return null;
  return { auth, tokens: t };
}

export type RespostaMfaInicio =
  | { ok: true; precisaAtivacao: false }
  | { ok: true; precisaAtivacao: true; qrSvg: string | null; uri: string | null };

/**
 * Primeiro acesso (identidade `invited`, sem fator verificado): o CÓDIGO DE ATIVAÇÃO (fora de banda,
 * 72 h, uso único) é exigido ANTES de matricular o TOTP. Logins seguintes: não há nada a iniciar.
 */
export async function iniciarMfa(cfg: ConfigCorp, tokenPre: unknown, codigoAtivacao: unknown): Promise<RespostaMfaInicio | Falha> {
  const pre = await lerPre(tokenPre);
  if (!pre.ok) return negar(pre.codigo, "login.mfa.iniciar");
  const { s, ident } = pre;
  if (ident.status === "active" && ident.mfa_enrolled_at) return { ok: true, precisaAtivacao: false };
  const hash = deBytea(ident.activation_code_hash);
  const vale = ident.activation_expires_at && Date.parse(ident.activation_expires_at) > Date.now();
  if (typeof codigoAtivacao !== "string" || !hash || !vale || codigoAtivacao.length > 200
      || !timingSafeEqual(sha256(codigoAtivacao.trim()), hash)) {
    return negar("ativacao_invalida", "login.mfa.iniciar", { actor_identity_id: ident.id, actor_session_id: s.id });
  }
  const r = await restaurarSupabase(cfg, s);
  if (!r) return negar("refresh_invalido", "login.mfa.iniciar", { actor_identity_id: ident.id });
  const m = await r.auth.matricularTotp(`admin-${ident.id.slice(0, 8)}`);
  if (!m) return negar("sem_fator", "login.mfa.iniciar", { actor_identity_id: ident.id });
  const g = await repoCorp().registrarFatorPendente(ident.id, m.factorId);
  if (!g.ok || !g.valor) return negar("banco", "login.mfa.iniciar", { actor_identity_id: ident.id });
  return { ok: true, precisaAtivacao: true, qrSvg: m.qrSvg, uri: m.uri };
}

/** Falha de código: conta NO BANCO (compare-and-set); não conseguir contar = recusa (falha fechada). */
async function contarFalha(ident: Identidade): Promise<Falha> {
  const n = ident.failed_mfa_count ?? 0;
  const bloquear = n + 1 >= MAX_FALHAS_MFA ? agoraIso(Date.now() + BLOQUEIO_MFA_S * 1000) : null;
  const g = await repoCorp().registrarFalhaMfa(ident.id, n, bloquear);
  if (!g.ok || !g.valor) return negar("banco", "login.mfa", { actor_identity_id: ident.id, failure_code: "falha_nao_contada" });
  if (bloquear) {
    try {
      const { logSecurityAguardado } = await import("@/lib/admin/auditoria-duravel");
      await logSecurityAguardado("admin_mfa_bloqueado", { identidade: ident.id.slice(0, 8) }, "high");
    } catch { /* alerta é sinal; o bloqueio já está gravado */ }
  }
  return negar(bloquear ? "bloqueado" : "codigo_invalido", "login.mfa", { actor_identity_id: ident.id });
}

const bloqueada = (i: Identidade) => i.locked_until != null && Date.parse(i.locked_until) > Date.now();

/** Cria a sessão ATIVA (id novo), revoga a anterior e aplica o limite de sessões. */
async function emitirAtiva(cfg: ConfigCorp, a: { identityId: string; anterior: SessaoLinha; refresh: string; mfaEm: number; stepUpEm: number }):
  Promise<{ ok: true; token: string; id: string } | Falha> {
  const repo = repoCorp();
  const token = novoTokenDeSessao();
  const id = randomUUID();
  const cr = await repo.criarSessao({
    id, token_hash: hashDoToken(token), kind: "corp", state: "active", identity_id: a.identityId, breakglass_wallet: null,
    absolute_expires_at: agoraIso(Math.min(Date.now() + DURACAO_ABSOLUTA_S * 1000,
      a.anterior.state === "active" ? Date.parse(a.anterior.absolute_expires_at) : Infinity)),
    idle_timeout_s: INATIVIDADE_S, aal: "aal2", mfa_verified_at: agoraIso(a.mfaEm * 1000), step_up_at: agoraIso(a.stepUpEm * 1000),
    sb_user_id: null, sb_refresh_token_enc: cifrarComAad(a.refresh, cfg.chave, id), rotated_from: a.anterior.id,
  });
  if (!cr.ok) return { ok: false, codigo: "banco" };
  const rv = await repo.revogarSessao(a.anterior.id, "rotacionada", null);
  if (!rv.ok || !rv.valor) {
    // Não conseguiu matar a anterior: a nova também morre (nunca duas vivas por rotação).
    await repo.revogarSessao(id, "rotacao_incompleta", null);
    return { ok: false, codigo: "banco" };
  }
  await repo.revogarExcedentes(a.identityId, MAX_SESSOES_ATIVAS);
  return { ok: true, token, id };
}

export async function verificarMfa(cfg: ConfigCorp, tokenPre: unknown, codigo: unknown): Promise<{ ok: true; tokenAdmin: string } | Falha> {
  const pre = await lerPre(tokenPre);
  if (!pre.ok) return negar(pre.codigo, "login.mfa");
  const { s, ident } = pre;
  if (bloqueada(ident)) return negar("bloqueado", "login.mfa", { actor_identity_id: ident.id });
  if (!ident.mfa_factor_id) return negar("sem_fator", "login.mfa", { actor_identity_id: ident.id });
  if (typeof codigo !== "string" || !/^\d{6}$/.test(codigo.trim())) return contarFalha(ident);
  const r = await restaurarSupabase(cfg, s);
  if (!r) return negar("refresh_invalido", "login.mfa", { actor_identity_id: ident.id });
  const t = await r.auth.desafiarEVerificar(ident.mfa_factor_id, codigo.trim());
  if (!t) return contarFalha(ident);
  const prova = provaDeMfa(await r.auth.claims(t.accessToken), Math.floor(Date.now() / 1000));
  if (!prova.ok) return negar("mfa_sem_prova", "login.mfa", { actor_identity_id: ident.id });
  const repo = repoCorp();
  if (ident.status === "invited") {
    const at = await repo.ativar(ident.id, ident.mfa_factor_id);
    if (!at.ok || !at.valor) return negar("banco", "login.mfa", { actor_identity_id: ident.id });
  } else {
    await repo.zerarFalhasMfa(ident.id);
  }
  const ativa = await emitirAtiva(cfg, { identityId: ident.id, anterior: s, refresh: t.refreshToken, mfaEm: prova.quando, stepUpEm: prova.quando });
  if (!ativa.ok) return negar(ativa.codigo, "login.mfa", { actor_identity_id: ident.id });
  await auditar({ request_id: randomUUID(), actor_kind: "corp", actor_identity_id: ident.id, actor_session_id: ativa.id,
    action: ident.status === "invited" ? "identity.mfa_enrolled" : "login.succeeded", authz_decision: "allow", outcome: "succeeded" });
  return { ok: true, tokenAdmin: ativa.token };
}

// ── 4. principal (o que o `authz` consulta a cada requisição) ───────────────

export type PrincipalCorp =
  | { kind: "corp"; identityId: string; sessionId: string; papeis: Papel[]; stepUpOk: boolean }
  | { kind: "breakglass"; wallet: string; sessionId: string; stepUpOk: true };

function comoSessaoLida(l: SessaoLinha): SessaoLida {
  const t = (v: string | null) => (v ? Date.parse(v) : null);
  return {
    kind: l.kind, state: l.state, createdAt: Date.parse(l.created_at), lastSeenAt: Date.parse(l.last_seen_at),
    absoluteExpiresAt: Date.parse(l.absolute_expires_at), idleTimeoutS: l.idle_timeout_s, aal: l.aal,
    mfaVerifiedAt: t(l.mfa_verified_at), stepUpAt: t(l.step_up_at), revokedAt: t(l.revoked_at),
  };
}

export async function lerPrincipal(token: unknown, env: Record<string, string | undefined> = process.env, agora = Date.now()):
  Promise<{ ok: true; principal: PrincipalCorp } | Falha> {
  if (!formatoDeTokenValido(token)) return { ok: false, codigo: "sessao_invalida" };
  const repo = repoCorp();
  const s = await repo.sessaoPorHash(hashDoToken(token));
  if (!s.ok) return { ok: false, codigo: "banco" };
  if (!s.valor) return { ok: false, codigo: "sessao_invalida" };
  const l = s.valor;
  const v = avaliarSessao(comoSessaoLida(l), agora, true);
  if (!v.ok) return { ok: false, codigo: "sessao_invalida" };
  if (l.kind === "breakglass") {
    if (!l.breakglass_wallet || !janelaBreakglass(env, agora).aberta) return { ok: false, codigo: "janela_fechada" };
    void repo.tocarSessao(l.id, agoraIso(agora));
    return { ok: true, principal: { kind: "breakglass", wallet: l.breakglass_wallet, sessionId: l.id, stepUpOk: true } };
  }
  if (!l.identity_id) return { ok: false, codigo: "sessao_invalida" };
  const i = await repo.identidadePorId(l.identity_id);
  if (!i.ok) return { ok: false, codigo: "banco" };
  if (!i.valor || i.valor.status !== "active") return { ok: false, codigo: "identidade_inativa" };
  const p = await repo.papeisAtivos(l.identity_id, agoraIso(agora));
  if (!p.ok) return { ok: false, codigo: "banco" };
  void repo.tocarSessao(l.id, agoraIso(agora));
  return { ok: true, principal: { kind: "corp", identityId: l.identity_id, sessionId: l.id, papeis: p.valor, stepUpOk: !v.precisaStepUp } };
}

// ── 5. step-up e logout ─────────────────────────────────────────────────────

export async function stepUp(cfg: ConfigCorp, tokenAdmin: unknown, codigo: unknown): Promise<{ ok: true; tokenAdmin: string } | Falha> {
  if (!formatoDeTokenValido(tokenAdmin)) return negar("sessao_invalida", "stepup");
  const repo = repoCorp();
  const s = await repo.sessaoPorHash(hashDoToken(tokenAdmin));
  if (!s.ok) return negar("banco", "stepup");
  const l = s.valor;
  if (!l || l.kind !== "corp" || !l.identity_id || !avaliarSessao(comoSessaoLida(l), Date.now()).ok) return negar("sessao_invalida", "stepup");
  const i = await repo.identidadePorId(l.identity_id);
  if (!i.ok) return negar("banco", "stepup");
  const ident = i.valor;
  if (!ident || ident.status !== "active") return negar("identidade_inativa", "stepup");
  if (bloqueada(ident)) return negar("bloqueado", "stepup", { actor_identity_id: ident.id });
  if (!ident.mfa_factor_id) return negar("sem_fator", "stepup", { actor_identity_id: ident.id });
  if (typeof codigo !== "string" || !/^\d{6}$/.test(codigo.trim())) return contarFalha(ident);
  const r = await restaurarSupabase(cfg, l);
  // Refresh inutilizável (revogado no Supabase) → step-up exige login completo de novo.
  if (!r) return negar("refresh_invalido", "stepup", { actor_identity_id: ident.id });
  const t = await r.auth.desafiarEVerificar(ident.mfa_factor_id, codigo.trim());
  if (!t) return contarFalha(ident);
  const prova = provaDeMfa(await r.auth.claims(t.accessToken), Math.floor(Date.now() / 1000));
  if (!prova.ok) return negar("mfa_sem_prova", "stepup", { actor_identity_id: ident.id });
  await repo.zerarFalhasMfa(ident.id);
  const ativa = await emitirAtiva(cfg, { identityId: ident.id, anterior: l, refresh: t.refreshToken, mfaEm: Date.parse(l.mfa_verified_at ?? "") / 1000 || prova.quando, stepUpEm: prova.quando });
  if (!ativa.ok) return negar(ativa.codigo, "stepup", { actor_identity_id: ident.id });
  await auditar({ request_id: randomUUID(), actor_kind: "corp", actor_identity_id: ident.id, actor_session_id: ativa.id, action: "stepup", authz_decision: "allow", outcome: "succeeded" });
  return { ok: true, tokenAdmin: ativa.token };
}

export async function logout(token: unknown): Promise<{ ok: boolean }> {
  if (!formatoDeTokenValido(token)) return { ok: true };
  const repo = repoCorp();
  const s = await repo.sessaoPorHash(hashDoToken(token));
  if (!s.ok) return { ok: false };
  if (!s.valor) return { ok: true };
  const r = await repo.revogarSessao(s.valor.id, "logout", s.valor.identity_id);
  await auditar({ request_id: randomUUID(), actor_kind: s.valor.kind, actor_identity_id: s.valor.identity_id, actor_session_id: s.valor.id,
    action: "logout", authz_decision: "allow", outcome: r.ok ? "succeeded" : "failed" });
  return { ok: r.ok };
}

// ── 6. break-glass (design §6) ──────────────────────────────────────────────

/** `ADMIN_BREAKGLASS_UNTIL` vale só no futuro e a ≤ 24 h; qualquer outra coisa = fechada. */
export function janelaBreakglass(env: Record<string, string | undefined>, agora = Date.now()): { aberta: boolean; ate: number | null } {
  const t = Date.parse(env.ADMIN_BREAKGLASS_UNTIL ?? "");
  if (!Number.isFinite(t) || t <= agora || t - agora > 24 * 3600_000) return { aberta: false, ate: null };
  return { aberta: true, ate: t };
}

export async function abrirBreakglass(cfg: ConfigCorp, wallet: string | null, env: Record<string, string | undefined> = process.env):
  Promise<{ ok: true; tokenAdmin: string; ate: number } | Falha> {
  if (cfg.modo !== "corp") return negar("config", "breakglass.entrar", { actor_kind: "breakglass" });
  const j = janelaBreakglass(env);
  if (!j.aberta || !j.ate) return negar("janela_fechada", "breakglass.entrar", { actor_kind: "breakglass" });
  const lista = (env.ADMIN_WALLETS ?? "").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (!wallet || !lista.includes(wallet.toLowerCase())) {
    return negar("carteira_nao_autorizada", "breakglass.entrar", { actor_kind: "breakglass", actor_wallet_redacted: redigir(wallet) });
  }
  const token = novoTokenDeSessao();
  const id = randomUUID();
  const ate = Math.min(Date.now() + BREAKGLASS_MAX_S * 1000, j.ate);
  const cr = await repoCorp().criarSessao({
    id, token_hash: hashDoToken(token), kind: "breakglass", state: "active", identity_id: null, breakglass_wallet: wallet,
    absolute_expires_at: agoraIso(ate), idle_timeout_s: 15 * 60, aal: null, mfa_verified_at: null, step_up_at: null,
    sb_user_id: null, sb_refresh_token_enc: null, rotated_from: null,
  });
  if (!cr.ok) return negar("banco", "breakglass.entrar", { actor_kind: "breakglass" });
  try {
    const { logSecurityAguardado } = await import("@/lib/admin/auditoria-duravel");
    await logSecurityAguardado("admin_breakglass_usado", { carteira: redigir(wallet), ate: agoraIso(ate) }, "high");
  } catch { /* o alerta é sinal; a sessão e a trilha já existem */ }
  await auditar({ request_id: randomUUID(), actor_kind: "breakglass", actor_session_id: id, actor_wallet_redacted: redigir(wallet),
    action: "breakglass.entrar", authz_decision: "allow", outcome: "succeeded" });
  return { ok: true, tokenAdmin: token, ate };
}

/** Exportado para o fluxo de convite (gestão de identidades). */
export function novoCodigoDeAtivacao(): { codigo: string; hash: Buffer } {
  const codigo = randomBytes(9).toString("base64url");
  return { codigo, hash: sha256(codigo) };
}
