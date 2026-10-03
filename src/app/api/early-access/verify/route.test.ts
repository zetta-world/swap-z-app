/**
 * POST /api/early-access/verify — o titular age com o token do link.
 *
 * Mocks: gate, store (RPCs), rate limit e telemetria. Validação, HMAC e hash
 * do token são os REAIS. Segredo e token são fixos e sintéticos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

const st = vi.hoisted(() => ({
  gateAberto: true,
  limites: false,
  preview: { ok: true, preview: { display_name: "Ana", country: "BR", terms_version: "t1", privacy_version: "p1" } } as unknown,
  confirmar: { ok: true, resultado: "confirmado", referralCode: "ABCDEFGH12" } as unknown,
  recusar: "recusado" as unknown,
  chamadas: [] as unknown[][],
  seguranca: [] as Array<[string, Record<string, unknown>]>,
}));
vi.mock("@/lib/early-access/gate", () => ({
  lerGateEarlyAccess: async () => ({ aberto: st.gateAberto, motivos: st.gateAberto ? [] : ["kv_fechado"] }),
}));
vi.mock("@/lib/early-access/store", () => ({
  previewToken:  async (...a: unknown[]) => { st.chamadas.push(["preview", ...a]); return st.preview; },
  confirmarEmail: async (...a: unknown[]) => { st.chamadas.push(["confirmar", ...a]); return st.confirmar; },
  recusarEmail:  async (...a: unknown[]) => { st.chamadas.push(["recusar", ...a]); return st.recusar; },
}));
vi.mock("@/lib/rate-limit", () => ({
  getClientId: (h: Headers) => h.get("x-forwarded-for") ?? "anonymous",
  rateLimitDurable: async () => ({ ok: !st.limites, remaining: 0, resetAt: 0, retryAfter: 7 }),
}));
vi.mock("@/lib/admin/track", () => ({
  logSecurity: (k: string, m: Record<string, unknown>) => { st.seguranca.push([k, m]); },
  recordEvent: async () => {}, logError: () => {},
}));

import { POST } from "./route";
import { hashToken } from "@/lib/early-access/token";

const TOKEN = "C".repeat(42) + "g";
const HASH = hashToken(TOKEN)!;
const SEGREDO_FALSO = Buffer.from(Array.from({ length: 48 }, (_, i) => (i * 61 + 0x2d) & 0xff)).toString("base64");

/**
 * EA2-IA05: um `confirm` legítimo sempre traz as versões que a tela mostrou
 * (as da preview). O helper as injeta; `semVersoes()` testa a ausência.
 */
