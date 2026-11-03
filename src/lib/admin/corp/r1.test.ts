/**
 * R1 (Admin CC 2.0, 31/10) — login corporativo atrás de flag, testado com Supabase Auth e banco FALSOS.
 * Nenhum IdP, nenhum Supabase real. Casos do desenho §10: A-PKCE, A-VINC, A-FIX, A-CSRF, A-MODO,
 * ADM-003 (em execução), ADM-008, ADM-012, e o bloqueio de força bruta do TOTP.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ClienteAuthCorp, ClaimsMfa } from "./auth-cliente";
import type { Identidade, IdentidadeComPapeis, LinhaAuditoria, NovaSessao, RepoCorp, SessaoLinha } from "./repo";
import type { Papel } from "@/lib/admin/rbac";

const CHAVE = Buffer.alloc(32, 7).toString("base64");
const ENV_CORP = {
  ADMIN_AUTH_MODE: "dual", ADMIN_SESSION_ENC_KEY: CHAVE, ADMIN_ORIGIN: "https://z.test",
  SUPABASE_URL: "https://sb.test", SUPABASE_ANON_KEY: "anon", ADMIN_IDP_PROVIDERS: "google,azure",
};

// ── banco falso (admin_private) ──────────────────────────────────────────────
const b = vi.hoisted(() => ({
  ids: [] as Record<string, unknown>[], sessoes: [] as Record<string, unknown>[], papeis: [] as Record<string, unknown>[],
  auditoria: [] as Record<string, unknown>[], fora: false, eventos: [] as unknown[], cookie: null as string | null,
  sessaoCarteira: null as { sub: string } | null,
}));

function repoFalso(): RepoCorp {
  const ok = <T,>(valor: T) => ({ ok: true as const, valor });
  const f = <T,>(fn: () => T) => (b.fora ? { ok: false as const, erro: "fora" } : ok(fn()));
  const hex = (x: Buffer) => `\\x${x.toString("hex")}`;
  return {
    identidadePorAuthUser: async (uid) => f(() => (b.ids.find((i) => i.auth_user_id === uid) as unknown as Identidade) ?? null),
    identidadePorId: async (id) => f(() => (b.ids.find((i) => i.id === id) as unknown as Identidade) ?? null),
    identidadeConvidada: async (email, prov) => f(() => (b.ids.find((i) => i.email_normalized === email && i.provider === prov && i.status === "invited" && !i.auth_user_id) as unknown as Identidade) ?? null),
    vincular: async (id, uid, sub) => f(() => { const i = b.ids.find((x) => x.id === id && !x.auth_user_id); if (!i) return false; i.auth_user_id = uid; i.idp_subject = sub; return true; }),
    registrarFatorPendente: async (id, fid) => f(() => { const i = b.ids.find((x) => x.id === id && x.status === "invited"); if (!i) return false; i.mfa_factor_id = fid; return true; }),
    ativar: async (id, fid) => f(() => { const i = b.ids.find((x) => x.id === id); if (!i) return false; Object.assign(i, { status: "active", mfa_factor_id: fid, mfa_enrolled_at: new Date().toISOString(), activation_code_hash: null, failed_mfa_count: 0 }); return true; }),
    registrarFalhaMfa: async (id, n, ate) => f(() => { const i = b.ids.find((x) => x.id === id && x.failed_mfa_count === n); if (!i) return false; i.failed_mfa_count = n + 1; i.locked_until = ate; return true; }),
    zerarFalhasMfa: async (id) => f(() => { const i = b.ids.find((x) => x.id === id); if (i) { i.failed_mfa_count = 0; i.locked_until = null; } return !!i; }),
    papeisAtivos: async (iid) => f(() => b.papeis.filter((p) => p.identity_id === iid && !p.revoked_at).map((p) => p.role as Papel)),
    criarSessao: async (s: NovaSessao) => f(() => { b.sessoes.push({ ...s, token_hash: hex(s.token_hash), sb_refresh_token_enc: s.sb_refresh_token_enc ? hex(s.sb_refresh_token_enc) : null, created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), revoked_at: null }); return s.id; }),
    sessaoPorHash: async (h) => f(() => (b.sessoes.find((s) => s.token_hash === hex(h)) as unknown as SessaoLinha) ?? null),
    tocarSessao: async () => ok(true),
    atualizarRefresh: async (id, enc) => f(() => { const s = b.sessoes.find((x) => x.id === id && !x.revoked_at); if (!s) return false; s.sb_refresh_token_enc = hex(enc); return true; }),
    revogarSessao: async (id) => f(() => { const s = b.sessoes.find((x) => x.id === id && !x.revoked_at); if (!s) return false; s.revoked_at = new Date().toISOString(); return true; }),
    revogarExcedentes: async () => ok(0),
    revogarTodasDaIdentidade: async (iid) => f(() => { let n = 0; for (const s of b.sessoes) if (s.identity_id === iid && !s.revoked_at) { s.revoked_at = new Date().toISOString(); n++; } return n; }),
    auditar: async (l: LinhaAuditoria) => f(() => { b.auditoria.push(l as unknown as Record<string, unknown>); return true; }),
    listarIdentidades: async () => f(() => b.ids.map((i) => ({ ...i, papeis: b.papeis.filter((p) => p.identity_id === i.id && !p.revoked_at) })) as unknown as IdentidadeComPapeis[]),
    convidar: async (i) => f(() => { const id = crypto.randomUUID(); b.ids.push({ id, status: "invited", email_normalized: i.email, provider: i.provider, expected_issuer: i.issuer, expected_tenant: i.tenant, auth_user_id: null, idp_subject: null, mfa_factor_id: null, mfa_enrolled_at: null, activation_code_hash: hex(i.codigoHash), activation_expires_at: i.expira, failed_mfa_count: 0, locked_until: null }); return id; }),
    revogarIdentidade: async (id) => f(() => { const i = b.ids.find((x) => x.id === id && x.status !== "revoked"); if (!i) return false; i.status = "revoked"; return true; }),
    concederPapel: async (iid, role) => f(() => { const id = crypto.randomUUID(); b.papeis.push({ id, identity_id: iid, role, revoked_at: null, granted_at: "t", expires_at: null }); return id; }),
    revogarPapel: async (aid) => f(() => { const p = b.papeis.find((x) => x.id === aid && !x.revoked_at); if (!p) return false; p.revoked_at = "t"; return true; }),
    contarSuperadminsAtivos: async () => ok(0),
  };
}

// ── Supabase Auth falso ──────────────────────────────────────────────────────
const a = vi.hoisted(() => ({
  usuario: null as null | { authUserId: string; email: string | null; emailVerificado: boolean; provedor: string | null; sujeito: string | null; issuer: string | null; tenant: string | null },
  codigoTotp: "123456", aal: "aal2", signOuts: 0, verificador: "verif-1", refreshValido: true, palpites: 0, multiplas: false,
}));
function authFalso(): ClienteAuthCorp {
  return {
    iniciarOAuth: async ({ provedor, redirectTo }) => ({ url: `https://sb.test/auth/v1/authorize?provider=${provedor}&redirect_to=${encodeURIComponent(redirectTo)}`, verificador: a.verificador }),
    trocarCodigo: async (code, verificador, provedor) => (code === "codigo-bom" && verificador === a.verificador && a.usuario
      ? { tokens: { accessToken: "at-1", refreshToken: "rt-1" }, usuario: { ...a.usuario,
          multiplasIdentidades: a.multiplas, provedor: a.usuario.provedor === provedor ? provedor : a.usuario.provedor } } : null),
    restaurar: async (rt) => (a.refreshValido && rt.startsWith("rt-") ? { accessToken: "at-2", refreshToken: `rt-${Math.random()}` } : null),
    matricularTotp: async () => ({ factorId: "11111111-1111-4111-8111-111111111111", qrSvg: "data:image/svg+xml;utf-8,<svg/>", uri: "otpauth://totp/x" }),
    desafiarEVerificar: async (_f, c) => { a.palpites++; await new Promise((r) => setTimeout(r, 1)); return c === a.codigoTotp ? { accessToken: "at-mfa", refreshToken: "rt-mfa" } : null; },
    claims: async (): Promise<ClaimsMfa> => ({ aal: a.aal, sessionId: "s", metodos: [{ metodo: "totp", quando: Math.floor(Date.now() / 1000) }] }),
  };
}

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({ auth: { admin: { signOut: async () => { a.signOuts++; return { error: null }; } } } }) }));
vi.mock("@/lib/admin/track", () => ({
  recordEvent: async (_t: string, e: unknown) => { b.eventos.push(e); },
  notifyTelegram: () => {}, logSecurity: () => {},
}));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => b.sessaoCarteira }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "__Host-zswap_admin" && b.cookie ? { value: b.cookie } : undefined) }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitDurable: async () => ({ ok: true, retryAfter: 0 }), getClientId: () => "ip" }));
vi.mock("@/lib/admin/require", () => ({ requireAdmin: async () => { throw new Error("NEXT_NOT_FOUND"); } }));
// SOLO FOUNDER (0088): depois da 0088 a governança existe e começa em `multi_admin` — o mundo destes testes.
vi.mock("@/lib/admin/corp/governanca-repo", () => ({
  repoGovernanca: () => ({ ler: async () => ({ ok: true, valor: { modo: "multi_admin", fundador: null } }) }),
}));

import { definirFabricaAuth } from "./auth-cliente";
import { definirRepoCorp } from "./repo";
import { lerConfigCorp } from "./config";
import { abrirFluxo, cifrarComAad, decifrarComAad, selarFluxo, voltaSegura } from "./selo";
import {
  abrirBreakglass, concluirCallback, iniciarLogin, iniciarMfa, janelaBreakglass, lerPrincipal, logout,
  novoCodigoDeAtivacao, stepUp, verificarMfa,
} from "./fluxo";
import { autorizarAdmin } from "@/lib/admin/authz";

const cfg = () => { const c = lerConfigCorp(ENV_CORP); if (!c.ok) throw new Error(c.motivo); return c.cfg; };
const ISS = "https://accounts.google.com";

function convidar(email = "ana@empresa.com", extra: Record<string, unknown> = {}) {
  const { codigo, hash } = novoCodigoDeAtivacao();
  const id = crypto.randomUUID();
  b.ids.push({ id, status: "invited", email_normalized: email, provider: "google", expected_issuer: ISS, expected_tenant: "empresa.com",
    auth_user_id: null, idp_subject: null, mfa_factor_id: null, mfa_enrolled_at: null,
    activation_code_hash: `\\x${hash.toString("hex")}`, activation_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    failed_mfa_count: 0, locked_until: null, ...extra });
  return { id, codigo };
}

async function loginAteMfa(email = "ana@empresa.com") {
  a.usuario = { authUserId: `uid-${email}`, email, emailVerificado: true, provedor: "google", sujeito: `sub-${email}`, issuer: ISS, tenant: "empresa.com" };
  const ini = await iniciarLogin(cfg(), "google", "/admin/area/x");
  if (!ini.ok) throw new Error("ini");
  const f = new URL(new URL(ini.url).searchParams.get("redirect_to")!).searchParams.get("f");
  return concluirCallback(cfg(), { code: "codigo-bom", f, erroIdp: null, cookieFluxo: ini.cookieFluxo });
}

async function sessaoAtiva(papeis: Papel[]) {
  const { id, codigo } = convidar(`u${Math.random()}@empresa.com`);
  const cb = await loginAteMfa(b.ids.find((i) => i.id === id)!.email_normalized as string);
  if (!cb.ok) throw new Error(cb.codigo);
  await iniciarMfa(cfg(), cb.tokenPre, codigo);
  const v = await verificarMfa(cfg(), cb.tokenPre, "123456");
  if (!v.ok) throw new Error(v.codigo);
  for (const r of papeis) b.papeis.push({ id: crypto.randomUUID(), identity_id: id, role: r, revoked_at: null });
  return { identityId: id, token: v.tokenAdmin };
}

beforeEach(() => {
  b.ids = []; b.sessoes = []; b.papeis = []; b.auditoria = []; b.fora = false; b.eventos = []; b.cookie = null; b.sessaoCarteira = null;
  a.usuario = null; a.codigoTotp = "123456"; a.aal = "aal2"; a.signOuts = 0; a.refreshValido = true; a.palpites = 0; a.multiplas = false;
  definirFabricaAuth(() => authFalso());
  definirRepoCorp(repoFalso());
  for (const [k, v] of Object.entries(ENV_CORP)) vi.stubEnv(k, v);
});
afterEach(() => { definirFabricaAuth(null); definirRepoCorp(null); vi.unstubAllEnvs(); });

describe("A-MODO · configuração", () => {
  it("legacy (ausente) desliga o R1; chave curta, origem http ou provedor estranho = desligado", () => {
    expect(lerConfigCorp({ ...ENV_CORP, ADMIN_AUTH_MODE: "" })).toMatchObject({ ok: false, motivo: "modo_legacy" });
    expect(lerConfigCorp({ ...ENV_CORP, ADMIN_SESSION_ENC_KEY: "curta" })).toMatchObject({ ok: false });
    expect(lerConfigCorp({ ...ENV_CORP, ADMIN_ORIGIN: "http://z.test" })).toMatchObject({ ok: false, motivo: "origem_invalida" });
    expect(lerConfigCorp({ ...ENV_CORP, ADMIN_IDP_PROVIDERS: "github" })).toMatchObject({ ok: false });
    expect(lerConfigCorp(ENV_CORP)).toMatchObject({ ok: true });
  });
});

describe("selo do fluxo e cifra do refresh", () => {
  it("fluxo: abre com a mesma chave; adulterado, expirado ou outra chave = null", async () => {
    const k = Buffer.alloc(32, 1);
    const t = await selarFluxo({ verificador: "v", provedor: "google", nonce: "n", volta: "/admin" }, k, 60);
    expect(await abrirFluxo(t, k)).toEqual({ verificador: "v", provedor: "google", nonce: "n", volta: "/admin" });
    expect(await abrirFluxo(`${t.slice(0, -3)}AAA`, k)).toBeNull();
    expect(await abrirFluxo(t, Buffer.alloc(32, 2))).toBeNull();
    expect(await abrirFluxo(t, k, Math.floor(Date.now() / 1000) + 120)).toBeNull();
  });
  it("refresh cifrado com AAD = id da sessão: copiado para outra linha, não abre", () => {
    const k = Buffer.alloc(32, 3);
    const c = cifrarComAad("rt-segredo", k, "sessao-A");
    expect(decifrarComAad(c, k, "sessao-A")).toBe("rt-segredo");
    expect(decifrarComAad(c, k, "sessao-B")).toBeNull();
  });
  it("volta só relativa dentro do Admin", () => {
    expect(voltaSegura("/admin/area/x")).toBe("/admin/area/x");
    for (const v of ["https://mal.com", "//mal.com", "/", "/admin\\..", 7]) expect(voltaSegura(v)).toBe("/admin");
  });
});

describe("A-PKCE · callback", () => {
  it("sem cookie de fluxo, nonce trocado ou cookie de outra chave → recusa auditada", async () => {
    a.usuario = { authUserId: "u", email: "x@e.com", emailVerificado: true, provedor: "google", sujeito: "s", issuer: ISS, tenant: null };
    const ini = await iniciarLogin(cfg(), "google", "/admin");
    if (!ini.ok) throw new Error();
    const f = new URL(new URL(ini.url).searchParams.get("redirect_to")!).searchParams.get("f");
    expect(await concluirCallback(cfg(), { code: "codigo-bom", f, erroIdp: null, cookieFluxo: undefined })).toEqual({ ok: false, codigo: "fluxo_ausente" });
    expect(await concluirCallback(cfg(), { code: "codigo-bom", f: "outro-nonce-xxxxxxxx", erroIdp: null, cookieFluxo: ini.cookieFluxo })).toEqual({ ok: false, codigo: "nonce" });
    const alheio = await selarFluxo({ verificador: "v", provedor: "google", nonce: f!, volta: "/admin" }, Buffer.alloc(32, 9), 60);
    expect(await concluirCallback(cfg(), { code: "codigo-bom", f, erroIdp: null, cookieFluxo: alheio })).toEqual({ ok: false, codigo: "fluxo_invalido" });
    expect(b.auditoria.every((l) => l.outcome === "denied")).toBe(true);
    expect(b.auditoria.length).toBe(3);
  });
  it("provedor não habilitado → recusa", async () => {
    expect(await iniciarLogin(lerConfigCorp({ ...ENV_CORP, ADMIN_IDP_PROVIDERS: "azure" }).ok ? (lerConfigCorp({ ...ENV_CORP, ADMIN_IDP_PROVIDERS: "azure" }) as { cfg: ReturnType<typeof cfg> }).cfg : cfg(), "google", "/admin"))
      .toEqual({ ok: false, codigo: "provedor" });
  });
});

describe("A-VINC · allowlist por convite + vínculo provider/sub", () => {
  it("convidado com e-mail verificado → vincula e abre sessão PRÉ-MFA (não serve para o Admin)", async () => {
    const { id } = convidar();
    const cb = await loginAteMfa();
    expect(cb.ok).toBe(true);
    expect(b.ids.find((i) => i.id === id)).toMatchObject({ auth_user_id: "uid-ana@empresa.com", idp_subject: "sub-ana@empresa.com" });
    if (!cb.ok) return;
    expect(await lerPrincipal(cb.tokenPre)).toEqual({ ok: false, codigo: "sessao_invalida" });
  });
  it("não convidado, e-mail não verificado, ou outro tenant → recusa e signOut GLOBAL no Supabase", async () => {
    expect(await loginAteMfa("estranho@empresa.com")).toEqual({ ok: false, codigo: "identidade_desconhecida" });
    convidar("bia@empresa.com");
    a.usuario = { authUserId: "u2", email: "bia@empresa.com", emailVerificado: false, provedor: "google", sujeito: "s2", issuer: ISS, tenant: "empresa.com" };
    const ini = await iniciarLogin(cfg(), "google", "/admin"); if (!ini.ok) throw new Error();
    const f = new URL(new URL(ini.url).searchParams.get("redirect_to")!).searchParams.get("f");
    expect(await concluirCallback(cfg(), { code: "codigo-bom", f, erroIdp: null, cookieFluxo: ini.cookieFluxo })).toEqual({ ok: false, codigo: "email_nao_verificado" });
    convidar("caio@empresa.com", { expected_tenant: "outra.com" });
    expect(await loginAteMfa("caio@empresa.com")).toEqual({ ok: false, codigo: "emissor_divergente" });
    expect(a.signOuts).toBe(3);
  });
  it("já vinculado: mesmo e-mail com OUTRO sub → recusa (e-mail mutável no IdP não sequestra a conta)", async () => {
    const { id } = convidar();
    await loginAteMfa();
    a.usuario = { ...a.usuario!, sujeito: "sub-impostor" };
    const ini = await iniciarLogin(cfg(), "google", "/admin"); if (!ini.ok) throw new Error();
    const f = new URL(new URL(ini.url).searchParams.get("redirect_to")!).searchParams.get("f");
    expect(await concluirCallback(cfg(), { code: "codigo-bom", f, erroIdp: null, cookieFluxo: ini.cookieFluxo })).toEqual({ ok: false, codigo: "vinculo_divergente" });
    expect(b.ids.find((i) => i.id === id)?.idp_subject).toBe("sub-ana@empresa.com");
  });
  it("banco fora no callback → recusa (leitura que falha não vira 'convidado')", async () => {
    convidar();
    b.fora = true;
    expect(await loginAteMfa()).toMatchObject({ ok: false, codigo: "banco" });
  });
});

describe("MFA · ativação, força bruta, aal2 e rotação (A-FIX)", () => {
  it("1º acesso SEM o código de ativação → não matricula TOTP", async () => {
    convidar();
    const cb = await loginAteMfa(); if (!cb.ok) throw new Error();
    expect(await iniciarMfa(cfg(), cb.tokenPre, "errado")).toEqual({ ok: false, codigo: "ativacao_invalida" });
  });
  it("ativação certa → QR; código certo → identidade ATIVA e sessão com ID NOVO (pré-MFA revogada)", async () => {
    const { id, codigo } = convidar();
    const cb = await loginAteMfa(); if (!cb.ok) throw new Error();
    const ini = await iniciarMfa(cfg(), cb.tokenPre, codigo);
    expect(ini).toMatchObject({ ok: true, precisaAtivacao: true, qrSvg: expect.stringContaining("svg") });
    const v = await verificarMfa(cfg(), cb.tokenPre, "123456");
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.tokenAdmin).not.toBe(cb.tokenPre);
    expect(b.ids.find((i) => i.id === id)?.status).toBe("active");
    const pre = b.sessoes.find((s) => s.state === "mfa_pending")!;
    const ativa = b.sessoes.find((s) => s.state === "active")!;
    expect(pre.revoked_at).not.toBeNull();
    expect(ativa.id).not.toBe(pre.id);
    expect(ativa.rotated_from).toBe(pre.id);
    expect(ativa.aal).toBe("aal2");
    // o token pré-MFA não vale mais para nada
    expect(await verificarMfa(cfg(), cb.tokenPre, "123456")).toMatchObject({ ok: false });
  });
  it("⚠️ 5 códigos errados → BLOQUEIO (contado no banco) + alerta alto; certo depois disso → recusado", async () => {
    const { codigo } = convidar();
    const cb = await loginAteMfa(); if (!cb.ok) throw new Error();
    await iniciarMfa(cfg(), cb.tokenPre, codigo);
    const r: unknown[] = [];
    for (let i = 0; i < 5; i++) r.push(await verificarMfa(cfg(), cb.tokenPre, "000000"));
    expect(r.slice(0, 4).map((x) => (x as { codigo: string }).codigo)).toEqual(Array(4).fill("codigo_invalido"));
    expect(r[4]).toEqual({ ok: false, codigo: "bloqueado" });
    expect(JSON.stringify(b.eventos)).toContain("admin_mfa_bloqueado");
    expect(await verificarMfa(cfg(), cb.tokenPre, "123456")).toEqual({ ok: false, codigo: "bloqueado" });
  });
  it("não conseguir CONTAR a falha → recusa (falha fechada)", async () => {
    const { codigo } = convidar();
    const cb = await loginAteMfa(); if (!cb.ok) throw new Error();
    await iniciarMfa(cfg(), cb.tokenPre, codigo);
    const repo = repoFalso();
    definirRepoCorp({ ...repo, registrarFalhaMfa: async () => ({ ok: false, erro: "fora" }) });
    expect(await verificarMfa(cfg(), cb.tokenPre, "000000")).toEqual({ ok: false, codigo: "banco" });
  });
  it("Supabase sem aal2 nas claims → sem sessão ativa (a prova vem do servidor, não do navegador)", async () => {
    const { codigo } = convidar();
    const cb = await loginAteMfa(); if (!cb.ok) throw new Error();
    await iniciarMfa(cfg(), cb.tokenPre, codigo);
    a.aal = "aal1";
    expect(await verificarMfa(cfg(), cb.tokenPre, "123456")).toEqual({ ok: false, codigo: "mfa_sem_prova" });
    expect(b.sessoes.filter((s) => s.state === "active")).toHaveLength(0);
  });
});

describe("principal, revogação (ADM-008), step-up e logout", () => {
  it("sessão ativa → principal com os papéis; revogada → recusa na PRÓXIMA requisição", async () => {
    const { token } = await sessaoAtiva(["auditor"]);
    expect(await lerPrincipal(token)).toMatchObject({ ok: true, principal: { kind: "corp", papeis: ["auditor"], stepUpOk: true } });
    await logout(token);
    expect(await lerPrincipal(token)).toEqual({ ok: false, codigo: "sessao_invalida" });
  });
  it("identidade revogada com sessão aberta → recusa (ADM-008)", async () => {
    const { identityId, token } = await sessaoAtiva(["operations"]);
    b.ids.find((i) => i.id === identityId)!.status = "revoked";
    expect(await lerPrincipal(token)).toEqual({ ok: false, codigo: "identidade_inativa" });
  });
  it("step-up velho é marcado; step-up com TOTP → id NOVO, o antigo morre", async () => {
    const { token } = await sessaoAtiva(["security_admin"]);
    const s = b.sessoes.find((x) => x.state === "active" && !x.revoked_at)!;
    s.step_up_at = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(await lerPrincipal(token)).toMatchObject({ ok: true, principal: { stepUpOk: false } });
    const r = await stepUp(cfg(), token, "123456");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tokenAdmin).not.toBe(token);
    expect(await lerPrincipal(token)).toEqual({ ok: false, codigo: "sessao_invalida" });
    expect(await lerPrincipal(r.tokenAdmin)).toMatchObject({ ok: true, principal: { stepUpOk: true } });
  });
  it("refresh do Supabase revogado → step-up exige login de novo", async () => {
    const { token } = await sessaoAtiva(["security_admin"]);
    a.refreshValido = false;
    expect(await stepUp(cfg(), token, "123456")).toEqual({ ok: false, codigo: "refresh_invalido" });
  });
});

describe("authz com sessão corporativa — RBAC em EXECUÇÃO", () => {
  it("⚠️ ADM-003: auditor tenta o kill switch → 404 e `denied` em admin_audit; nada do handler roda", async () => {
    const { token } = await sessaoAtiva(["auditor"]);
    b.cookie = token;
    await expect(autorizarAdmin("security.killswitch.set")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(b.auditoria.some((l) => l.action === "security.killswitch.set" && l.outcome === "denied" && l.failure_code === "papel_sem_permissao")).toBe(true);
    // leitura que o auditor TEM continua passando
    await expect(autorizarAdmin("security.killswitch.read")).resolves.toMatchObject({ fonte: "corp" });
  });
  it("security_admin com step-up fresco liga o kill switch; com step-up velho → 404 (step_up_expirado)", async () => {
    const { identityId, token } = await sessaoAtiva(["security_admin"]);
    b.cookie = token;
    await expect(autorizarAdmin("security.killswitch.set")).resolves.toMatchObject({ wallet: `corp:${identityId}`, fonte: "corp" });
    b.sessoes.find((x) => x.state === "active" && !x.revoked_at)!.step_up_at = new Date(Date.now() - 10 * 60_000).toISOString();
    await expect(autorizarAdmin("security.killswitch.set")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(b.auditoria.some((l) => l.failure_code === "step_up_expirado")).toBe(true);
  });
  it("corp: sem cookie → 404 (nem carteira de ADMIN_WALLETS entra); cookie revogado → 404", async () => {
    vi.stubEnv("ADMIN_AUTH_MODE", "corp");
    await expect(autorizarAdmin("security.killswitch.read")).rejects.toThrow("NEXT_NOT_FOUND");
    const { token } = await sessaoAtiva(["security_admin"]);
    b.cookie = token;
    await expect(autorizarAdmin("security.killswitch.read")).resolves.toMatchObject({ fonte: "corp" });
    await logout(token);
    await expect(autorizarAdmin("security.killswitch.read")).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("⚠️ A-MODO: em legacy o cookie corporativo NEM É LIDO — a decisão é a de antes (requireAdmin)", async () => {
    const { token } = await sessaoAtiva(["superadmin"]);
    b.cookie = token;
    vi.stubEnv("ADMIN_AUTH_MODE", "");
    // requireAdmin (mockado) nega: se o cookie corporativo fosse aceito em legacy, isto passaria.
    await expect(autorizarAdmin("security.killswitch.read")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("ADM-012 · break-glass", () => {
  it("só em corp, janela no futuro ≤ 24 h e carteira de ADMIN_WALLETS", async () => {
    const c = lerConfigCorp({ ...ENV_CORP, ADMIN_AUTH_MODE: "corp" });
    if (!c.ok) throw new Error();
    const futuro = new Date(Date.now() + 30 * 60_000).toISOString();
    expect(janelaBreakglass({ ADMIN_BREAKGLASS_UNTIL: new Date(Date.now() + 25 * 3600_000).toISOString() }).aberta).toBe(false);
    expect(await abrirBreakglass(cfg(), "0xdono", { ADMIN_BREAKGLASS_UNTIL: futuro, ADMIN_WALLETS: "0xdono" })).toEqual({ ok: false, codigo: "config" });
    expect(await abrirBreakglass(c.cfg, "0xdono", { ADMIN_WALLETS: "0xdono" })).toEqual({ ok: false, codigo: "janela_fechada" });
    expect(await abrirBreakglass(c.cfg, "0xoutro", { ADMIN_BREAKGLASS_UNTIL: futuro, ADMIN_WALLETS: "0xdono" })).toEqual({ ok: false, codigo: "carteira_nao_autorizada" });
    const ok = await abrirBreakglass(c.cfg, "0xDONO", { ADMIN_BREAKGLASS_UNTIL: futuro, ADMIN_WALLETS: "0xdono" });
    expect(ok.ok).toBe(true);
    expect(JSON.stringify(b.eventos)).toContain("admin_breakglass_usado");
    if (!ok.ok) return;
    // dentro da janela: trava incidente (kill switch) mas NÃO exporta dinheiro
    vi.stubEnv("ADMIN_AUTH_MODE", "corp"); vi.stubEnv("ADMIN_BREAKGLASS_UNTIL", futuro); vi.stubEnv("ADMIN_WALLETS", "0xdono");
    b.cookie = ok.tokenAdmin;
    await expect(autorizarAdmin("security.killswitch.set")).resolves.toMatchObject({ fonte: "breakglass" });
    await expect(autorizarAdmin("finance.ledger.export")).rejects.toThrow("NEXT_NOT_FOUND");
    // carteira tirada de ADMIN_WALLETS no meio da janela → a sessão de emergência morre na hora
    vi.stubEnv("ADMIN_WALLETS", "0xoutra");
    await expect(autorizarAdmin("security.killswitch.set")).rejects.toThrow("NEXT_NOT_FOUND");
    vi.stubEnv("ADMIN_WALLETS", "0xdono");
    // e voltar a `dual` também a mata (break-glass só existe em `corp`)
    vi.stubEnv("ADMIN_AUTH_MODE", "dual");
    await expect(lerPrincipal(ok.tokenAdmin)).resolves.toEqual({ ok: false, codigo: "janela_fechada" });
    vi.stubEnv("ADMIN_AUTH_MODE", "corp");
    // janela fechada → a sessão de emergência morre na próxima requisição
    vi.stubEnv("ADMIN_BREAKGLASS_UNTIL", "");
    await expect(autorizarAdmin("security.killswitch.set")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("A-CSRF e 404 das rotas", () => {
  it("POST do MFA sem Origin, com Origin alheia ou sem JSON → 403 antes de qualquer efeito", async () => {
    const { POST } = await import("@/app/api/admin-auth/mfa/route");
    const req = (h: Record<string, string>) => new NextRequest("https://z.test/api/admin-auth/mfa", { method: "POST", headers: h, body: "{}" });
    expect((await POST(req({ "content-type": "application/json" }))).status).toBe(403);
    expect((await POST(req({ origin: "https://mal.com", "content-type": "application/json" }))).status).toBe(403);
    expect((await POST(req({ origin: "https://z.test", "content-type": "text/plain" }))).status).toBe(403);
    expect((await POST(req({ origin: "https://z.test", "content-type": "application/json", "sec-fetch-site": "cross-site" }))).status).toBe(403);
  });
  it("em legacy (padrão) TODAS as rotas de login corporativo respondem 404", async () => {
    vi.stubEnv("ADMIN_AUTH_MODE", "");
    const start = await import("@/app/api/admin-auth/start/route");
    const mfa = await import("@/app/api/admin-auth/mfa/route");
    const bg = await import("@/app/api/admin-auth/breakglass/route");
    expect((await start.GET(new NextRequest("https://z.test/api/admin-auth/start?provider=google"))).status).toBe(404);
    expect((await mfa.POST(new NextRequest("https://z.test/x", { method: "POST", headers: { origin: "https://z.test", "content-type": "application/json" }, body: "{}" }))).status).toBe(404);
    expect((await bg.POST(new NextRequest("https://z.test/x", { method: "POST", headers: { origin: "https://z.test", "content-type": "application/json" }, body: "{}" }))).status).toBe(404);
  });
  it("callback: o cookie de fluxo é de USO ÚNICO (apagado em toda resposta, inclusive na recusa)", async () => {
    const { GET } = await import("@/app/api/admin-auth/callback/route");
    const r = await GET(new NextRequest("https://z.test/api/admin-auth/callback?code=x&f=y", { headers: { cookie: "__Host-zswap_admin_flow=lixo" } }));
    expect(r.status).toBe(302);
    expect(r.headers.get("set-cookie") ?? "").toMatch(/__Host-zswap_admin_flow=;.*Max-Age=0/i);
  });
});

describe("revisão adversarial rodada 3 — regressões", () => {
  it("⚠️ R1-IDENT0: conta com MAIS DE UMA identidade (auto-link) → recusada", async () => {
    convidar();
    a.multiplas = true;
    expect(await loginAteMfa()).toEqual({ ok: false, codigo: "vinculo_divergente" });
  });
  it("⚠️ R1-IDENT0: login que voltou de OUTRO provedor que o pedido → recusado", async () => {
    convidar();
    a.usuario = { authUserId: "u", email: "ana@empresa.com", emailVerificado: true, provedor: "azure", sujeito: "s", issuer: ISS, tenant: "empresa.com" };
    const ini = await iniciarLogin(cfg(), "google", "/admin"); if (!ini.ok) throw new Error();
    const f = new URL(new URL(ini.url).searchParams.get("redirect_to")!).searchParams.get("f");
    expect(await concluirCallback(cfg(), { code: "codigo-bom", f, erroIdp: null, cookieFluxo: ini.cookieFluxo })).toEqual({ ok: false, codigo: "vinculo_divergente" });
  });
  it("⚠️ R1-TENANT-NULO: convite com tenant esperado e claim AUSENTE (conta Google pessoal) → recusado", async () => {
    convidar();
    a.usuario = { authUserId: "u", email: "ana@empresa.com", emailVerificado: true, provedor: "google", sujeito: "s", issuer: ISS, tenant: null };
    const ini = await iniciarLogin(cfg(), "google", "/admin"); if (!ini.ok) throw new Error();
    const f = new URL(new URL(ini.url).searchParams.get("redirect_to")!).searchParams.get("f");
    expect(await concluirCallback(cfg(), { code: "codigo-bom", f, erroIdp: null, cookieFluxo: ini.cookieFluxo })).toEqual({ ok: false, codigo: "emissor_divergente" });
  });
  it("⚠️ R1-MFA-CAS: 10 palpites SIMULTÂNEOS → no máximo 5 códigos testados, e bloqueio", async () => {
    const { codigo } = convidar();
    const cb = await loginAteMfa(); if (!cb.ok) throw new Error();
    await iniciarMfa(cfg(), cb.tokenPre, codigo);
    a.palpites = 0;
    const r = await Promise.all(Array.from({ length: 10 }, () => verificarMfa(cfg(), cb.tokenPre, "000000")));
    expect(a.palpites).toBeLessThanOrEqual(5);
    expect(r.every((x) => !x.ok)).toBe(true);
    expect(await verificarMfa(cfg(), cb.tokenPre, "123456")).toEqual({ ok: false, codigo: "bloqueado" });
  });
  it("acerto depois de erros zera o contador (o reservado não vira bloqueio de quem acertou)", async () => {
    const { id, codigo } = convidar();
    const cb = await loginAteMfa(); if (!cb.ok) throw new Error();
    await iniciarMfa(cfg(), cb.tokenPre, codigo);
    await verificarMfa(cfg(), cb.tokenPre, "000000");
    expect((await verificarMfa(cfg(), cb.tokenPre, "123456")).ok).toBe(true);
    expect(b.ids.find((i) => i.id === id)?.failed_mfa_count).toBe(0);
  });
  it("R1-LOGOUT-PARCIAL: logout revoga a sessão do Admin E a pré-MFA deste navegador, e encerra a do Supabase", async () => {
    const { token } = await sessaoAtiva(["auditor"]);
    convidar("pre@empresa.com");
    const cb = await loginAteMfa("pre@empresa.com"); if (!cb.ok) throw new Error();
    a.signOuts = 0;
    await logout(token, cb.tokenPre, cfg());
    expect(b.sessoes.filter((x) => !x.revoked_at)).toHaveLength(0);
    expect(a.signOuts).toBeGreaterThanOrEqual(1);
  });
});
