/**
 * EMAIL DO EARLY ACCESS — configuração fail-closed, templates, adaptador
 * Resend (fetch MOCKADO: nenhum teste toca a rede), envio/retry e assinatura
 * do webhook.
 *
 * ⚠️ Nenhum valor aqui é credencial real: chaves e segredos são fixos,
 * sintéticos e só têm o FORMATO certo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const st = vi.hoisted(() => ({
  registros: [] as unknown[][],
  registrarOk: true,
  pendentes: [] as string[] | null,
  reemitidos: [] as unknown[][],
  alvo: { email: "ana@example.com", locale: "pt" } as { email: string; locale: string } | null,
  seguranca: [] as Array<[string, Record<string, unknown>]>,
}));
vi.mock("../store", () => ({
  registrarEnvio: async (...a: unknown[]) => { st.registros.push(a); return st.registrarOk; },
  pendentesDeEnvio: async () => st.pendentes,
  reemitir: async (...a: unknown[]) => { st.reemitidos.push(a); return st.alvo; },
}));
vi.mock("@/lib/admin/track", () => ({
  logSecurity: (k: string, m: Record<string, unknown>) => { st.seguranca.push([k, m]); },
  recordEvent: async () => {}, logError: () => {},
}));

import { configEmail, remetenteValido, baseUrlValida, segredoWebhook } from "./config";
import { mensagemConfirmacao, linkConfirmacao, LOCALES } from "./templates";
import { enviarResend, RESEND_URL } from "./resend";
import { enviarConfirmacao, reenviarPendentes } from "./enviar";
import { assinaturaValida, lerEvento } from "./webhook";
import { hashToken } from "../token";

// Sintéticos, só no formato: NÃO são credenciais.
const CHAVE_FALSA = "re_" + "x".repeat(24);
const ENV_OK = {
  EARLY_ACCESS_EMAIL_PROVIDER: "resend",
  EARLY_ACCESS_RESEND_API_KEY: CHAVE_FALSA,
  EARLY_ACCESS_EMAIL_FROM: "Z-SWAP <no-reply@mail.example.com>",
  EARLY_ACCESS_PUBLIC_BASE_URL: "https://zswap.example.com",
} as unknown as NodeJS.ProcessEnv;
const TOKEN = "B".repeat(42) + "Q";
const SEGREDO_WH = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff));
const WHSEC = "whsec_" + SEGREDO_WH.toString("base64");

const chamadas: Array<{ url: string; init: RequestInit }> = [];
let respostaFetch: () => Promise<Response> = async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });

beforeEach(() => {
  st.registros = []; st.registrarOk = true; st.pendentes = []; st.reemitidos = [];
  st.alvo = { email: "ana@example.com", locale: "pt" }; st.seguranca = [];
  chamadas.length = 0;
  respostaFetch = async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return respostaFetch(); });
  for (const [k, v] of Object.entries(ENV_OK)) process.env[k] = v;
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV_OK)) delete process.env[k];
});

describe("① configuração — sem config VÁLIDA completa, null (o gate fecha)", () => {
  it("completa → config com a origem https", () => {
    expect(configEmail(ENV_OK)).toEqual({
      provedor: "resend", apiKey: CHAVE_FALSA, from: ENV_OK.EARLY_ACCESS_EMAIL_FROM, baseUrl: "https://zswap.example.com",
    });
  });
  it.each([
    ["provider ausente",       { EARLY_ACCESS_EMAIL_PROVIDER: undefined }],
    ["provider desconhecido",  { EARLY_ACCESS_EMAIL_PROVIDER: "sendgrid" }],
    ["chave ausente",          { EARLY_ACCESS_RESEND_API_KEY: undefined }],
    ["chave fora do formato",  { EARLY_ACCESS_RESEND_API_KEY: "sk_live_123" }],
    ["remetente ausente",      { EARLY_ACCESS_EMAIL_FROM: undefined }],
    ["⚠️ remetente com CRLF",   { EARLY_ACCESS_EMAIL_FROM: "a@b.com\r\nBcc: x@y.com" }],
    ["base http",              { EARLY_ACCESS_PUBLIC_BASE_URL: "http://zswap.example.com" }],
    ["base com caminho",       { EARLY_ACCESS_PUBLIC_BASE_URL: "https://zswap.example.com/x" }],
    ["base com credencial",    { EARLY_ACCESS_PUBLIC_BASE_URL: "https://u:p@zswap.example.com" }],
  ])("%s → null", (_n, extra) => {
    expect(configEmail({ ...ENV_OK, ...extra } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
  it("remetente e base: aceita as formas legítimas", () => {
    expect(remetenteValido("no-reply@mail.example.com")).toBe("no-reply@mail.example.com");
    expect(remetenteValido("Z <a@b.co>")).toBe("Z <a@b.co>");
    expect(baseUrlValida("https://zswap.example.com/")).toBe("https://zswap.example.com");
  });
  it("segredo do webhook: whsec_ + base64 canônico ≥ 24 bytes, senão null", () => {
    expect(segredoWebhook({ EARLY_ACCESS_RESEND_WEBHOOK_SECRET: WHSEC } as unknown as NodeJS.ProcessEnv)?.equals(SEGREDO_WH)).toBe(true);
    for (const v of [undefined, "", "abc", "whsec_", "whsec_!!!!", "whsec_" + Buffer.alloc(8, 1).toString("base64")]) {
      expect(segredoWebhook({ EARLY_ACCESS_RESEND_WEBHOOK_SECRET: v } as unknown as NodeJS.ProcessEnv), String(v)).toBeNull();
    }
  });
});

describe("② template e link", () => {
  it("⚠️ link no FRAGMENTO, a partir da base configurada", () => {
    expect(linkConfirmacao("https://zswap.example.com", TOKEN)).toBe(`https://zswap.example.com/early-access/confirm#t=${TOKEN}`);
  });
  it("4 idiomas, cada um com o link, prazo e saída 'não fui eu'; sem URL externa além do link", () => {
    const link = linkConfirmacao("https://zswap.example.com", TOKEN);
    const assuntos = new Set<string>();
    for (const l of LOCALES) {
      const m = mensagemConfirmacao(l, link);
      assuntos.add(m.assunto);
      expect(m.texto).toContain(link);
      expect(m.html).toContain(link);
      expect(m.texto).toMatch(/24/);
      expect(m.texto).toMatch(/7/);
      const urls = [...m.html.matchAll(/https?:\/\/[^\s"<]+/g)].map((x) => x[0]);
      for (const u of urls) expect(u.startsWith("https://zswap.example.com/early-access/confirm#t=")).toBe(true);
      expect(m.html).not.toMatch(/<img|<script|<link/i);
    }
    expect(assuntos.size).toBe(4);
  });
  it("⚠️ o email não carrega nome nem dado da inscrição (só o link)", () => {
    const m = mensagemConfirmacao("pt", linkConfirmacao("https://zswap.example.com", TOKEN));
    expect(m.texto).not.toMatch(/\{|\}/);
  });
});

describe("③ adaptador Resend (fetch mockado)", () => {
  const msg = { para: "ana@example.com", assunto: "a", texto: "t", html: "<p>h</p>" };
  it("POST na API com Bearer, Idempotency-Key e corpo mínimo", async () => {
    const r = await enviarResend(configEmail(ENV_OK)!, msg, "chave-idem");
    expect(r).toEqual({ ok: true, id: "msg_1" });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(RESEND_URL);
    const h = chamadas[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe(`Bearer ${CHAVE_FALSA}`);
    expect(h["Idempotency-Key"]).toBe("chave-idem");
    expect(JSON.parse(String(chamadas[0].init.body))).toEqual({
      from: ENV_OK.EARLY_ACCESS_EMAIL_FROM, to: ["ana@example.com"], subject: "a", text: "t", html: "<p>h</p>",
    });
  });
  it.each([
    [401, "config", false], [403, "config", false], [422, "rejeitado", false], [400, "rejeitado", false],
    [429, "rate_limited", true], [500, "provider_5xx", true], [503, "provider_5xx", true],
  ])("HTTP %i → %s (transitório=%s), sem ecoar o corpo", async (status, codigo, transitorio) => {
    respostaFetch = async () => new Response(JSON.stringify({ message: "ana@example.com segredo" }), { status });
    const r = await enviarResend(configEmail(ENV_OK)!, msg, "k");
    expect(r).toEqual({ ok: false, codigo, transitorio });
    expect(JSON.stringify(r)).not.toContain("ana@example.com");
  });
  it("rede/timeout → rede (transitório); 200 sem id → resposta_invalida", async () => {
    respostaFetch = async () => { throw new Error("ECONNRESET"); };
    expect(await enviarResend(configEmail(ENV_OK)!, msg, "k")).toEqual({ ok: false, codigo: "rede", transitorio: true });
    respostaFetch = async () => new Response("{}", { status: 200 });
    expect(await enviarResend(configEmail(ENV_OK)!, msg, "k")).toEqual({ ok: false, codigo: "resposta_invalida", transitorio: false });
  });
});

describe("④ envio e retry — o token cru não vaza", () => {
  it("sucesso: registra sent com o id; chave de idempotência derivada (nem token nem hash)", async () => {
    await enviarConfirmacao({ email: "ana@example.com", locale: "pt", token: TOKEN });
    const h = hashToken(TOKEN)!;
    expect(st.registros).toEqual([[h, true, null, "msg_1", null]]);
    const chave = (chamadas[0].init.headers as Record<string, string>)["Idempotency-Key"];
    expect(chave).toMatch(/^[0-9a-f]{48}$/);
    expect(chave).not.toContain(TOKEN);
    expect(h).not.toContain(chave);
    // o token só vai no CORPO do email
    expect(String(chamadas[0].init.body)).toContain(`#t=${TOKEN}`);
  });
  it("falha: registra failed com o CÓDIGO; logSecurity sem email, token nem hash", async () => {
    respostaFetch = async () => new Response("{}", { status: 503 });
    await enviarConfirmacao({ email: "ana@example.com", locale: "pt", token: TOKEN });
    expect(st.registros).toEqual([[hashToken(TOKEN), false, "provider_5xx", null, true]]);
    const tudo = JSON.stringify(st.seguranca);
    expect(tudo).not.toContain("ana@example.com");
    expect(tudo).not.toContain(TOKEN);
    expect(tudo).not.toContain(hashToken(TOKEN)!);
  });
  it("⚠️ sem config: NÃO chama a rede e registra failed 'config'", async () => {
    delete process.env.EARLY_ACCESS_RESEND_API_KEY;
    await enviarConfirmacao({ email: "ana@example.com", locale: "pt", token: TOKEN });
    expect(chamadas).toHaveLength(0);
    expect(st.registros[0]).toEqual([hashToken(TOKEN), false, "config", null, true]);
  });
  it.each([
    ["HTTP 400", async () => new Response("{}", { status: 400 }), "rejeitado", false],
    ["HTTP 401", async () => new Response("{}", { status: 401 }), "config", false],
    ["HTTP 403", async () => new Response("{}", { status: 403 }), "config", false],
    ["HTTP 422", async () => new Response("{}", { status: 422 }), "rejeitado", false],
    ["200 sem id", async () => new Response("{}", { status: 200 }), "resposta_invalida", false],
    ["200 id malformado", async () => new Response(JSON.stringify({ id: "a b" }), { status: 200 }), "resposta_invalida", false],
    ["HTTP 429", async () => new Response("{}", { status: 429 }), "rate_limited", true],
    ["HTTP 500", async () => new Response("{}", { status: 500 }), "provider_5xx", true],
    ["exceção de rede", async () => { throw new Error("ECONNRESET"); }, "rede", true],
  ] as Array<[string, () => Promise<Response>, string, boolean]>)(
    "⚠️⚠️ EA2-IA01: %s → registrado como %s com transitorio=%s EXPLÍCITO (permanente = dead no banco)",
    async (_n, resposta, codigo, transitorio) => {
      respostaFetch = resposta;
      await enviarConfirmacao({ email: "ana@example.com", locale: "pt", token: TOKEN });
      expect(st.registros).toEqual([[hashToken(TOKEN), false, codigo, null, transitorio]]);
    });
  it("token fora do formato: nada acontece", async () => {
    await enviarConfirmacao({ email: "ana@example.com", locale: "pt", token: "x" });
    expect(chamadas).toHaveLength(0);
    expect(st.registros).toHaveLength(0);
  });
  it("locale desconhecido cai para en", async () => {
    await enviarConfirmacao({ email: "ana@example.com", locale: "fr", token: TOKEN });
    expect(JSON.parse(String(chamadas[0].init.body)).subject).toBe(mensagemConfirmacao("en", "").assunto);
  });
  it("retry: cada pendente ganha token NOVO (hash novo na RPC) e um envio", async () => {
    st.pendentes = ["id-1", "id-2"];
    expect(await reenviarPendentes(20)).toBe(2);
    expect(st.reemitidos.map((a) => a[0])).toEqual(["id-1", "id-2"]);
    const hashes = st.reemitidos.map((a) => a[1] as string);
    for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(hashes).size).toBe(2);
    expect(chamadas).toHaveLength(2);
  });
  it("retry: lista ilegível → null; sem config → 0 sem ler nada", async () => {
    st.pendentes = null;
    expect(await reenviarPendentes(20)).toBeNull();
    delete process.env.EARLY_ACCESS_EMAIL_PROVIDER;
    st.pendentes = ["id-1"];
    expect(await reenviarPendentes(20)).toBe(0);
    expect(st.reemitidos).toHaveLength(0);
  });
});

describe("⑤ webhook — assinatura Svix", () => {
  const corpo = JSON.stringify({ type: "email.bounced", data: { email_id: "msg_1", to: ["ana@example.com"] } });
  const agora = 1_790_000_000;
  const assinar = (id: string, ts: number, c: string, chave = SEGREDO_WH) =>
    "v1," + createHmac("sha256", chave).update(`${id}.${ts}.${c}`).digest("base64");
  const base = { segredo: SEGREDO_WH, id: "msg_evt", timestamp: String(agora), corpo, agoraS: agora };
  it("assinatura correta passa (inclusive entre várias)", () => {
    expect(assinaturaValida({ ...base, assinaturas: assinar("msg_evt", agora, corpo) })).toBe(true);
    expect(assinaturaValida({ ...base, assinaturas: `v1,AAAA ${assinar("msg_evt", agora, corpo)}` })).toBe(true);
  });
  it("⚠️ corpo, id, timestamp ou chave diferentes → recusa", () => {
    const sig = assinar("msg_evt", agora, corpo);
    expect(assinaturaValida({ ...base, corpo: corpo + " ", assinaturas: sig })).toBe(false);
    expect(assinaturaValida({ ...base, id: "outro", assinaturas: sig })).toBe(false);
    expect(assinaturaValida({ ...base, assinaturas: assinar("msg_evt", agora, corpo, Buffer.alloc(32, 7)) })).toBe(false);
    expect(assinaturaValida({ ...base, assinaturas: sig.replace("v1,", "v2,") })).toBe(false);
  });
  it("⚠️ fora de ±5 min (replay) → recusa", () => {
    const ts = agora - 301;
    expect(assinaturaValida({ ...base, timestamp: String(ts), assinaturas: assinar("msg_evt", ts, corpo) })).toBe(false);
  });
  it("cabeçalho ausente → recusa", () => {
    expect(assinaturaValida({ ...base, assinaturas: null })).toBe(false);
    expect(assinaturaValida({ ...base, id: null, assinaturas: "v1,x" })).toBe(false);
  });
  it("evento: só tipo e email_id; o endereço não sai", () => {
    expect(lerEvento(corpo)).toEqual({ tipo: "email.bounced", messageId: "msg_1" });
    expect(JSON.stringify(lerEvento(corpo))).not.toContain("ana@example.com");
    expect(lerEvento("nope")).toBeNull();
    expect(lerEvento(JSON.stringify({ type: "DROP TABLE" }))).toBeNull();
  });
});

describe("⑥ fonte", () => {
  const dir = join(process.cwd(), "src/lib/early-access/email");
  const fontes = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => [f, readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")] as const);
  it("⚠️ o link nunca vem de cabeçalho da requisição (host header injection)", () => {
    for (const [f, src] of fontes) {
      expect(src, f).not.toMatch(/headers\.get\(\s*["'](host|x-forwarded-host)["']/i);
      expect(src, f).not.toMatch(/req(uest)?\.url/);
    }
  });
  it("⚠️ nenhum console.* com token, email ou resposta de provider", () => {
    for (const [f, src] of fontes) expect(src, f).not.toMatch(/console\.(log|error|warn|info)/);
  });
  it("nenhum segredo literal (só nomes de env)", () => {
    for (const [f, src] of fontes) {
      expect(src, f).not.toMatch(/["']re_[A-Za-z0-9_]{8,}["']/);
      expect(src, f).not.toMatch(/["']whsec_[A-Za-z0-9+/]{8,}/);
    }
  });
});
