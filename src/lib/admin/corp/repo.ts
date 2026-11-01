import { getSupabaseAdmin } from "@/lib/supabase/server";
import { PAPEIS, type Papel } from "@/lib/admin/rbac";

/**
 * REPOSITÓRIO DO SCHEMA `admin_private` (R1, migration 0083) — identidades, papéis, sessões e a
 * auditoria append-only. SÓ o servidor (service_role) toca; o schema precisa estar em "Exposed
 * schemas" do Data API (runbook §9.1 passo 8) — sem isso toda leitura falha e o login NEGA.
 *
 * ⚠️ Toda função devolve `{ ok, … }`: `supabase-js` não lança, e "não consegui ler" NUNCA vira "não
 * existe" (quem decide trata `ok:false` como negação). Escritas que precisam de exclusividade são
 * CONDICIONAIS (compare-and-set) com `.select()` para separar "gravou" de "não casou".
 */
export type R<T> = { ok: true; valor: T } | { ok: false; erro: string };

export interface Identidade {
  id: string;
  status: "invited" | "active" | "suspended" | "revoked";
  email_normalized: string;
  provider: "google" | "azure";
  expected_issuer: string;
  expected_tenant: string;
  auth_user_id: string | null;
  idp_subject: string | null;
  mfa_factor_id: string | null;
  mfa_enrolled_at: string | null;
  activation_code_hash: string | null;
  activation_expires_at: string | null;
  failed_mfa_count: number;
  locked_until: string | null;
}

export interface SessaoLinha {
  id: string;
  kind: "corp" | "breakglass";
  state: "mfa_pending" | "active";
  identity_id: string | null;
  breakglass_wallet: string | null;
  created_at: string;
  last_seen_at: string;
  absolute_expires_at: string;
  idle_timeout_s: number;
  aal: "aal1" | "aal2" | null;
  mfa_verified_at: string | null;
  step_up_at: string | null;
  sb_refresh_token_enc: string | null;
  revoked_at: string | null;
}

export interface NovaSessao {
  id: string;
  token_hash: Buffer;
  kind: "corp" | "breakglass";
  state: "mfa_pending" | "active";
  identity_id: string | null;
  breakglass_wallet: string | null;
  absolute_expires_at: string;
  idle_timeout_s: number;
  aal: "aal1" | "aal2" | null;
  mfa_verified_at: string | null;
  step_up_at: string | null;
  sb_user_id: string | null;
  sb_refresh_token_enc: Buffer | null;
  rotated_from: string | null;
}

export interface LinhaAuditoria {
  request_id: string;
  idempotency_key?: string | null;
  actor_kind: "corp" | "legacy" | "breakglass" | "system";
  actor_identity_id?: string | null;
  actor_session_id?: string | null;
  actor_wallet_redacted?: string | null;
  actor_roles?: string[];
  action: string;
  target_type?: string | null;
  target_ref_redacted?: string | null;
  authz_decision: "allow" | "deny";
  outcome: "intent" | "succeeded" | "failed" | "denied";
  failure_code?: string | null;
  origin?: string | null;
}

export interface IdentidadeComPapeis extends Identidade {
  papeis: { id: string; role: Papel; granted_at: string; expires_at: string | null }[];
}

