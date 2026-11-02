/**
 * SOLO FOUNDER MODE — bootstrap, recuperação e transição, pela ROTA `/api/admin-auth/fundador`.
 * Missão §8: 1–5 e 7–8, 10 (o 6 — concorrência — é provado com PostgreSQL de verdade em
 * `supabase/tests/29b_admin_solo_founder_concorrencia.sh`; aqui só a recusa no app).
 * Repositórios FALSOS que imitam as regras da RPC (as regras reais: `supabase/tests/29_*.sql`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash, randomBytes } from "node:crypto";

const FUNDADOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMUM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const b = vi.hoisted(() => ({
  sessoes: [] as Record<string, unknown>[],
  ids: [] as Record<string, unknown>[],
  trilha: [] as Record<string, unknown>[],
  eventos: [] as string[],
  gov: { modo: "multi_admin", fundador: null as string | null },
  consumidos: new Set<string>(),
  rpc: [] as Record<string, unknown>[],
  gateMulti: false,
  carteira: null as string | null,
  fatoresApagados: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/admin/corp/repo", () => ({
  repoCorp: () => ({
    sessaoPorHash: async (h: Buffer) => ({ ok: true, valor: b.sessoes.find((s) => s.token_hash === `\\x${h.toString("hex")}`) ?? null }),
    identidadePorId: async (id: string) => ({ ok: true, valor: b.ids.find((i) => i.id === id) ?? null }),
    auditar: async (l: Record<string, unknown>) => { b.trilha.push(l); return { ok: true, valor: true }; },
  }),
}));
vi.mock("@/lib/admin/corp/governanca-repo", () => ({
  repoGovernanca: () => ({
    ler: async () => ({ ok: true, valor: b.gov }),
    // imita founder_bootstrap (0088): uma vez; token consumido não volta
    bootstrap: async (a: { identityId: string; sessionId: string; tokenSha256: Buffer; emailFundador: string }) => {
      b.rpc.push({ fn: "bootstrap", ...a, tokenSha256: a.tokenSha256.toString("hex") });
      if (b.gov.fundador) return { ok: true, valor: "ja_feito" };
      if (b.consumidos.has(a.tokenSha256.toString("hex"))) return { ok: true, valor: "autorizacao_usada" };
      b.consumidos.add(a.tokenSha256.toString("hex"));
      b.gov = { modo: "solo_founder", fundador: a.identityId };
      return { ok: true, valor: "ok" };
    },
    resetMfa: async (a: { tokenSha256: Buffer; ativacaoHash: Buffer }) => {
      b.rpc.push({ fn: "resetMfa", ativacao: a.ativacaoHash.toString("hex") });
      if (b.gov.modo !== "solo_founder") return { ok: true, valor: { codigo: "nao_solo" } };
      if (b.consumidos.has(a.tokenSha256.toString("hex"))) return { ok: true, valor: { codigo: "autorizacao_usada" } };
      b.consumidos.add(a.tokenSha256.toString("hex"));
      return { ok: true, valor: { codigo: "ok", fatorAntigo: "11111111-1111-4111-8111-111111111111", authUserId: "uid-f", identidade: FUNDADOR } };
    },
    paraMulti: async () => {
      b.rpc.push({ fn: "paraMulti" });
      if (b.gov.modo !== "solo_founder") return { ok: true, valor: "nao_solo" };
      if (!b.gateMulti) return { ok: true, valor: "gate_multi_incompleto" };
      b.gov = { ...b.gov, modo: "multi_admin" };
      return { ok: true, valor: "ok" };
    },
  }),
}));
vi.mock("@/lib/admin/auditoria-duravel", () => ({ logSecurityAguardado: async (k: string) => { b.eventos.push(k); } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitDurable: async () => ({ ok: true, retryAfter: 0 }), getClientId: () => "ip" }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => (b.carteira ? { sub: b.carteira } : null) }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ auth: { admin: { mfa: { deleteFactor: async (p: Record<string, unknown>) => { b.fatoresApagados.push(p); return { error: null }; } } } } }),
}));

import { POST } from "@/app/api/admin-auth/fundador/route";
import { lerConfigFundador, formatoDeAutorizacao } from "./fundador";
import { hashDoToken, novoTokenDeSessao } from "@/lib/admin/sessao-corporativa";

const ORIGEM = "https://z.test";
const novoToken = () => `zfb_${randomBytes(32).toString("base64url")}`;
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const daqui = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

let autBoot = ""; let autRec = "";
function env(extra: Record<string, string> = {}) {
  const base: Record<string, string> = {
    ADMIN_AUTH_MODE: "dual", ADMIN_SESSION_ENC_KEY: Buffer.alloc(32, 7).toString("base64"), ADMIN_ORIGIN: ORIGEM,
    SUPABASE_URL: "https://sb.test", SUPABASE_ANON_KEY: "anon", ADMIN_WALLETS: "0xdono,0xoutro",
    ADMIN_FOUNDER_EMAIL: "dono@empresa.com",
    ADMIN_FOUNDER_BOOTSTRAP_SHA256: sha(autBoot), ADMIN_FOUNDER_BOOTSTRAP_UNTIL: daqui(2),
    ADMIN_FOUNDER_RECOVERY_SHA256: sha(autRec), ADMIN_FOUNDER_RECOVERY_UNTIL: daqui(2),
  };
  for (const [k, v] of Object.entries({ ...base, ...extra })) vi.stubEnv(k, v);
}

function identidade(id: string, email: string, extra: Record<string, unknown> = {}) {
  b.ids.push({ id, status: "active", email_normalized: email, mfa_enrolled_at: "2026-11-01T00:00:00Z",
    mfa_factor_id: "22222222-2222-4222-8222-222222222222", auth_user_id: `uid-${id.slice(0, 4)}`, idp_subject: `sub-${id.slice(0, 4)}`, ...extra });
}
/** Sessão corporativa; `stepUpHaMin` = minutos desde o último TOTP. */
function sessao(identityId: string, o: { stepUpHaMin?: number; state?: string; aal?: string; expiraEmMin?: number; revogada?: boolean } = {}) {
  const token = novoTokenDeSessao();
  const agora = Date.now();
  b.sessoes.push({
    id: crypto.randomUUID(), token_hash: `\\x${hashDoToken(token).toString("hex")}`, kind: "corp", state: o.state ?? "active",
    identity_id: identityId, created_at: new Date(agora - 60_000).toISOString(), last_seen_at: new Date(agora).toISOString(),
    absolute_expires_at: new Date(agora + (o.expiraEmMin ?? 480) * 60_000).toISOString(), idle_timeout_s: 1800,
    aal: o.aal ?? "aal2", mfa_verified_at: new Date(agora - 60_000).toISOString(),
    step_up_at: new Date(agora - (o.stepUpHaMin ?? 1) * 60_000).toISOString(), revoked_at: o.revogada ? new Date(agora).toISOString() : null,
  });
  return token;
}

