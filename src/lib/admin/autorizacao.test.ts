/**
 * R2 — ponto único de decisão, catálogo RBAC e completude por HANDLER.
 *
 *   · ADM-011: método exportado sem `autorizarAdmin("<ação da SUA linha>")` no
 *     PRÓPRIO corpo = vermelho (layout não conta; arquivo não conta);
 *   · catálogo e registro iguais à matriz (`docs/ADMIN-API-AUTHORIZATION-MATRIX.md`);
 *   · modos: `legacy` = decisão de hoje; inválido/`corp` (sem R1) = 404;
 *   · ADM-001/002 (sem sessão / carteira sem fonte admin → 404, nada executa);
 *   · ADM-003 no nível do catálogo (auditor não tem a permissão do kill switch).
 *     A recusa EM TEMPO DE EXECUÇÃO por papel depende de R1 (sessão corporativa).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ACOES, type AcaoId } from "./acoes";
import { PAPEIS, PERMISSOES, PERMISSOES_LEITURA, algumPapelTem, papelTem, type Permissao } from "./rbac";

const semComentarios = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

function rotas(dir = "src/app/admin/api", out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) rotas(p, out);
    else if (n === "route.ts") out.push(p);
  }
  return out;
}

/** [método, corpo-sem-comentários] de cada handler exportado. */
function handlers(codigo: string): Array<[string, string]> {
  const c = semComentarios(codigo);
  const marcas = [...c.matchAll(/^export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm)];
  return marcas.map((m, i) => [m[1], c.slice(m.index!, i + 1 < marcas.length ? marcas[i + 1].index : c.length)]);
}