const VERSOES = { accept_terms_version: "t1", acknowledge_privacy_version: "p1" };
const SEM_VERSOES = Symbol("semVersoes");
function semVersoes(b: Record<string, unknown>) { return { ...b, [SEM_VERSOES]: true }; }
function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const b = body as Record<string | symbol, unknown>;
    if (b.action === "confirm" && !b[SEM_VERSOES] && !("accept_terms_version" in b)) body = { ...VERSOES, ...b };
  }
  return new NextRequest("http://localhost/api/early-access/verify", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
async function r2(r: Response) { return { status: r.status, body: await r.json(), cache: r.headers.get("cache-control") }; }

beforeEach(() => {
  st.gateAberto = true; st.limites = false; st.chamadas = []; st.seguranca = [];
  st.preview = { ok: true, preview: { display_name: "Ana", country: "BR", terms_version: "t1", privacy_version: "p1" } };
  st.confirmar = { ok: true, resultado: "confirmado", referralCode: "ABCDEFGH12" };
  st.recusar = "recusado";
  process.env.EARLY_ACCESS_HMAC_SECRET = SEGREDO_FALSO;
});

describe("① caminhos felizes — só o HASH chega ao store", () => {
  it("preview: 200 com os dados, sem email; não consome", async () => {
    const r = await r2(await POST(req({ token: TOKEN, action: "preview" })));
    expect(r).toEqual({ status: 200, cache: "no-store", body: { ok: true, preview: {
      display_name: "Ana", country: "BR", terms_version: "t1", privacy_version: "p1" } } });
    expect(st.chamadas).toEqual([["preview", HASH]]);
  });
  it("confirm: 200 + referral_code (F-11); correções normalizadas", async () => {
    const r = await r2(await POST(req({ token: TOKEN, action: "confirm", display_name: "  Ana Souza ", country: "PT" })));
    expect(r.body).toEqual({ ok: true, result: "confirmed", referral_code: "ABCDEFGH12" });
    const [nome, hash, versoes, dn, pais, ipH, mkt] = st.chamadas[0] as [string, string, unknown, string, string, string, unknown];
    expect([nome, hash, dn, pais]).toEqual(["confirmar", HASH, "Ana Souza", "PT"]);
    expect(versoes).toEqual({ termos: "t1", privacidade: "p1" }); // EA2-IA05: as versões da tela
    expect(ipH).toMatch(/^[0-9a-f]{32}$/);
    expect(mkt).toBeNull(); // EA2-A02: sem escolha explícita = null = opt-out no banco
  });
  it("⚠️ EA2-A02: a escolha explícita de marketing do titular chega ao store; só booleano literal", async () => {
    await POST(req({ token: TOKEN, action: "confirm", marketing_opt_in: true }));
    await POST(req({ token: TOKEN, action: "confirm", marketing_opt_in: false }));
    expect(st.chamadas.map((c) => c[6])).toEqual([true, false]);
    for (const v of ["on", 1, "true", null]) {
      expect((await r2(await POST(req({ token: TOKEN, action: "confirm", marketing_opt_in: v })))).body, String(v))
        .toMatchObject({ error: "campo_invalido", field: "marketing_opt_in" });
    }
    expect((await r2(await POST(req({ token: TOKEN, action: "preview", marketing_opt_in: true })))).body)
      .toMatchObject({ error: "campo_desconhecido" });
    expect(st.chamadas).toHaveLength(2);
  });
  it("⚠️ EA2-IA06: tri-estado — omitido = null (sem escolha), nunca vira opt-out explícito", async () => {
    await POST(req({ token: TOKEN, action: "confirm" }));
    await POST(req({ token: TOKEN, action: "confirm", marketing_opt_in: false }));
    await POST(req({ token: TOKEN, action: "confirm", marketing_opt_in: true }));
    expect(st.chamadas.map((c) => c[6])).toEqual([null, false, true]);
  });
  it("⚠️⚠️ EA2-IA05: confirm SEM as versões apresentadas não chega ao banco; versão divergente → 400", async () => {
    for (const falta of [{}, { accept_terms_version: "t1" }, { acknowledge_privacy_version: "p1" },
                         { accept_terms_version: "UNA PPROVED", acknowledge_privacy_version: "p1" }]) {
      const r = await r2(await POST(req(semVersoes({ token: TOKEN, action: "confirm", ...falta }))));
      expect(r.status, JSON.stringify(falta)).toBe(400);
      expect(r.body).toMatchObject({ error: "versao_legal" });
    }
    expect(st.chamadas).toHaveLength(0);
    st.confirmar = { ok: false, erro: "versao_divergente" };
    const r = await r2(await POST(req({ token: TOKEN, action: "confirm", accept_terms_version: "t9", acknowledge_privacy_version: "p1" })));
    expect(r).toMatchObject({ status: 400, body: { error: "versao_legal" } });
    expect((st.chamadas[0] as unknown[])[2]).toEqual({ termos: "t9", privacidade: "p1" });
  });
  it("⚠️ EA2-A02: a preview não devolve a declaração provisória de marketing", async () => {
    const r = await r2(await POST(req({ token: TOKEN, action: "preview" })));
    expect(JSON.stringify(r.body)).not.toContain("marketing");
  });
  it("confirm repetido: already_confirmed, sem código", async () => {
    st.confirmar = { ok: true, resultado: "ja_confirmado" };
    expect((await r2(await POST(req({ token: TOKEN, action: "confirm" })))).body).toEqual({ ok: true, result: "already_confirmed" });
  });
  it("decline: 200 declined", async () => {
    expect((await r2(await POST(req({ token: TOKEN, action: "decline" })))).body).toEqual({ ok: true, result: "declined" });
    expect(st.chamadas).toEqual([["recusar", HASH]]);
  });
});

describe("② anti-enumeração — sem token válido, UMA resposta", () => {
  it("⚠️⚠️ inexistente/expirado/consumido (preview nulo), confirmar inválido, recusar inválido e token malformado: idênticos", async () => {
    const invalido = { status: 400, cache: "no-store", body: { ok: false, error: "invalid_or_expired" } };
    st.preview = { ok: true, preview: null };
    expect(await r2(await POST(req({ token: TOKEN, action: "preview" })))).toEqual(invalido);
    st.confirmar = { ok: true, resultado: "invalido" };
    expect(await r2(await POST(req({ token: TOKEN, action: "confirm" })))).toEqual(invalido);
    st.recusar = "invalido";
    expect(await r2(await POST(req({ token: TOKEN, action: "decline" })))).toEqual(invalido);
    st.chamadas = [];
    for (const t of ["", "curto", TOKEN + "x", 42, null]) {
      expect(await r2(await POST(req({ token: t, action: "confirm" }))), JSON.stringify(t)).toEqual(invalido);
    }
    expect(st.chamadas).toHaveLength(0); // malformado não custa query
  });
});

describe("③ fail-closed e forma", () => {
  it("⚠️ gate fechado → 503 e o store não é chamado", async () => {
    st.gateAberto = false;
    expect((await POST(req({ token: TOKEN, action: "confirm" }))).status).toBe(503);
    expect(st.chamadas).toHaveLength(0);
  });
  it("⚠️ origem estranha → 403", async () => {
    expect((await POST(req({ token: TOKEN, action: "confirm" }, { origin: "https://evil.example" }))).status).toBe(403);
    expect(st.chamadas).toHaveLength(0);
  });
  it("⚠️ D-6: email NUNCA é campo; correção só em confirm; ação desconhecida recusada", async () => {
    expect((await r2(await POST(req({ token: TOKEN, action: "confirm", email: "x@y.com" })))).body)
      .toMatchObject({ error: "campo_desconhecido", field: "email" });
    expect((await r2(await POST(req({ token: TOKEN, action: "preview", display_name: "X" })))).body)
      .toMatchObject({ error: "campo_desconhecido" });
    expect((await r2(await POST(req({ token: TOKEN, action: "approve" })))).body)
      .toMatchObject({ error: "campo_invalido", field: "action" });
    expect((await r2(await POST(req({ token: TOKEN, action: "confirm", country: "br" })))).body)
      .toMatchObject({ error: "campo_invalido", field: "country" });
    expect(st.chamadas).toHaveLength(0);
  });
  it("correção recusada pelo banco → 400 campo_invalido; banco fora → 503 genérico", async () => {
    st.confirmar = { ok: false, erro: "correcao_invalida" };
    expect((await POST(req({ token: TOKEN, action: "confirm", display_name: "Ana B" }))).status).toBe(400);
    st.confirmar = { ok: false, erro: "erro_banco" };
    expect(await r2(await POST(req({ token: TOKEN, action: "confirm" })))).toMatchObject({ status: 503, body: { error: "unavailable" } });
  });
  it("não-JSON 415; corpo > 2 KiB 413; IP estourado 429", async () => {
    expect((await POST(req({ token: TOKEN, action: "confirm" }, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(req(JSON.stringify({ token: TOKEN, action: "confirm", display_name: "x".repeat(3000) })))).status).toBe(413);
    st.limites = true;
    expect((await POST(req({ token: TOKEN, action: "confirm" }))).status).toBe(429);
  });
});

describe("④ nada do token em log", () => {
  it("⚠️⚠️ logSecurity nunca recebe token nem hash", async () => {
    st.confirmar = { ok: false, erro: "erro_banco" };
    await POST(req({ token: TOKEN, action: "confirm" }));
    await POST(req({ token: TOKEN, action: "decline" }));
    await POST(req({ token: TOKEN, action: "confirm" }, { origin: "https://evil.example" }));
    const tudo = JSON.stringify(st.seguranca);
    expect(st.seguranca.length).toBeGreaterThan(0);
    expect(tudo).not.toContain(TOKEN);
    expect(tudo).not.toContain(HASH);
  });
  it("⚠️ não existe GET (o link abre uma página inerte)", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/early-access/verify/route.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+GET/);
    expect(src).not.toMatch(/console\./);
  });
});