function pedir(corpo: unknown, o: { cookie?: string; origem?: string | null; tipo?: string } = {}) {
  const headers: Record<string, string> = { "content-type": o.tipo ?? "application/json" };
  if (o.origem !== null) headers.origin = o.origem ?? ORIGEM;
  if (o.cookie) headers.cookie = `__Host-zswap_admin=${o.cookie}`;
  return POST(new NextRequest(`${ORIGEM}/api/admin-auth/fundador`, { method: "POST", headers, body: JSON.stringify(corpo) }));
}
const corpoDe = async (r: Response) => r.json().catch(() => null) as Promise<Record<string, unknown> | null>;

beforeEach(() => {
  b.sessoes = []; b.ids = []; b.trilha = []; b.eventos = []; b.rpc = []; b.consumidos = new Set(); b.gateMulti = false;
  b.gov = { modo: "multi_admin", fundador: null }; b.carteira = null; b.fatoresApagados = [];
  autBoot = novoToken(); autRec = novoToken();
  identidade(FUNDADOR, "dono@empresa.com");
  identidade(COMUM, "ops@empresa.com");
  env();
});
afterEach(() => vi.unstubAllEnvs());

describe("configuração do servidor", () => {
  it("sem e-mail do fundador = desligado; janela > 24 h, no passado ou hash malformado = sem autorização", () => {
    expect(lerConfigFundador({})).toBeNull();
    const base = { ADMIN_FOUNDER_EMAIL: "Dono@Empresa.com " };
    expect(lerConfigFundador(base)?.email).toBe("dono@empresa.com");
    expect(lerConfigFundador({ ...base, ADMIN_FOUNDER_BOOTSTRAP_SHA256: sha("x"), ADMIN_FOUNDER_BOOTSTRAP_UNTIL: daqui(25) })?.bootstrap).toBeNull();
    expect(lerConfigFundador({ ...base, ADMIN_FOUNDER_BOOTSTRAP_SHA256: sha("x"), ADMIN_FOUNDER_BOOTSTRAP_UNTIL: daqui(-1) })?.bootstrap).toBeNull();
    expect(lerConfigFundador({ ...base, ADMIN_FOUNDER_BOOTSTRAP_SHA256: "abc", ADMIN_FOUNDER_BOOTSTRAP_UNTIL: daqui(1) })?.bootstrap).toBeNull();
    expect(lerConfigFundador({ ...base, ADMIN_FOUNDER_BOOTSTRAP_SHA256: sha("x"), ADMIN_FOUNDER_BOOTSTRAP_UNTIL: daqui(1) })?.bootstrap).not.toBeNull();
  });
  it("a variável PÚBLICA não serve: só ADMIN_FOUNDER_EMAIL do servidor", () => {
    expect(lerConfigFundador({ NEXT_PUBLIC_ADMIN_FOUNDER_EMAIL: "dono@empresa.com" })).toBeNull();
  });
  it("formato da autorização: zfb_ + 43 base64url", () => {
    expect(formatoDeAutorizacao(novoToken())).toBe(true);
    expect(formatoDeAutorizacao("zfb_curto")).toBe(false);
    expect(formatoDeAutorizacao(`xyz_${randomBytes(32).toString("base64url")}`)).toBe(false);
  });
});

