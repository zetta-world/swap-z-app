/**
 * Fase 2 — cron (retry + purga) e webhook do Resend.
 *
 * ⚠️ Webhook não autenticado não muda estado (D-10); cron sem CRON_SECRET
 * não faz nada. Segredos aqui são fixos e sintéticos.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

const st = vi.hoisted(() => ({
  gateAberto: false,
  purgadas: 3 as number | null,
  reenviados: 2 as number | null,
  webhook: "processado" as string | null,
  chamadas: [] as unknown[][],
  seguranca: [] as Array<[string, Record<string, unknown>]>,
}));
vi.mock("@/lib/early-access/gate", () => ({
  lerGateEarlyAccess: async () => ({ aberto: st.gateAberto, motivos: [] }),
}));
vi.mock("@/lib/early-access/store", () => ({
  purgarNaoVerificados: async (...a: unknown[]) => { st.chamadas.push(["purgar", ...a]); return st.purgadas; },
  registrarWebhook: async (...a: unknown[]) => { st.chamadas.push(["webhook", ...a]); return st.webhook; },
}));
vi.mock("@/lib/early-access/email/enviar", () => ({
  reenviarPendentes: async (...a: unknown[]) => { st.chamadas.push(["retry", ...a]); return st.reenviados; },
}));
vi.mock("@/lib/admin/track", () => ({
  logSecurity: (k: string, m: Record<string, unknown>) => { st.seguranca.push([k, m]); },
  recordEvent: async () => {}, logError: () => {},
}));

import { POST as CRON } from "./cron/route";
import { POST as WEBHOOK } from "./webhook/resend/route";

const CRON_FALSO = "cron-segredo-sintetico-de-teste-0001";
const SEGREDO_WH = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff));

beforeEach(() => {
  st.gateAberto = false; st.purgadas = 3; st.reenviados = 2; st.webhook = "processado";
  st.chamadas = []; st.seguranca = [];
  process.env.CRON_SECRET = CRON_FALSO;
  process.env.EARLY_ACCESS_RESEND_WEBHOOK_SECRET = "whsec_" + SEGREDO_WH.toString("base64");
});
afterEach(() => { delete process.env.CRON_SECRET; delete process.env.EARLY_ACCESS_RESEND_WEBHOOK_SECRET; });

const cron = (auth?: string) => new NextRequest("http://localhost/api/early-access/cron", {
  method: "POST", headers: auth === undefined ? {} : { authorization: auth },
});

describe("① cron", () => {
  it.each([[undefined], ["Bearer errado"], [`Bearer ${CRON_FALSO}x`], [""]])("⚠️ auth %s → 401 sem trabalho", async (a) => {
    expect((await CRON(cron(a))).status).toBe(401);
    expect(st.chamadas).toHaveLength(0);
  });
  it("⚠️ sem CRON_SECRET configurado → 401 para todos", async () => {
    delete process.env.CRON_SECRET;
    expect((await CRON(cron("Bearer "))).status).toBe(401);
    expect(st.chamadas).toHaveLength(0);
  });
  it("gate FECHADO: purga roda (privacidade), retry NÃO (nada é enviado)", async () => {
    const r = await CRON(cron(`Bearer ${CRON_FALSO}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, purgadas: 3, reenviados: 0, gate_aberto: false });
    expect(st.chamadas.map((c) => c[0])).toEqual(["purgar"]);
  });
  it("gate aberto: purga + retry", async () => {
    st.gateAberto = true;
    const r = await CRON(cron(`Bearer ${CRON_FALSO}`));
    expect(await r.json()).toEqual({ ok: true, purgadas: 3, reenviados: 2, gate_aberto: true });
    expect(st.chamadas.map((c) => c[0])).toEqual(["purgar", "retry"]);
  });
  it("falha de banco → 503 e alerta", async () => {
    st.purgadas = null;
    const r = await CRON(cron(`Bearer ${CRON_FALSO}`));
    expect(r.status).toBe(503);
    expect(st.seguranca.map(([k]) => k)).toContain("early_access_purga_falhou");
  });
});

describe("② webhook do Resend", () => {
  const corpo = JSON.stringify({ type: "email.bounced", created_at: "x", data: { email_id: "msg_1", to: ["ana@example.com"] } });
  function wh(c: string, o: { id?: string; ts?: number; chave?: Buffer; sig?: string } = {}) {
    const id = o.id ?? "msg_evt_1";
    const ts = o.ts ?? Math.floor(Date.now() / 1000);
    const sig = o.sig ?? "v1," + createHmac("sha256", o.chave ?? SEGREDO_WH).update(`${id}.${ts}.${c}`).digest("base64");
    return new NextRequest("http://localhost/api/early-access/webhook/resend", {
      method: "POST", headers: { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": sig, "content-type": "application/json" }, body: c,
    });
  }
  it("assinado: registra (id do evento, tipo, id da mensagem) — sem o endereço", async () => {
    const r = await WEBHOOK(wh(corpo));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, result: "processado" });
    expect(st.chamadas).toEqual([["webhook", "msg_evt_1", "email.bounced", "msg_1"]]);
    expect(JSON.stringify(st.chamadas)).not.toContain("ana@example.com");
  });
  it("⚠️⚠️ assinatura errada, chave errada, timestamp velho → 401 e NADA muda", async () => {
    for (const r of [
      wh(corpo, { sig: "v1,AAAA" }),
      wh(corpo, { chave: Buffer.alloc(32, 9) }),
      wh(corpo, { ts: Math.floor(Date.now() / 1000) - 3600 }),
    ]) expect((await WEBHOOK(r)).status).toBe(401);
    expect(st.chamadas).toHaveLength(0);
  });
  it("⚠️ sem segredo configurado → 401 para todos", async () => {
    delete process.env.EARLY_ACCESS_RESEND_WEBHOOK_SECRET;
    expect((await WEBHOOK(wh(corpo))).status).toBe(401);
    expect(st.chamadas).toHaveLength(0);
  });
  it("reentrega: 200 'duplicado' (idempotente)", async () => {
    st.webhook = "duplicado";
    expect(await (await WEBHOOK(wh(corpo))).json()).toEqual({ ok: true, result: "duplicado" });
  });
  it("assinado mas corpo que não é evento → 400, sem gravar", async () => {
    expect((await WEBHOOK(wh("[]"))).status).toBe(400);
    expect(st.chamadas).toHaveLength(0);
  });
  it("banco fora → 500 (o provider reentrega)", async () => {
    st.webhook = null;
    expect((await WEBHOOK(wh(corpo))).status).toBe(500);
  });
});