describe("ADM-011 · completude por handler", () => {
  const arquivos = rotas();
  const vistos = new Set<string>();

  it("existem handlers para conferir (não passa por vazio)", () => {
    expect(arquivos.length).toBeGreaterThan(50);
  });

  for (const arq of arquivos) {
    const rota = "/" + dirname(arq).slice("src/app/".length);
    for (const [metodo, corpo] of handlers(readFileSync(arq, "utf8"))) {
      it(`${metodo} ${rota}`, () => {
        const chamadas = [...corpo.matchAll(/\bautorizarAdmin\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
        expect(chamadas.length, "handler sem autorizarAdmin no PRÓPRIO corpo").toBeGreaterThanOrEqual(1);
        const id = chamadas[0] as AcaoId;
        const def = ACOES[id];
        expect(def, `ação "${id}" não está em ACOES`).toBeDefined();
        expect(`${def.metodo} ${def.rota}`, "a ação é de OUTRA rota/método").toBe(`${metodo} ${rota}`);
        expect(new Set(chamadas).size, "duas ações diferentes no mesmo handler").toBe(1);
        expect(/\brequireAdmin\s*\(/.test(corpo), "chamar requireAdmin direto fura o ponto único").toBe(false);
        vistos.add(id);
      });
    }
  }

  it("toda ação registrada tem handler (registro não acumula linha morta)", () => {
    expect(Object.keys(ACOES).filter((id) => !vistos.has(id))).toEqual([]);
  });

  it("o detector morde: handler sem guarda e guarda de outra rota são pegos", () => {
    const [[, semGuarda]] = handlers(`export async function GET() { return 1; }`);
    expect(/\bautorizarAdmin\(/.test(semGuarda)).toBe(false);
    const [, [, segundo]] = handlers(`export async function GET() { await autorizarAdmin("x.read"); }\nexport async function POST() { return 2; }`);
    expect(/\bautorizarAdmin\(/.test(segundo)).toBe(false);
    const [[, comentado]] = handlers(`export async function GET() {\n  // await autorizarAdmin("a")\n  return 1; }`);
    expect(/\bautorizarAdmin\(/.test(comentado)).toBe(false);
  });
});

describe("catálogo RBAC = matriz", () => {
  const md = readFileSync("docs/ADMIN-API-AUTHORIZATION-MATRIX.md", "utf8");

  it("permissões e papéis iguais à tabela 'Papéis × permissões'", () => {
    const linhas = md.split("\n").filter((l) => /^\| `[a-z.]+`( ?, `[a-z.]+`)* \| (plano|extensão)/.test(l));
    const daMatriz: Record<string, string[]> = {};
    for (const l of linhas) {
      const c = l.split("|").map((x) => x.trim());
      const perms = [...c[1].matchAll(/`([a-z._]+)`/g)].map((m) => m[1]);
      const papeis = c[3] === "—" ? [] : [...c[3].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
      for (const p of perms) daMatriz[p] = papeis.sort();
    }
    const doCodigo = Object.fromEntries(Object.entries(PERMISSOES).map(([k, v]) => [k, [...v].sort()]));
    expect(doCodigo).toEqual(daMatriz);
  });

  it("registro de ações = linhas da matriz (rota, método, permissões, MFA, auditoria)", () => {
    const linhas = md.split("\n").filter((l) => l.startsWith("| `/admin/api"));
    expect(linhas.length).toBe(Object.keys(ACOES).length);
    const porRota = new Map(Object.values(ACOES).map((a) => [`${a.metodo} ${a.rota}`, a]));
    for (const l of linhas) {
      const c = l.split(/(?<!\\)\|/).map((x) => x.trim());
      const a = porRota.get(`${c[2]} ${c[1].replace(/`/g, "")}`);
      expect(a, l.slice(0, 60)).toBeDefined();
      const perms = c[7].match(/`([^`]+)`/)![1].replace(/\\\|/g, "|").split("|").map((x) => x.trim());
      expect([...a!.permissoes].sort()).toEqual(perms.sort());
      expect(a!.mfa).toBe(c[6]);
      expect(a!.auditoria).toBe(c[11]);
    }
  });

  it("auditor nunca recebe escrita; superadmin tem tudo", () => {
    for (const p of Object.keys(PERMISSOES) as Permissao[]) {
      if (!PERMISSOES_LEITURA.has(p)) expect(papelTem("auditor", p), p).toBe(false);
      expect(papelTem("superadmin", p)).toBe(true);
    }
  });

  it("toda permissão citada por uma ação existe; leitura de verdade só em ação de leitura", () => {
    for (const [id, a] of Object.entries(ACOES)) {
      for (const p of a.permissoes) expect(PERMISSOES, `${id}: ${p}`).toHaveProperty(p);
      if (a.risco !== "read" && a.permissoes.every((p) => PERMISSOES_LEITURA.has(p))) {
        // ação que escreve/exporta exigindo só permissão de leitura abriria a escrita ao auditor
        expect.soft(id, "ação que escreve exige só leitura").toBe("—");
      }
    }
  });

  it("ADM-003 (catálogo): auditor NÃO pode ligar/desligar kill switch; security_admin pode", () => {
    const ks = ACOES["security.killswitch.set"];
    expect(algumPapelTem(["auditor"], ks.permissoes)).toBe(false);
    expect(algumPapelTem(["security_admin"], ks.permissoes)).toBe(true);
    expect(PAPEIS).toContain("auditor");
  });
});

// ── modos e decisões (ADM-001/002) ──────────────────────────────────────────

const s = vi.hoisted(() => ({
  sessao: null as { sub: string } | null,
  env: [] as string[],
  painel: [] as string[],
  tier: [] as string[],
  eventos: [] as Array<{ kind: string; meta: Record<string, unknown> }>,
  admitidos: [] as unknown[],
}));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => s.sessao }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/lib/admin/auditoria-duravel", () => ({
  logSecurityAguardado: async (kind: string, meta: Record<string, unknown>) => { s.eventos.push({ kind, meta }); },
}));
vi.mock("@/lib/admin/track", () => ({ recordEvent: async (_t: string, e: unknown) => { s.admitidos.push(e); } }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (t: string) => {
      const filtro: Record<string, string> = {};
      const q = {
        select: () => q,
        eq: (k: string, v: string) => { filtro[k] = v; return q; },
        maybeSingle: async () => {
          const w = filtro.wallet_address;
          const ok = t === "platform_admins" ? s.painel.includes(w) : t === "tier_cache" ? s.tier.includes(w) && filtro.source === "admin" : false;
          return { data: ok ? { wallet_address: w, source: "admin" } : null, error: null };
        },
      };
      return q;
    },
  }),
}));

const { autorizarAdmin, lerModoAuth, fontesLegadasPermitidas, _esquecerObservacoes } = await import("./authz");