describe("bootstrap — UMA identidade basta (missão §8 item 1)", () => {
  it("fundador verificado + step-up recente + autorização certa → superadmin, solo_founder, alerta", async () => {
    const r = await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(FUNDADOR) });
    expect(r.status).toBe(200);
    expect(await corpoDe(r)).toMatchObject({ ok: true, modo: "solo_founder" });
    expect(b.gov).toEqual({ modo: "solo_founder", fundador: FUNDADOR });
    // a RPC recebe o sha256 (nunca o token) e a sessão que provou o MFA
    expect(b.rpc[0]).toMatchObject({ fn: "bootstrap", identityId: FUNDADOR, tokenSha256: sha(autBoot), emailFundador: "dono@empresa.com" });
    expect(JSON.stringify(b.rpc)).not.toContain(autBoot);
    expect(b.eventos).toContain("admin_fundador_bootstrap");
  });
});

describe("bootstrap — recusas (missão §8 itens 2–5, 7)", () => {
  const recusado = async (r: Response) => { expect(r.status).toBe(403); expect(await corpoDe(r)).toEqual({ ok: false, erro: "recusado" }); };
  it("2 · usuário comum (identidade ativa com MFA, mas não é o fundador) → recusado, RPC nem chamada", async () => {
    await recusado(await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(COMUM) }));
    expect(b.rpc).toHaveLength(0);
    expect(b.trilha.at(-1)).toMatchObject({ authz_decision: "deny", failure_code: "nao_e_o_fundador" });
    expect(b.eventos).toContain("admin_fundador_recusado");
  });
  it("3 · identidade não verificada (sem TOTP / sem vínculo de IdP / convidada) → recusado", async () => {
    for (const extra of [{ mfa_enrolled_at: null }, { idp_subject: null }, { status: "invited" }]) {
      b.ids[0] = { ...b.ids[0], ...extra };
      await recusado(await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(FUNDADOR) }));
      b.ids[0] = { ...b.ids[0], mfa_enrolled_at: "2026-11-01T00:00:00Z", idp_subject: "sub-aaaa", status: "active" };
    }
    expect(b.rpc).toHaveLength(0);
  });
  it("4 · sem MFA recente (step-up de 10 min), sessão pré-MFA ou aal1 → recusado", async () => {
    await recusado(await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(FUNDADOR, { stepUpHaMin: 10 }) }));
    expect(b.trilha.at(-1)).toMatchObject({ failure_code: "sem_mfa_recente" });
    await recusado(await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(FUNDADOR, { state: "mfa_pending" }) }));
    await recusado(await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(FUNDADOR, { aal: "aal1" }) }));
    expect(b.rpc).toHaveLength(0);
  });
  it("4 · sem sessão corporativa nenhuma (só a autorização) → recusado", async () => {
    await recusado(await pedir({ acao: "bootstrap", autorizacao: autBoot }));
    expect(b.rpc).toHaveLength(0);
  });
  it("autorização errada, de recuperação ou malformada → recusado (a sessão sozinha não basta)", async () => {
    for (const aut of [novoToken(), autRec, "zfb_x", null]) {
      await recusado(await pedir({ acao: "bootstrap", autorizacao: aut }, { cookie: sessao(FUNDADOR) }));
    }
    expect(b.rpc).toHaveLength(0);
  });
  it("5 · repetido → recusado (o banco diz ja_feito); o token usado não vale de novo", async () => {
    expect((await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(FUNDADOR) })).status).toBe(200);
    await recusado(await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(FUNDADOR) }));
    expect(b.trilha.at(-1)).toMatchObject({ failure_code: "recusado_no_banco:ja_feito" });
  });
  it("6 (app) · dois pedidos simultâneos: no máximo um vira fundador", async () => {
    const [r1, r2] = await Promise.all([
      pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(FUNDADOR) }),
      pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(FUNDADOR) }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 403]);
  });
  it("7 · sessão expirada ou revogada → recusado", async () => {
    await recusado(await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(FUNDADOR, { expiraEmMin: -1 }) }));
    await recusado(await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(FUNDADOR, { revogada: true }) }));
    expect(b.rpc).toHaveLength(0);
  });
});