export interface RepoCorp {
  identidadePorAuthUser(uid: string): Promise<R<Identidade | null>>;
  identidadePorId(id: string): Promise<R<Identidade | null>>;
  identidadeConvidada(email: string, provider: string): Promise<R<Identidade | null>>;
  /** 1º login: grava `auth_user_id` + `idp_subject` SÓ se ainda não vinculada. */
  vincular(id: string, authUserId: string, sujeito: string): Promise<R<boolean>>;
  registrarFatorPendente(id: string, factorId: string): Promise<R<boolean>>;
  ativar(id: string, factorId: string): Promise<R<boolean>>;
  /** Compare-and-set no contador: duas falhas simultâneas não contam como uma. */
  registrarFalhaMfa(id: string, contagemLida: number, bloquearAte: string | null): Promise<R<boolean>>;
  zerarFalhasMfa(id: string): Promise<R<boolean>>;
  papeisAtivos(identityId: string, agoraIso: string): Promise<R<Papel[]>>;
  criarSessao(s: NovaSessao): Promise<R<string>>;
  sessaoPorHash(hash: Buffer): Promise<R<SessaoLinha | null>>;
  tocarSessao(id: string, agoraIso: string): Promise<R<boolean>>;
  /** O Supabase GIRA o refresh token a cada uso: a cifra nova substitui a velha (só em sessão viva). */
  atualizarRefresh(id: string, enc: Buffer): Promise<R<boolean>>;
  revogarSessao(id: string, motivo: string, por: string | null): Promise<R<boolean>>;
  /** Mantém as `manter` sessões ATIVAS mais novas; revoga as demais (limite de concorrência). */
  revogarExcedentes(identityId: string, manter: number): Promise<R<number>>;
  revogarTodasDaIdentidade(identityId: string, motivo: string, por: string | null): Promise<R<number>>;
  auditar(l: LinhaAuditoria): Promise<R<boolean>>;
  listarIdentidades(agoraIso: string): Promise<R<IdentidadeComPapeis[]>>;
  convidar(i: { email: string; provider: "google" | "azure"; issuer: string; tenant: string; label: string | null; codigoHash: Buffer; expira: string; por: string | null }): Promise<R<string>>;
  revogarIdentidade(id: string, por: string | null, motivo: string): Promise<R<boolean>>;
  concederPapel(identityId: string, role: Papel, por: string): Promise<R<string>>;
  revogarPapel(assignmentId: string, por: string | null, motivo: string): Promise<R<boolean>>;
  contarSuperadminsAtivos(agoraIso: string): Promise<R<number>>;
}

// ── implementação real (PostgREST, schema admin_private) ─────────────────────

type Q = {
  select: (c?: string, o?: unknown) => Q; eq: (c: string, v: unknown) => Q; is: (c: string, v: null) => Q;
  in: (c: string, v: unknown[]) => Q; neq: (c: string, v: unknown) => Q; lt: (c: string, v: unknown) => Q;
  gt: (c: string, v: unknown) => Q; or: (f: string) => Q; order: (c: string, o: unknown) => Q; limit: (n: number) => Q;
  insert: (r: unknown) => Q; update: (r: unknown) => Q; maybeSingle: () => Q;
  then: PromiseLike<{ data: unknown; error: { message: string } | null }>["then"];
};
type Esquema = { from: (t: string) => Q };

const hexBytea = (b: Buffer) => `\\x${b.toString("hex")}`;

function esquema(): Esquema | null {
  const db = getSupabaseAdmin();
  if (!db) return null;
  return (db as unknown as { schema: (s: string) => Esquema }).schema("admin_private");
}

async function rodar<T>(f: (e: Esquema) => PromiseLike<{ data: unknown; error: { message: string } | null }>, mapear: (d: unknown) => T): Promise<R<T>> {
  const e = esquema();
  if (!e) return { ok: false, erro: "sem_banco" };
  try {
    const { data, error } = await f(e);
    if (error) return { ok: false, erro: String(error.message).slice(0, 160) };
    return { ok: true, valor: mapear(data) };
  } catch (x) {
    return { ok: false, erro: (x instanceof Error ? x.message : "excecao").slice(0, 160) };
  }
}

const COLS_IDENT = "id, status, email_normalized, provider, expected_issuer, expected_tenant, auth_user_id, idp_subject, mfa_factor_id, mfa_enrolled_at, activation_code_hash, activation_expires_at, failed_mfa_count, locked_until";
const COLS_SESSAO = "id, kind, state, identity_id, breakglass_wallet, created_at, last_seen_at, absolute_expires_at, idle_timeout_s, aal, mfa_verified_at, step_up_at, sb_refresh_token_enc, revoked_at";
const mudou = (d: unknown) => Array.isArray(d) && d.length > 0;
const papelValido = (r: unknown): r is Papel => typeof r === "string" && (PAPEIS as readonly string[]).includes(r);

