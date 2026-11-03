/**
 * SOLO FOUNDER MODE — decisão do Admin (`authz.ts`) sob a governança da 0088.
 * Missão §8: 8 (endpoints rejeitam não autorizado), 9 (operações críticas), 10 (MULTI sem quebrar
 * RBAC) e 12 (nada administrativo no frontend). Principal corporativo e legado FALSOS; nada real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Papel } from "@/lib/admin/rbac";

const FUNDADOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const s = vi.hoisted(() => ({
  cookie: null as string | null,
  principal: null as null | { ok: true; principal: Record<string, unknown> } | { ok: false; codigo: string },
  legado: null as null | { wallet: string; fonte: "env" | "panel" | "tier" },
  gov: { ok: true, valor: { modo: "solo_founder", fundador: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } } as
    { ok: true; valor: { modo: string; fundador: string | null } } | { ok: false; erro: string },
  eventos: [] as { kind: string; meta: Record<string, unknown> }[],
  trilha: [] as Record<string, unknown>[],
}));

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "__Host-zswap_admin" && s.cookie ? { value: s.cookie } : undefined) }) }));
vi.mock("@/lib/admin/corp/config", () => ({ lerConfigCorp: () => ({ ok: true, cfg: {} }) }));
vi.mock("@/lib/admin/corp/fluxo", () => ({ lerPrincipal: async () => s.principal }));
vi.mock("@/lib/admin/corp/repo", () => ({ repoCorp: () => ({ auditar: async (l: Record<string, unknown>) => { s.trilha.push(l); return { ok: true, valor: true }; } }) }));
vi.mock("@/lib/admin/corp/governanca-repo", () => ({ repoGovernanca: () => ({ ler: async () => s.gov }) }));
vi.mock("@/lib/admin/require", () => ({
  requireAdmin: async () => { if (!s.legado) throw new Error("NEXT_NOT_FOUND"); return s.legado; },
}));
vi.mock("@/lib/admin/auditoria-duravel", () => ({
  logSecurityAguardado: async (kind: string, meta: Record<string, unknown>) => { s.eventos.push({ kind, meta }); },
}));
vi.mock("@/lib/admin/track", () => ({ recordEvent: async () => {} }));

const { autorizarAdmin } = await import("./authz");
const { classeDeRisco, SEGREGADAS_SOLO } = await import("./risco");
const { ACOES } = await import("./acoes");

const corp = (identityId: string, papeis: Papel[], stepUpOk = true) => {
  s.cookie = "za1_qualquer";
  s.principal = { ok: true, principal: { kind: "corp", identityId, sessionId: "sess", papeis, stepUpOk } };
};
const NEGADO = "NEXT_NOT_FOUND";
const eventos = () => s.eventos.map((e) => e.kind);

beforeEach(() => {
  s.cookie = null; s.principal = null; s.legado = null; s.eventos = []; s.trilha = [];
  s.gov = { ok: true, valor: { modo: "solo_founder", fundador: FUNDADOR } };
  vi.stubEnv("ADMIN_AUTH_MODE", "dual");
  vi.stubEnv("ADMIN_LEGACY_SOURCES", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("classes de risco (derivadas da matriz)", () => {
  it("read → baixo · write → moderado · sensível/identidade/financeiro → alto · exceções → segregado", () => {
    expect(classeDeRisco("finance.summary.read")).toBe("baixo");
    expect(classeDeRisco("lab.calibration.run")).toBe("moderado");
    expect(classeDeRisco("finance.margin.set")).toBe("alto");
    expect(classeDeRisco("security.killswitch.set")).toBe("alto");
    expect(classeDeRisco("users.tier.write")).toBe("alto");
    expect(classeDeRisco("trading.automation.write")).toBe("segregado");
    expect(classeDeRisco("identity.admins.write")).toBe("segregado");
    expect(classeDeRisco("pagina:shell")).toBe("baixo");
    expect(classeDeRisco("acao.que.nao.existe")).toBe("alto");   // desconhecida: na dúvida, alta
  });
  it("toda ação segregada existe na matriz (nada de id fantasma)", () => {
    for (const a of SEGREGADAS_SOLO) expect(ACOES).toHaveProperty(a);
  });
});

describe("solo_founder — só o fundador governa (missão §8 item 8)", () => {
  it("fundador com superadmin e step-up: baixo e alto passam; alto vira evento de segurança", async () => {
    corp(FUNDADOR, ["superadmin"]);
    await expect(autorizarAdmin("finance.summary.read")).resolves.toMatchObject({ fonte: "corp" });
    expect(eventos()).not.toContain("admin_solo_alto_risco");
    await expect(autorizarAdmin("finance.margin.set")).resolves.toMatchObject({ fonte: "corp" });
    expect(eventos()).toContain("admin_solo_alto_risco");
  });
  it("OUTRA identidade com papel gravado (ex.: por SQL) é negada, com trilha `denied`", async () => {
    corp(OUTRO, ["superadmin"]);
    await expect(autorizarAdmin("finance.summary.read")).rejects.toThrow(NEGADO);
    expect(eventos()).toContain("admin_solo_nao_fundador");
    expect(s.trilha.at(-1)).toMatchObject({ authz_decision: "deny", failure_code: "solo_nao_fundador" });
  });
  it("sem sessão nenhuma → 404 (nada de carteira comum)", async () => {
    await expect(autorizarAdmin("finance.summary.read")).rejects.toThrow(NEGADO);
  });
});

describe("solo_founder — operações críticas (missão §8 item 9)", () => {
  it("hoje TODA ação alta da matriz já pede step-up (a regra do solo é defensiva para ações futuras)", () => {
    for (const [id, a] of Object.entries(ACOES)) {
      if (classeDeRisco(id) === "alto") expect(a.mfa, id).toBe("step_up");
    }
  });
  it("alto risco SEM step-up recente → 404", async () => {
    corp(FUNDADOR, ["superadmin"], false);
    await expect(autorizarAdmin("finance.margin.set")).rejects.toThrow(NEGADO);
    expect(eventos()).toContain("admin_step_up_exigido");
    // baixo/moderado seguem com o MFA do login
    await expect(autorizarAdmin("lab.calibration.run")).resolves.toMatchObject({ fonte: "corp" });
  });
  it("segregado é BLOQUEADO até para o fundador com step-up (liberar automação com dinheiro real)", async () => {
    corp(FUNDADOR, ["superadmin"]);
    await expect(autorizarAdmin("trading.automation.write")).rejects.toThrow(NEGADO);
    await expect(autorizarAdmin("identity.admins.write")).rejects.toThrow(NEGADO);
    expect(eventos().filter((k) => k === "admin_solo_segregado")).toHaveLength(2);
  });
  it("carteira legada: só a do dono (`env`), sem alto risco — exceto conter incidente (kill switch)", async () => {
    s.legado = { wallet: "0xdono", fonte: "panel" };
    await expect(autorizarAdmin("finance.summary.read")).rejects.toThrow(NEGADO);
    expect(eventos()).toContain("admin_solo_fonte_legada");
    s.legado = { wallet: "0xdono", fonte: "env" };
    await expect(autorizarAdmin("finance.summary.read")).resolves.toMatchObject({ fonte: "env" });
    await expect(autorizarAdmin("finance.margin.set")).rejects.toThrow(NEGADO);
    expect(eventos()).toContain("admin_solo_alto_exige_mfa");
    await expect(autorizarAdmin("security.killswitch.set")).resolves.toMatchObject({ fonte: "env" });
  });
  it("governança ILEGÍVEL: segregado negado; carteira legada restrita como no solo (na dúvida, fecha)", async () => {
    s.gov = { ok: false, erro: "fora" };
    s.legado = { wallet: "0xdono", fonte: "env" };
    await expect(autorizarAdmin("trading.automation.write")).rejects.toThrow(NEGADO);
    expect(eventos()).toContain("admin_governanca_ilegivel");
    await expect(autorizarAdmin("finance.margin.set")).rejects.toThrow(NEGADO);
    await expect(autorizarAdmin("finance.summary.read")).resolves.toMatchObject({ fonte: "env" });
  });
  it("em `corp`, governança ilegível nega a sessão corporativa", async () => {
    vi.stubEnv("ADMIN_AUTH_MODE", "corp");
    s.gov = { ok: false, erro: "fora" };
    corp(FUNDADOR, ["superadmin"]);
    await expect(autorizarAdmin("finance.summary.read")).rejects.toThrow(NEGADO);
  });
});

describe("multi_admin — RBAC intacto (missão §8 item 10)", () => {
  beforeEach(() => { s.gov = { ok: true, valor: { modo: "multi_admin", fundador: FUNDADOR } }; });
  it("outra identidade decide por PAPEL (sem a regra do fundador); auditor não liga kill switch", async () => {
    corp(OUTRO, ["finance"]);
    await expect(autorizarAdmin("finance.summary.read")).resolves.toMatchObject({ fonte: "corp" });
    corp(OUTRO, ["auditor"]);
    await expect(autorizarAdmin("security.killswitch.set")).rejects.toThrow(NEGADO);
    expect(eventos()).toContain("admin_rbac_negado");
  });
  it("segregado volta à regra de antes (superadmin com step-up) e alto não gera o evento do solo", async () => {
    corp(OUTRO, ["superadmin"]);
    await expect(autorizarAdmin("trading.automation.write")).resolves.toMatchObject({ fonte: "corp" });
    expect(eventos()).not.toContain("admin_solo_alto_risco");
  });
  it("carteira de painel (legado) volta a valer em `dual`", async () => {
    s.legado = { wallet: "0xpainel", fonte: "panel" };
    await expect(autorizarAdmin("finance.summary.read")).resolves.toMatchObject({ fonte: "panel" });
  });
});

describe("legacy (produção hoje) — a governança nem é lida", () => {
  it("ADMIN_AUTH_MODE ausente: decisão de antes, segregado incluído, sem tocar a governança", async () => {
    vi.stubEnv("ADMIN_AUTH_MODE", "");
    s.gov = { ok: false, erro: "nem deveria ser lida" };
    s.legado = { wallet: "0xpainel", fonte: "panel" };
    await expect(autorizarAdmin("trading.automation.write")).resolves.toMatchObject({ fonte: "panel", modo: "legacy" });
    expect(eventos()).toEqual([]);
  });
});

describe("nada administrativo no navegador (missão §8 item 12)", () => {
  const arquivos = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
  const fonte = arquivos("src").filter((f) => !f.endsWith(".test.ts"));
  it("nenhuma variável do fundador/admin é NEXT_PUBLIC_*", () => {
    for (const f of fonte) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(FOUNDER|ADMIN_SESSION|ADMIN_BREAKGLASS|ADMIN_AUTH|ADMIN_WALLETS)/);
    }
  });
  it("componentes de cliente não importam governança, fundador, repositórios nem a chave de sessão", () => {
    for (const f of fonte) {
      const c = readFileSync(f, "utf8");
      if (!/^\s*["']use client["']/.test(c)) continue;
      expect(c, f).not.toMatch(/corp\/(fundador|governanca-repo|repo|selo|fluxo|config)|supabase\/server|ADMIN_SESSION_ENC_KEY|ADMIN_FOUNDER/);
    }
  });
});