describe("a rota rejeita não autorizado (missão §8 item 8)", () => {
  it("legacy (produção hoje): a rota NÃO existe (404)", async () => {
    vi.stubEnv("ADMIN_AUTH_MODE", "");
    expect((await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(FUNDADOR) })).status).toBe(404);
  });
  it("sem ADMIN_FOUNDER_EMAIL: 404; janela de bootstrap vencida: 404 (recurso desligado)", async () => {
    vi.stubEnv("ADMIN_FOUNDER_EMAIL", "");
    expect((await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(FUNDADOR) })).status).toBe(404);
    env({ ADMIN_FOUNDER_BOOTSTRAP_UNTIL: daqui(-1) });
    expect((await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(FUNDADOR) })).status).toBe(404);
  });
  it("CSRF: sem Origin, Origin alheia ou corpo não-JSON → 403 antes de qualquer efeito", async () => {
    const c = sessao(FUNDADOR);
    expect((await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: c, origem: null })).status).toBe(403);
    expect((await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: c, origem: "https://mal.test" })).status).toBe(403);
    expect((await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: c, tipo: "text/plain" })).status).toBe(403);
    expect(b.rpc).toHaveLength(0);
  });
  it("ação desconhecida → 400", async () => {
    expect((await pedir({ acao: "virar_admin" }, { cookie: sessao(FUNDADOR) })).status).toBe(400);
  });
});

