/**
 * POST /api/early-access — comportamento da rota pública.
 *
 * Mocks: gate, store (RPC), rate limit e telemetria. Validação, HMAC e
 * geração de código são os REAIS. O segredo é falso e local.
 *
 * As versões legais são mockadas como APROVADAS só para exercitar o caminho
 * feliz; o caso "UNAPPROVED" é testado explicitamente (②).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";

const st = vi.hoisted(() => ({
  gateAberto: true,
  terms: "tos-2026-10",
  privacy: "priv-2026-10",
  limites: {} as Record<string, boolean>,
  buckets: [] as string[],
  resultado: { ok: true, resultado: "criado", envio: true } as unknown,
  inscrever: [] as unknown[][],
  envios: [] as Array<{ email: string; locale: string; token: string }>,
  waitUntil: 0,
  ordem: [] as string[],
  seguranca: [] as Array<[string, Record<string, unknown>]>,
}));

vi.mock("@/lib/early-access/legal-versions", async (orig) => {
  const real = await orig<typeof import("@/lib/early-access/legal-versions")>();
  return {
    ...real,
    get TERMS_VERSION() { return st.terms; },
    get PRIVACY_VERSION() { return st.privacy; },
  };
});
vi.mock("@/lib/early-access/gate", () => ({
  lerGateEarlyAccess: async () => ({ aberto: st.gateAberto, motivos: st.gateAberto ? [] : ["kv_fechado"] }),
}));
vi.mock("@/lib/early-access/store", () => ({
  inscrever: async (...a: unknown[]) => { st.inscrever.push(a); return st.resultado; },
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => { st.waitUntil++; st.ordem.push("waitUntil"); void p; },
}));
vi.mock("@/lib/early-access/email/enviar", () => ({
  enviarConfirmacao: async (a: { email: string; locale: string; token: string }) => { st.envios.push(a); },
}));
vi.mock("@/lib/rate-limit", () => ({
  getClientId: (h: Headers) => h.get("x-forwarded-for") ?? "anonymous",
  rateLimitDurable: async (id: string) => {
    st.buckets.push(id);
    const bloqueado = Object.entries(st.limites).some(([p, v]) => v && id.startsWith(p));
    return { ok: !bloqueado, remaining: 0, resetAt: 0, retryAfter: 42 };
  },
}));
vi.mock("@/lib/admin/track", () => ({
  logSecurity: (k: string, m: Record<string, unknown>) => { st.seguranca.push([k, m]); },
  recordEvent: async () => {}, logError: () => {},
}));

import { POST } from "./route";

const IP = "203.0.113.9";
const EMAIL = "Ana.Souza@Example.com";
// Segredo FALSO gerado na hora, no formato operacional (base64 de 48 bytes).
const SEGREDO_FALSO = randomBytes(48).toString("base64");

function corpo(extra: Record<string, unknown> = {}) {
  return {
    email: EMAIL, display_name: "Ana Souza", country: "BR",
    accept_terms: true, accept_privacy: true,
    terms_version: "tos-2026-10", privacy_version: "priv-2026-10",
    form_ms: 5000, website: "", ...extra,
  };
}

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/early-access", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": IP, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function resposta(r: Response) {
  return { status: r.status, body: await r.text(), cache: r.headers.get("cache-control"), ct: r.headers.get("content-type") };
}

beforeEach(() => {
  st.gateAberto = true; st.terms = "tos-2026-10"; st.privacy = "priv-2026-10";
  st.limites = {}; st.buckets = []; st.inscrever = []; st.seguranca = [];
  st.resultado = { ok: true, resultado: "criado", envio: true };
  st.envios = []; st.waitUntil = 0; st.ordem = [];
  process.env.EARLY_ACCESS_HMAC_SECRET = SEGREDO_FALSO;
});

describe("① caminho feliz", () => {
  it("202 {ok:true}, no-store, e a RPC recebe dados normalizados + HMAC + 5 candidatos", async () => {
    const r = await POST(req(corpo()));
    expect(await resposta(r)).toEqual({ status: 202, body: '{"ok":true}', cache: "no-store", ct: "application/json" });
    expect(st.inscrever).toHaveLength(1);
    const [dados, ipH, candidatos] = st.inscrever[0] as [{ email: string }, string, string[]];
    expect(dados.email).toBe("ana.souza@example.com");
    expect(ipH).toMatch(/^[0-9a-f]{32}$/);
    expect(candidatos).toHaveLength(5);
  });
});

describe("② fail-closed", () => {
  it("⚠️ gate fechado → 503 e NADA é gravado nem limitado", async () => {
    st.gateAberto = false;
    const r = await POST(req(corpo()));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, error: "closed" });
    expect(st.inscrever).toHaveLength(0);
    expect(st.buckets).toHaveLength(0);
  });
  it("⚠️⚠️ versão legal UNAPPROVED é recusada MESMO se o gate falhar aberto", async () => {
    st.terms = "UNAPPROVED"; st.privacy = "UNAPPROVED";
    const r = await POST(req(corpo({ terms_version: "UNAPPROVED", privacy_version: "UNAPPROVED" })));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "versao_legal" });
    expect(st.inscrever).toHaveLength(0);
  });
  it("⚠️ segredo HMAC ausente → 503 closed, nada gravado", async () => {
    delete process.env.EARLY_ACCESS_HMAC_SECRET;
    const r = await POST(req(corpo()));
    expect(r.status).toBe(503);
    expect(st.inscrever).toHaveLength(0);
  });
  it("falha de gravação → 503 genérico, sem mensagem do Postgres", async () => {
    st.resultado = { ok: false, erro: "erro_banco" };
    const r = await POST(req(corpo()));
    expect(r.status).toBe(503);
    const txt = await r.text();
    expect(txt).toBe('{"ok":false,"error":"unavailable"}');
  });
});

describe("③ forma da requisição", () => {
  it("não-JSON → 415", async () => {
    expect((await POST(req(corpo(), { "content-type": "text/plain" }))).status).toBe(415);
  });
  it("⚠️ corpo acima de 4 KiB → 413 (declarado ou não)", async () => {
    const grande = JSON.stringify(corpo({ website: "x".repeat(5000) }));
    expect((await POST(req(grande, { "content-length": String(grande.length) }))).status).toBe(413);
    expect((await POST(req(grande))).status).toBe(413);
    expect(st.inscrever).toHaveLength(0);
  });
  it("JSON inválido → 400", async () => {
    expect((await POST(req("{nope"))).status).toBe(400);
  });
  it("⚠️ campo desconhecido → 400", async () => {
    const r = await POST(req(corpo({ status: "approved" })));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "campo_desconhecido", field: "status" });
  });
  it("consentimento ausente → 400", async () => {
    expect((await POST(req(corpo({ accept_privacy: false })))).status).toBe(400);
  });
  it("⚠️ origem ausente ou estranha → 403", async () => {
    expect((await POST(req(corpo(), { origin: "https://evil.example" }))).status).toBe(403);
    const semOrigem = new NextRequest("http://localhost/api/early-access", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo()),
    });
    expect((await POST(semOrigem)).status).toBe(403);
    expect(st.inscrever).toHaveLength(0);
  });
});

describe("④ anti-enumeração — a MESMA resposta", () => {
  async function respostaCom(prepara: () => void, extra: Record<string, unknown> = {}) {
    prepara();
    return resposta(await POST(req(corpo(extra))));
  }
  it("⚠️⚠️ novo, duplicado, bloqueado, email estourado e robô respondem idêntico", async () => {
    const novo       = await respostaCom(() => { st.resultado = { ok: true, resultado: "criado", envio: true }; });
    // Fase 2: duplicado pendente com reenvio, verificado (sem envio) e dentro do cooldown
    const duplicado  = await respostaCom(() => { st.resultado = { ok: true, resultado: "existente", envio: true }; });
    const verificado = await respostaCom(() => { st.resultado = { ok: true, resultado: "existente", envio: false }; });
    // bloqueado: na RPC é um email existente → "existente", sem envio
    const bloqueado  = await respostaCom(() => { st.resultado = { ok: true, resultado: "existente", envio: false }; });
    const estourado  = await respostaCom(() => { st.limites = { "ea:em:": true }; });
    st.limites = {};
    const robo       = await respostaCom(() => {}, { website: "http://spam" });
    const rapido     = await respostaCom(() => {}, { form_ms: 300 });
    for (const r of [duplicado, verificado, bloqueado, estourado, robo, rapido]) expect(r).toEqual(novo);
  });
  it("email estourado e robô NÃO chamam a RPC", async () => {
    st.limites = { "ea:em:": true };
    await POST(req(corpo()));
    st.limites = {};
    await POST(req(corpo({ website: "x" })));
    expect(st.inscrever).toHaveLength(0);
  });
});

describe("⑤ rate limit", () => {
  it("IP estourado → 429 + Retry-After (não revela nada de email)", async () => {
    st.limites = { "ea:ip:": true };
    const r = await POST(req(corpo()));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("42");
    expect(st.inscrever).toHaveLength(0);
  });
  it("teto global → 503 busy + alerta", async () => {
    st.limites = { "ea:global:": true };
    const r = await POST(req(corpo()));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, error: "busy" });
    expect(st.seguranca.map(([k]) => k)).toContain("early_access_teto_global");
  });
  it("⚠️⚠️ nenhum bucket contém o IP ou o email crus", async () => {
    await POST(req(corpo()));
    expect(st.buckets.length).toBeGreaterThanOrEqual(4);
    for (const b of st.buckets) {
      expect(b).not.toContain(IP);
      expect(b.toLowerCase()).not.toContain("ana.souza");
      expect(b).toMatch(/^ea:(ip:[rh]:[0-9a-f]{32}|em:[0-9a-f]{32}|global:h)$/);
    }
  });
  it("eventos de segurança não carregam PII", async () => {
    st.limites = { "ea:em:": true };
    await POST(req(corpo()));
    const tudo = JSON.stringify(st.seguranca);
    expect(tudo).not.toContain(IP);
    expect(tudo.toLowerCase()).not.toContain("ana.souza");
  });
});

describe("⑤b F-02 — robô não consome cota compartilhada", () => {
  it("⚠️⚠️ honeypot NÃO consome ea:global:h nem o limite do email (e responde o mesmo 202)", async () => {
    const r = await POST(req(corpo({ website: "http://spam.example" })));
    expect(await resposta(r)).toEqual({ status: 202, body: '{"ok":true}', cache: "no-store", ct: "application/json" });
    expect(st.buckets.some((b) => b === "ea:global:h")).toBe(false);
    expect(st.buckets.some((b) => b.startsWith("ea:em:"))).toBe(false);
    expect(st.buckets.some((b) => b.startsWith("ea:ip:"))).toBe(true); // o IP continua limitado cedo
    expect(st.inscrever).toHaveLength(0);
  });
  it("⚠️ tempo mínimo inválido também não consome o teto global", async () => {
    await POST(req(corpo({ form_ms: 100 })));
    expect(st.buckets).not.toContain("ea:global:h");
  });
  it("com o teto global ESGOTADO, robô continua recebendo o 202 genérico", async () => {
    st.limites = { "ea:global:": true };
    const r = await POST(req(corpo({ website: "x" })));
    expect(r.status).toBe(202);
  });
  it("envio humano consome o teto global (a ordem não desligou a proteção)", async () => {
    await POST(req(corpo()));
    expect(st.buckets).toContain("ea:global:h");
  });
});

describe("⑥ referral", () => {
  it("⚠️ mesmo IP do indicador NÃO bloqueia a inscrição (é só sinal, decidido na RPC)", async () => {
    const r = await POST(req(corpo({ referral_code: "ABCDEFGH12" })));
    expect(r.status).toBe(202);
    expect(st.inscrever).toHaveLength(1);
    expect((st.inscrever[0][0] as { referralCode: string }).referralCode).toBe("ABCDEFGH12");
  });
});

describe("⑦ fonte da rota", () => {
  const SRC = readFileSync(join(process.cwd(), "src/app/api/early-access/route.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("⚠️ nunca forma bucket com getClientId cru", () => {
    expect(SRC).not.toMatch(/`[^`]*\$\{\s*getClientId\(/);
    expect(SRC).toMatch(/ipHmac\(getClientId\(req\.headers\)\)/);
  });
  it("⚠️ não existe GET público", () => {
    expect(SRC).not.toMatch(/export\s+(async\s+)?function\s+GET/);
  });
});

describe("⑧ Fase 2 — double opt-in na inscrição", () => {
  it("⚠️⚠️ a RPC recebe SÓ o hash; o email sai com o token cru, depois da resposta (waitUntil)", async () => {
    const r = await POST(req(corpo({ locale: "pt" })));
    expect(r.status).toBe(202);
    const [, , , hash] = st.inscrever[0] as [unknown, unknown, unknown, string];
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(st.waitUntil).toBe(1);
    expect(st.envios).toHaveLength(1);
    const e = st.envios[0];
    expect(e.email).toBe("ana.souza@example.com");
    expect(e.locale).toBe("pt");
    expect(e.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { hashToken } = await import("@/lib/early-access/token");
    expect(hashToken(e.token)).toBe(hash);
    expect(hash).not.toContain(e.token);
  });
  it("⚠️ RPC disse envio:false (verificado, bloqueado, cooldown, cap) → nenhum email, mesma resposta", async () => {
    st.resultado = { ok: true, resultado: "existente", envio: false };
    const r = await POST(req(corpo()));
    expect(r.status).toBe(202);
    expect(st.waitUntil).toBe(0);
    expect(st.envios).toHaveLength(0);
  });
  it("robô, email estourado e falha de banco não enviam nada", async () => {
    await POST(req(corpo({ website: "x" })));
    st.limites = { "ea:em:": true };
    await POST(req(corpo()));
    st.limites = {};
    st.resultado = { ok: false, erro: "erro_banco" };
    await POST(req(corpo()));
    expect(st.envios).toHaveLength(0);
  });
  it("⚠️ token novo a cada envio (nunca reaproveitado)", async () => {
    await POST(req(corpo()));
    await POST(req(corpo()));
    expect(new Set(st.envios.map((e) => e.token)).size).toBe(2);
  });
  it("⚠️⚠️ nenhum evento de segurança carrega o token ou o hash", async () => {
    st.limites = { "ea:em:": true };
    await POST(req(corpo()));
    st.limites = {};
    st.resultado = { ok: false, erro: "erro_banco" };
    await POST(req(corpo()));
    const tudo = JSON.stringify(st.seguranca);
    for (const a of st.inscrever) expect(tudo).not.toContain(String(a[3]));
  });
  it("locale fora da lista → 400; ausente → en", async () => {
    expect((await POST(req(corpo({ locale: "fr" })))).status).toBe(400);
    await POST(req(corpo()));
    expect(st.envios[0].locale).toBe("en");
  });
});
