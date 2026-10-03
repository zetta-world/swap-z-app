/**
 * /admin/api/early-access/* — autorização, transição auditada, CSV seguro.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const st = vi.hoisted(() => ({
  admin: true,
  transicao: { ok: true, de: "pending", para: "approved" } as unknown,
  exportOk: true,
  linhas: [] as Record<string, unknown>[],
  total: null as number | null,     // null = usa linhas.length
  maxPedido: [] as number[],
  chamadas: [] as string[],
  audit: [] as unknown[][],
  seguranca: [] as Array<[string, string]>,
}));

vi.mock("@/lib/admin/require", () => ({
  requireAdmin: async () => {
    if (!st.admin) throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
    return { wallet: "0xADMIN000000000000000000000000000000000001" };
  },
  logAdminAction: async (...a: unknown[]) => { st.audit.push(a); },
}));
vi.mock("@/lib/admin/realtime", () => ({ broadcastAdminRefresh: () => {} }));
vi.mock("@/lib/admin/track", () => ({
  logSecurity: (k: string, _m: unknown, s: string) => { st.seguranca.push([k, s]); },
  recordEvent: async () => {}, logError: () => {},
}));
vi.mock("@/lib/early-access/gate", () => ({ lerGateEarlyAccess: async () => ({ aberto: false, motivos: ["kv_fechado"] }) }));
vi.mock("@/lib/early-access/store", () => ({
  listar: async () => { st.chamadas.push("listar"); return { ok: true, linhas: [], total: 0 }; },
  detalhe: async () => { st.chamadas.push("detalhe"); return { ok: true, linha: null, eventos: [], consentimentos: [] }; },
  metricas: async () => { st.chamadas.push("metricas"); return { ok: false, erro: "erro_banco" }; },
  transicionar: async (...a: unknown[]) => { st.chamadas.push(`transicionar:${JSON.stringify(a)}`); return st.transicao; },
  contarInscricoes: async () => ({ ok: true, total: st.total ?? st.linhas.length }),
  lerTudoParaExport: async (max: number) => { st.chamadas.push("export"); st.maxPedido.push(max); return st.linhas; },
  registrarExport: async (...a: unknown[]) => { st.chamadas.push(`registrar:${JSON.stringify(a)}`); return st.exportOk; },
}));

import { GET as LISTA } from "./route";
import { POST as TRANSICAO } from "./transition/route";
import { GET as EXPORT } from "./export/route";

const ID = "11111111-2222-4333-8444-555555555555";
const get = (url: string) => new NextRequest(`http://localhost${url}`);
const post = (body: unknown) => new NextRequest("http://localhost/admin/api/early-access/transition", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  st.admin = true; st.exportOk = true; st.linhas = []; st.total = null; st.maxPedido = [];
  st.chamadas = []; st.audit = []; st.seguranca = [];
  st.transicao = { ok: true, de: "pending", para: "approved" };
});

describe("① sem admin, nada roda", () => {
  it("⚠️ as três rotas falham no requireAdmin e não tocam o store", async () => {
    st.admin = false;
    await expect(LISTA(get("/admin/api/early-access"))).rejects.toThrow();
    await expect(TRANSICAO(post({ id: ID, to: "approved" }))).rejects.toThrow();
    await expect(EXPORT(get("/admin/api/early-access/export"))).rejects.toThrow();
    expect(st.chamadas).toEqual([]);
  });
});

describe("② lista", () => {
  it("parâmetro inválido é 400, nunca ignorado", async () => {
    for (const q of ["status=verified", "limit=0", "limit=201", "offset=-1", "country=XX", "has_wallet=sim", "q=%27or%201", "verified=sim", "verified=true"]) {
      const r = await LISTA(get(`/admin/api/early-access?${q}`));
      expect(r.status, q).toBe(400);
    }
    expect(st.chamadas).toEqual([]);
  });
  it("métrica que falhou volta null, não zero; gate vem com motivos", async () => {
    const j = await (await LISTA(get("/admin/api/early-access?status=pending&country=BR"))).json();
    expect(j.metricas).toBeNull();
    expect(j.gate).toEqual({ aberto: false, motivos: ["kv_fechado"] });
  });
  it("id malformado → 400; inexistente → 404", async () => {
    expect((await LISTA(get("/admin/api/early-access?id=abc"))).status).toBe(400);
    expect((await LISTA(get(`/admin/api/early-access?id=${ID}`))).status).toBe(404);
  });
});

describe("③ transição", () => {
  it("sucesso: ator é o admin da sessão, e o espelho no audit vem DEPOIS", async () => {
    const r = await TRANSICAO(post({ id: ID, to: "approved", reason_code: "approved_verified" }));
    expect(await r.json()).toEqual({ ok: true, mudou: true, de: "pending", para: "approved" });
    expect(st.chamadas[0]).toContain('"admin:0xADMIN000000000000000000000000000000000001"');
    expect(st.audit).toHaveLength(1);
    expect(st.audit[0][1]).toBe("early_access.transition");
  });
  it("⚠️⚠️ falha de audit na RPC → transição falha, nada é espelhado", async () => {
    st.transicao = { ok: false, erro: "erro_banco" };
    const r = await TRANSICAO(post({ id: ID, to: "blocked", reason_code: "abuse" }));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "erro_banco", mudou: false });
    expect(st.audit).toHaveLength(0);
  });
  it("transição proibida → 409; motivo ausente → 400", async () => {
    st.transicao = { ok: false, erro: "early_access_transicao_proibida" };
    expect((await TRANSICAO(post({ id: ID, to: "approved", reason_code: "approved_verified" }))).status).toBe(409);
    st.transicao = { ok: false, erro: "early_access_motivo_obrigatorio" };
    expect((await TRANSICAO(post({ id: ID, to: "rejected", reason_code: "rejected_policy" }))).status).toBe(400);
  });
  it("⚠️ D-4 (Fase 2): aprovar sem email verificado → 409 com o código; nada espelhado no audit", async () => {
    st.transicao = { ok: false, erro: "early_access_email_nao_verificado" };
    const r = await TRANSICAO(post({ id: ID, to: "approved", reason_code: "approved_verified" }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "early_access_email_nao_verificado", mudou: false });
    expect(st.audit).toHaveLength(0);
  });
  it("entrada inválida não chega à RPC", async () => {
    for (const b of [{ id: "x", to: "approved", reason_code: "approved_verified" }, { id: ID, to: "converted", reason_code: "other" },
                     { id: ID, to: "approved" }, { id: ID, to: "approved", reason_code: "spam livre" },
                     { id: ID, to: "approved", reason_code: "other", note: 5 },
                     { id: ID, to: "approved", reason_code: "other", note: "x".repeat(401) }]) {
      expect((await TRANSICAO(post(b))).status).toBe(400);
    }
    expect(st.chamadas).toEqual([]);
  });
  it("⚠️⚠️ EA2-IA07: texto livre NUNCA chega ao admin_audit_log persistente — só o código controlado", async () => {
    st.transicao = { ok: true, de: "pending", para: "blocked" };
    const PII = "Joao da Silva joao@example.com +55 11 99999-0000";
    const r = await TRANSICAO(post({ id: ID, to: "blocked", reason_code: "abuse", note: PII }));
    expect(r.status).toBe(200);
    // a nota vai SÓ para a RPC (registro da inscrição, apagado na purga)
    expect(st.chamadas[0]).toContain(`"abuse — ${PII}"`);
    // o log persistente recebe apenas de/para/código
    expect(st.audit).toHaveLength(1);
    expect(st.audit[0][3]).toEqual({ de: "pending", para: "blocked", motivo_codigo: "abuse" });
    expect(JSON.stringify(st.audit)).not.toMatch(/Joao|joao@|99999/);
  });
  it("⚠️ EA2-IA07: o campo antigo `reason` (texto livre) e campos extras são RECUSADOS sem tocar a RPC nem o log", async () => {
    for (const b of [{ id: ID, to: "blocked", reason: "Joao da Silva" },
                     { id: ID, to: "blocked", reason_code: "abuse", reason: "Joao" },
                     { id: ID, to: "blocked", reason_code: "abuse", motivo: "x" }]) {
      expect((await TRANSICAO(post(b))).status).toBe(400);
    }
    expect(st.chamadas).toEqual([]);
    expect(st.audit).toEqual([]);
  });
  it("EA2-IA07: sem nota, a RPC recebe só o código; todos os códigos válidos passam", async () => {
    const { MOTIVOS } = await import("@/lib/early-access/estados");
    for (const m of MOTIVOS) {
      st.chamadas = []; st.audit = [];
      await TRANSICAO(post({ id: ID, to: "approved", reason_code: m }));
      expect(st.chamadas[0]).toContain(`"${m}"`);
      expect(st.audit[0][3]).toEqual({ de: "pending", para: "approved", motivo_codigo: m });
    }
  });
  it("desbloqueio gera alerta de segurança alto", async () => {
    st.transicao = { ok: true, de: "blocked", para: "pending" };
    await TRANSICAO(post({ id: ID, to: "pending", reason_code: "administrative_correction" }));
    expect(st.seguranca).toContainEqual(["early_access_desbloqueio", "high"]);
  });
});

describe("④ export CSV", () => {
  const linha = {
    id: ID, email_normalized: "=cmd@x.com", created_at: "2026-10-01T00:00:00Z", status: "pending",
    status_reason: null, display_name: '=HYPERLINK("http://evil","x")', country: "BR",
    wallet_chain: null, wallet_address: null, wallet_verified_at: null, email_verified_at: null,
    converted_at: null, referral_code: "ABCDEFGH12", referred_by_signup_id: null, referral_flag: null,
    utm_source: "@SUM(1)", utm_medium: "-2+3", utm_campaign: null, source: "early_access_page", marketing_opt_in: false,
  };
  it("⚠️⚠️ CSV injection neutralizada em nome e UTM", async () => {
    st.linhas = [linha];
    const csv = await (await EXPORT(get("/admin/api/early-access/export?identidade=1"))).text();
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csv).toContain("'@SUM(1)");
    expect(csv).toContain("'-2+3");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });
  it("⚠️ email só sai com ?email=1 (minimização)", async () => {
    st.linhas = [linha];
    const sem = await (await EXPORT(get("/admin/api/early-access/export"))).text();
    expect(sem.split("\n")[0]).not.toContain("email_normalized");
    expect(sem).not.toContain("cmd@x.com");
    const com = await (await EXPORT(get("/admin/api/early-access/export?email=1"))).text();
    expect(com.split("\n")[0]).toContain("email_normalized");
    expect(com).toContain("'=cmd@x.com");
  });
  it("⚠️⚠️ export não registrado → 503 e NENHUM dado entregue", async () => {
    st.linhas = [linha]; st.exportOk = false;
    const r = await EXPORT(get("/admin/api/early-access/export?email=1"));
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("cmd@x.com");
  });
  it("registro leva ator, contagem e se tinha email", async () => {
    st.linhas = [linha, linha];
    await EXPORT(get("/admin/api/early-access/export?email=1"));
    expect(st.chamadas).toContain(
      'registrar:["0xADMIN000000000000000000000000000000000001",2,{"email":true,"identidade":false}]');
  });

  it("⚠️⚠️ F-12: export PADRÃO não leva dado pessoal nem sinal interno", async () => {
    st.linhas = [{ ...linha, wallet_chain: "evm", wallet_address: "0xABCDEF0123456789ABCDEF0123456789ABCDEF01",
      referral_flag: "sinal_mesmo_ip", status_reason: "Fulano de Tal, CPF 000" }];
    const csv = await (await EXPORT(get("/admin/api/early-access/export"))).text();
    const cab = csv.split("\n")[0].split(",");
    for (const proibida of ["email_normalized", "display_name", "wallet_address", "wallet_chain", "telegram_handle",
      "x_handle", "ip_hmac", "referral_flag", "status_reason", "referral_code", "referred_by_signup_id"]) {
      expect(cab, proibida).not.toContain(proibida);
    }
    expect(cab).toEqual(["id", "created_at", "status", "country", "source", "utm_source", "utm_medium", "utm_campaign",
      "email_verified_at", "wallet_verified_at", "converted_at", "marketing_efetivo", "marketing_escolhido_em",
      // EA2-IA04: elegibilidade (efetivo E não suprimido) + o estado de supressão, sempre juntos
      "marketing_elegivel", "email_suppressed_at", "email_suppression_reason"]);
    // EA2-A02: a declaração provisória nunca sai como se fosse consentimento
    expect(cab).not.toContain("marketing_opt_in");
    for (const pii of ["cmd@x.com", "HYPERLINK", "0xABCDEF", "sinal_mesmo_ip", "Fulano"]) expect(csv).not.toContain(pii);
  });
  it("F-12: identidade=1 é opt-in separado do email", async () => {
    st.linhas = [linha];
    const cab = (await (await EXPORT(get("/admin/api/early-access/export?identidade=1"))).text()).split("\n")[0];
    expect(cab).toContain("display_name");
    expect(cab).toContain("wallet_address");
    expect(cab).not.toContain("email_normalized");
  });
  it("csvCell continua em TODA célula, inclusive nas colunas padrão", async () => {
    st.linhas = [{ ...linha, country: "=1+1" as unknown as string, source: "@x" }];
    const csv = await (await EXPORT(get("/admin/api/early-access/export"))).text();
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@x");
  });
});

describe("⑤ F-08 — export nunca trunca em silêncio", () => {
  const linha = { id: ID, created_at: "2026-10-01T00:00:00Z", status: "pending", country: "BR", source: "early_access_page" };
  it("⚠️⚠️ 100 001 inscrições → 413 export_too_large, sem ler, sem CSV, sem registro", async () => {
    st.total = 100_001;
    const r = await EXPORT(get("/admin/api/early-access/export?email=1"));
    expect(r.status).toBe(413);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(await r.json()).toEqual({ error: "export_too_large", total: 100_001, teto: 100_000 });
    expect(st.chamadas.filter((c) => c === "export" || c.startsWith("registrar"))).toEqual([]);
  });
  it("cresceu entre a contagem e a leitura (> teto) → 413, sem CSV", async () => {
    st.total = 100_000;
    st.linhas = Array.from({ length: 100_001 }, () => linha);
    const r = await EXPORT(get("/admin/api/early-access/export"));
    expect(r.status).toBe(413);
    expect(st.maxPedido).toEqual([100_001]);
    expect(st.chamadas.some((c) => c.startsWith("registrar"))).toBe(false);
  });
  it("leu MENOS que a contagem → 503 export_inconsistente, sem CSV", async () => {
    st.total = 5; st.linhas = [linha, linha];
    const r = await EXPORT(get("/admin/api/early-access/export"));
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: "export_inconsistente" });
  });
  it("exatamente no teto exporta, e o audit registra a quantidade conferida", async () => {
    st.total = 3; st.linhas = [linha, linha, linha];
    const r = await EXPORT(get("/admin/api/early-access/export"));
    expect(r.status).toBe(200);
    expect((await r.text()).split("\n")).toHaveLength(4);
    expect(st.chamadas.some((c) => c.startsWith('registrar:["0xADMIN000000000000000000000000000000000001",3,'))).toBe(true);
  });
});