beforeEach(() => {
  s.sessao = null; s.painel = []; s.tier = []; s.eventos = []; s.admitidos = [];
  vi.stubEnv("ADMIN_AUTH_MODE", "");
  vi.stubEnv("ADMIN_LEGACY_SOURCES", "");
  vi.stubEnv("ADMIN_WALLETS", "0xenv");
  _esquecerObservacoes();
});
afterEach(() => vi.unstubAllEnvs());

describe("modo", () => {
  it("ausente = legacy; valor estranho = inválido (fecha)", () => {
    expect(lerModoAuth({})).toEqual({ ok: true, modo: "legacy" });
    expect(lerModoAuth({ ADMIN_AUTH_MODE: "DUAL" })).toEqual({ ok: true, modo: "dual" });
    expect(lerModoAuth({ ADMIN_AUTH_MODE: "open" }).ok).toBe(false);
    expect(fontesLegadasPermitidas({ ADMIN_LEGACY_SOURCES: "env,lixo" }).size).toBe(0);
    expect([...fontesLegadasPermitidas({ ADMIN_LEGACY_SOURCES: "env" })]).toEqual(["env"]);
  });
});

describe("legacy = a decisão de hoje (+ observação R5)", () => {
  it("ADM-001: sem sessão → 404 e evento", async () => {
    await expect(autorizarAdmin("security.killswitch.set")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(s.eventos.map((e) => e.kind)).toContain("admin_sem_sessao");
  });

  it("ADM-002: carteira conectada sem nenhuma das 3 fontes (ex.: só tier pilot) → 404", async () => {
    s.sessao = { sub: "0xpilot" };
    await expect(autorizarAdmin("finance.summary.read")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(s.eventos.map((e) => e.kind)).toContain("admin_access_denied");
  });

  it("as três fontes continuam admitindo, e a fonte é observada (sem mudar a decisão)", async () => {
    for (const [w, fonte] of [["0xenv", "env"], ["0xpainel", "panel"], ["0xtier", "tier"]] as const) {
      s.sessao = { sub: w }; s.painel = ["0xpainel"]; s.tier = ["0xtier"];
      const r = await autorizarAdmin("security.killswitch.read");
      expect(r).toMatchObject({ wallet: w, fonte, modo: "legacy", acao: "security.killswitch.read" });
    }
    expect(JSON.stringify(s.admitidos)).toContain("\"fonte\":\"tier\"");
  });

  it("observação que falha não muda nada", async () => {
    s.sessao = { sub: "0xenv" };
    const { recordEvent } = await import("@/lib/admin/track");
    vi.mocked(recordEvent as never as () => Promise<void>);
    s.admitidos = null as never; // push vai lançar
    await expect(autorizarAdmin("security.killswitch.read")).resolves.toMatchObject({ wallet: "0xenv" });
  });
});

describe("dual / corp / inválido", () => {
  it("inválido → 404 + alerta alto, mesmo para admin do env", async () => {
    vi.stubEnv("ADMIN_AUTH_MODE", "aberto");
    s.sessao = { sub: "0xenv" };
    await expect(autorizarAdmin("security.killswitch.read")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(s.eventos.map((e) => e.kind)).toContain("admin_modo_invalido");
  });

  it("corp sem R1 implantado → ninguém entra (404 + alerta)", async () => {
    vi.stubEnv("ADMIN_AUTH_MODE", "corp");
    s.sessao = { sub: "0xenv" };
    await expect(autorizarAdmin("security.killswitch.read")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(s.eventos.map((e) => e.kind)).toContain("admin_corp_indisponivel");
  });

  it("dual: fonte fora de ADMIN_LEGACY_SOURCES → 404; dentro → passa", async () => {
    vi.stubEnv("ADMIN_AUTH_MODE", "dual");
    vi.stubEnv("ADMIN_LEGACY_SOURCES", "env,panel");
    s.sessao = { sub: "0xtier" }; s.tier = ["0xtier"];
    await expect(autorizarAdmin("security.killswitch.read")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(s.eventos.map((e) => e.kind)).toContain("admin_fonte_legada_recusada");
    s.sessao = { sub: "0xenv" };
    await expect(autorizarAdmin("security.killswitch.read")).resolves.toMatchObject({ modo: "dual", fonte: "env" });
  });
});