export const repoReal: RepoCorp = {
  // Revogada não conta: re-convite da mesma pessoa tem de poder vincular de novo (revisão adversarial).
  identidadePorAuthUser: (uid) => rodar((e) => e.from("admin_identities").select(COLS_IDENT).eq("auth_user_id", uid).neq("status", "revoked").maybeSingle(), (d) => (d as Identidade) ?? null),
  identidadePorId: (id) => rodar((e) => e.from("admin_identities").select(COLS_IDENT).eq("id", id).maybeSingle(), (d) => (d as Identidade) ?? null),
  identidadeConvidada: (email, provider) => rodar((e) => e.from("admin_identities").select(COLS_IDENT)
    .eq("email_normalized", email).eq("provider", provider).eq("status", "invited").is("auth_user_id", null).maybeSingle(), (d) => (d as Identidade) ?? null),
  vincular: (id, uid, sub) => rodar((e) => e.from("admin_identities").update({ auth_user_id: uid, idp_subject: sub })
    .eq("id", id).is("auth_user_id", null).in("status", ["invited", "active"]).select("id"), mudou),
  registrarFatorPendente: (id, factorId) => rodar((e) => e.from("admin_identities").update({ mfa_factor_id: factorId })
    .eq("id", id).eq("status", "invited").select("id"), mudou),
  ativar: (id, factorId) => rodar((e) => e.from("admin_identities").update({
    status: "active", mfa_factor_id: factorId, mfa_enrolled_at: new Date().toISOString(), activated_at: new Date().toISOString(),
    activation_code_hash: null, activation_expires_at: null, failed_mfa_count: 0, locked_until: null,
  }).eq("id", id).in("status", ["invited", "active"]).select("id"), mudou),
  registrarFalhaMfa: (id, n, ate) => rodar((e) => e.from("admin_identities").update({ failed_mfa_count: n + 1, locked_until: ate })
    .eq("id", id).eq("failed_mfa_count", n).select("id"), mudou),
  zerarFalhasMfa: (id) => rodar((e) => e.from("admin_identities").update({ failed_mfa_count: 0, locked_until: null }).eq("id", id).select("id"), mudou),
  papeisAtivos: (identityId, agora) => rodar((e) => e.from("admin_role_assignments").select("role")
    .eq("identity_id", identityId).is("revoked_at", null).or(`expires_at.is.null,expires_at.gt.${agora}`),
  (d) => ((d as { role: unknown }[]) ?? []).map((x) => x.role).filter(papelValido)),
  criarSessao: (s) => rodar((e) => e.from("admin_sessions").insert({
    ...s, token_hash: hexBytea(s.token_hash), sb_refresh_token_enc: s.sb_refresh_token_enc ? hexBytea(s.sb_refresh_token_enc) : null,
  }).select("id"), (d) => String((d as { id: string }[])[0]?.id ?? "")),
  sessaoPorHash: (h) => rodar((e) => e.from("admin_sessions").select(COLS_SESSAO).eq("token_hash", hexBytea(h)).maybeSingle(), (d) => (d as SessaoLinha) ?? null),
  tocarSessao: (id, agora) => rodar((e) => e.from("admin_sessions").update({ last_seen_at: agora })
    .eq("id", id).is("revoked_at", null).lt("last_seen_at", new Date(Date.parse(agora) - 60_000).toISOString()).select("id"), mudou),
  atualizarRefresh: (id, enc) => rodar((e) => e.from("admin_sessions").update({ sb_refresh_token_enc: hexBytea(enc) })
    .eq("id", id).is("revoked_at", null).select("id"), mudou),
  revogarSessao: (id, motivo, por) => rodar((e) => e.from("admin_sessions").update({ revoked_at: new Date().toISOString(), revoke_reason: motivo, revoked_by: por })
    .eq("id", id).is("revoked_at", null).select("id"), mudou),
  async revogarExcedentes(identityId, manter) {
    const l = await rodar((e) => e.from("admin_sessions").select("id, created_at").eq("identity_id", identityId).eq("state", "active")
      .is("revoked_at", null).order("created_at", { ascending: false }).limit(50), (d) => (d as { id: string }[]) ?? []);
    if (!l.ok) return l;
    let n = 0;
    for (const s of l.valor.slice(manter)) { const r = await repoReal.revogarSessao(s.id, "limite_de_sessoes", null); if (r.ok && r.valor) n++; }
    return { ok: true, valor: n };
  },
  revogarTodasDaIdentidade: (identityId, motivo, por) => rodar((e) => e.from("admin_sessions").update({ revoked_at: new Date().toISOString(), revoke_reason: motivo, revoked_by: por })
    .eq("identity_id", identityId).is("revoked_at", null).select("id"), (d) => ((d as unknown[]) ?? []).length),
  auditar: (l) => rodar((e) => e.from("admin_audit").insert({ actor_roles: [], ...l }).select("id"), mudou),
  async listarIdentidades(agora) {
    const ids = await rodar((e) => e.from("admin_identities").select(COLS_IDENT).order("invited_at", { ascending: true }).limit(500), (d) => (d as Identidade[]) ?? []);
    if (!ids.ok) return ids;
    const pap = await rodar((e) => e.from("admin_role_assignments").select("id, identity_id, role, granted_at, expires_at")
      .is("revoked_at", null).or(`expires_at.is.null,expires_at.gt.${agora}`).limit(2000),
    (d) => (d as { id: string; identity_id: string; role: string; granted_at: string; expires_at: string | null }[]) ?? []);
    if (!pap.ok) return pap;
    return { ok: true, valor: ids.valor.map((i) => ({
      ...i, activation_code_hash: null,
      papeis: pap.valor.filter((p) => p.identity_id === i.id && papelValido(p.role))
        .map((p) => ({ id: p.id, role: p.role as Papel, granted_at: p.granted_at, expires_at: p.expires_at })),
    })) };
  },
  convidar: (i) => rodar((e) => e.from("admin_identities").insert({
    email_normalized: i.email, provider: i.provider, expected_issuer: i.issuer, expected_tenant: i.tenant, display_label: i.label,
    activation_code_hash: hexBytea(i.codigoHash), activation_expires_at: i.expira, invited_by: i.por, status: "invited",
  }).select("id"), (d) => String((d as { id: string }[])[0]?.id ?? "")),
  // Revogar LIBERA o vínculo (auth_user_id/idp_subject são únicos): sem isto um re-convite ficava preso
  // para sempre. A identidade anterior fica registrada em admin_audit (ator, alvo, motivo).
  revogarIdentidade: (id, por, motivo) => rodar((e) => e.from("admin_identities").update({
    status: "revoked", revoked_at: new Date().toISOString(), revoked_by: por, reason_code: motivo,
    auth_user_id: null, idp_subject: null, mfa_factor_id: null,
  }).eq("id", id).neq("status", "revoked").select("id"), mudou),
  concederPapel: (identityId, role, por) => rodar((e) => e.from("admin_role_assignments").insert({ identity_id: identityId, role, granted_by: por }).select("id"),
    (d) => String((d as { id: string }[])[0]?.id ?? "")),
  revogarPapel: (aid, por, motivo) => rodar((e) => e.from("admin_role_assignments").update({ revoked_at: new Date().toISOString(), revoked_by: por, reason_code: motivo })
    .eq("id", aid).is("revoked_at", null).select("id"), mudou),
  async contarSuperadminsAtivos(agora) {
    const pap = await rodar((e) => e.from("admin_role_assignments").select("identity_id").eq("role", "superadmin").is("revoked_at", null)
      .or(`expires_at.is.null,expires_at.gt.${agora}`).limit(1000), (d) => ((d as { identity_id: string }[]) ?? []).map((x) => x.identity_id));
    if (!pap.ok) return pap;
    if (pap.valor.length === 0) return { ok: true, valor: 0 };
    const ids = await rodar((e) => e.from("admin_identities").select("id").in("id", pap.valor).eq("status", "active").limit(1000), (d) => ((d as unknown[]) ?? []).length);
    return ids;
  },
};

let atual: RepoCorp = repoReal;
export function repoCorp(): RepoCorp { return atual; }
/** Só para testes. */
export function definirRepoCorp(r: RepoCorp | null): void { atual = r ?? repoReal; }

/** bytea do PostgREST (`\x…`) → Buffer. */
export function deBytea(v: string | null | undefined): Buffer | null {
  if (!v || !v.startsWith("\\x")) return null;
  try { return Buffer.from(v.slice(2), "hex"); } catch { return null; }
}