describe("recuperação de MFA do fundador (sem segunda pessoa)", () => {
  beforeEach(() => { b.gov = { modo: "solo_founder", fundador: FUNDADOR }; });
  it("carteira de ADMIN_WALLETS + autorização de recuperação → novo código UMA vez; fator antigo apagado no Supabase", async () => {
    b.carteira = "0xDONO";
    const r = await pedir({ acao: "recuperar_mfa", autorizacao: autRec });
    expect(r.status).toBe(200);
    const j = await corpoDe(r);
    expect(j).toMatchObject({ ok: true, validoPorHoras: 72, fatorSupabase: "removido" });
    // o banco recebe só o HASH do código de ativação
    expect(b.rpc[0]).toMatchObject({ fn: "resetMfa", ativacao: sha(String(j?.codigoAtivacao)) });
    expect(b.fatoresApagados).toEqual([{ id: "11111111-1111-4111-8111-111111111111", userId: "uid-f" }]);
    expect(b.eventos).toContain("admin_fundador_mfa_reset");
  });
  it("carteira fora de ADMIN_WALLETS, sem carteira, ou com a autorização do BOOTSTRAP → recusado", async () => {
    b.carteira = "0xestranho";
    expect((await pedir({ acao: "recuperar_mfa", autorizacao: autRec })).status).toBe(403);
    b.carteira = null;
    expect((await pedir({ acao: "recuperar_mfa", autorizacao: autRec })).status).toBe(403);
    b.carteira = "0xdono";
    expect((await pedir({ acao: "recuperar_mfa", autorizacao: autBoot })).status).toBe(403);
    expect(b.rpc).toHaveLength(0);
  });
  it("recuperação repetida → recusada (uso único)", async () => {
    b.carteira = "0xdono";
    expect((await pedir({ acao: "recuperar_mfa", autorizacao: autRec })).status).toBe(200);
    expect((await pedir({ acao: "recuperar_mfa", autorizacao: autRec })).status).toBe(403);
  });
  it("fora de solo_founder a recuperação não existe no banco (nao_solo) → recusado", async () => {
    b.gov = { modo: "multi_admin", fundador: null };
    b.carteira = "0xdono";
    expect((await pedir({ acao: "recuperar_mfa", autorizacao: autRec })).status).toBe(403);
  });
});

describe("transição para multi_admin (missão §8 item 10)", () => {
  beforeEach(() => { b.gov = { modo: "solo_founder", fundador: FUNDADOR }; });
  it("sem o gate de 2 pessoas no banco → recusado; com o gate → multi_admin", async () => {
    expect((await pedir({ acao: "transicionar_multi" }, { cookie: sessao(FUNDADOR) })).status).toBe(403);
    expect(b.gov.modo).toBe("solo_founder");
    b.gateMulti = true;
    const r = await pedir({ acao: "transicionar_multi" }, { cookie: sessao(FUNDADOR) });
    expect(r.status).toBe(200);
    expect(b.gov.modo).toBe("multi_admin");
    expect(b.eventos).toContain("admin_governanca_multi");
  });
  it("sem step-up recente → recusado antes do banco", async () => {
    b.gateMulti = true;
    expect((await pedir({ acao: "transicionar_multi" }, { cookie: sessao(FUNDADOR, { stepUpHaMin: 30 }) })).status).toBe(403);
    expect(b.rpc).toHaveLength(0);
  });
});

describe("nada de segredo na resposta (missão §8 item 12)", () => {
  it("nenhuma resposta ecoa o token, o hash da env ou o e-mail do fundador", async () => {
    const respostas = [
      await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(COMUM) }),
      await pedir({ acao: "bootstrap", autorizacao: autBoot }, { cookie: sessao(FUNDADOR) }),
    ];
    for (const r of respostas) {
      const t = JSON.stringify(await corpoDe(r));
      expect(t).not.toContain(autBoot);
      expect(t).not.toContain(sha(autBoot));
      expect(t).not.toContain("dono@empresa.com");
    }
  });
});
