/**
 * EARLY ACCESS — gate fail-closed, HMAC e códigos de indicação.
 *
 * ⚠️ O segredo dos testes é FALSO e local. Nenhum segredo real existe no repo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";

const banco = vi.hoisted(() => ({
  modo: "ok" as "ok" | "ausente" | "erro" | "lanca" | "sem_banco",
  valor: "false" as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => {
    if (banco.modo === "sem_banco") return null;
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (banco.modo === "lanca") throw new Error("rede caiu");
              if (banco.modo === "erro") return { data: null, error: { message: "boom" } };
              if (banco.modo === "ausente") return { data: null, error: null };
              return { data: { value: banco.valor }, error: null };
            },
          }),
        }),
      }),
    };
  },
}));

import { decidirGate, lerChaveGate, lerGateEarlyAccess } from "./gate";
import { ipHmac, emailHmac, segredoConfigurado, decodificarSegredo } from "./hmac";
import { gerarCodigo, gerarCandidatos, ALFABETO, TAMANHO } from "./referral";
import { PAISES_ISO } from "./paises";
import { REFERRAL_FORMATO } from "./validate";

// Segredo FALSO gerado na hora (48 bytes aleatórios em base64, como o RUNBOOK manda).
const SEGREDO_FALSO = randomBytes(48).toString("base64");
const APROVADO = { terms: "tos-1", privacy: "priv-1" };

beforeEach(() => { banco.modo = "ok"; banco.valor = "false"; delete process.env.EARLY_ACCESS_HMAC_SECRET; });
afterEach(() => { delete process.env.EARLY_ACCESS_HMAC_SECRET; });

describe("① decisão do gate — aberto só com as QUATRO condições", () => {
  const base = { kv: { lido: true as const, valor: "false" }, ...APROVADO, segredo: true };
  it("tudo certo → aberto", () => {
    expect(decidirGate(base)).toEqual({ aberto: true, motivos: [] });
  });
  it("⚠️ kv=true → fechado", () => {
    expect(decidirGate({ ...base, kv: { lido: true, valor: "true" } }).motivos).toEqual(["kv_fechado"]);
  });
  it("⚠️ linha ausente → fechado", () => {
    expect(decidirGate({ ...base, kv: { lido: true, valor: null } }).motivos).toEqual(["kv_ausente"]);
  });
  it("⚠️ leitura falhou → fechado", () => {
    expect(decidirGate({ ...base, kv: { lido: false } }).motivos).toEqual(["kv_leitura_falhou"]);
  });
  it("⚠️ valor inválido ('False', '0', '', 'no') → fechado", () => {
    for (const v of ["False", "0", "", "no", " false"]) {
      expect(decidirGate({ ...base, kv: { lido: true, valor: v } }).aberto, JSON.stringify(v)).toBe(false);
    }
  });
  it("⚠️⚠️ kv=false NÃO basta: versões UNAPPROVED fecham", () => {
    const r = decidirGate({ ...base, terms: "UNAPPROVED", privacy: "UNAPPROVED" });
    expect(r.aberto).toBe(false);
    expect(r.motivos).toEqual(["termos_nao_aprovados", "privacidade_nao_aprovada"]);
  });
  it("⚠️ sem segredo HMAC → fechado", () => {
    expect(decidirGate({ ...base, segredo: false }).motivos).toEqual(["segredo_ausente"]);
  });
});

describe("② leitura da chave — toda falha é 'não lido'", () => {
  it("valor lido", async () => {
    expect(await lerChaveGate()).toEqual({ lido: true, valor: "false" });
  });
  it("linha ausente é distinta de falha", async () => {
    banco.modo = "ausente";
    expect(await lerChaveGate()).toEqual({ lido: true, valor: null });
  });
  it.each(["erro", "lanca", "sem_banco"] as const)("banco %s → lido:false", async (modo) => {
    banco.modo = modo;
    expect(await lerChaveGate()).toEqual({ lido: false });
  });
});

describe("③ o gate REAL da Fase 1 está fechado", () => {
  it("⚠️⚠️ mesmo com kv=false e segredo presente, as versões UNAPPROVED fecham", async () => {
    process.env.EARLY_ACCESS_HMAC_SECRET = SEGREDO_FALSO;
    const g = await lerGateEarlyAccess();
    expect(g.aberto).toBe(false);
    expect(g.motivos).toContain("termos_nao_aprovados");
    expect(g.motivos).toContain("privacidade_nao_aprovada");
  });
  it("sem segredo e com banco fora: todos os motivos aparecem", async () => {
    banco.modo = "erro";
    const g = await lerGateEarlyAccess();
    expect(g.motivos).toEqual(expect.arrayContaining(["kv_leitura_falhou", "segredo_ausente"]));
  });
});

describe("④ HMAC", () => {
  it("⚠️ sem segredo → null (a rota não aceita)", () => {
    expect(segredoConfigurado()).toBe(false);
    expect(ipHmac("189.40.1.2")).toBeNull();
    expect(emailHmac("a@b.co")).toBeNull();
  });
  it("segredo curto demais não conta", () => {
    process.env.EARLY_ACCESS_HMAC_SECRET = "curto";
    expect(segredoConfigurado()).toBe(false);
  });
  it("⚠️⚠️ F-10: formato forte — base64 canônico, ≥ 32 bytes, não trivial", () => {
    expect(decodificarSegredo("a".repeat(32)), "a×32").toBeNull();                 // 24 bytes
    expect(decodificarSegredo("a".repeat(44)), "a×44").toBeNull();                 // 33 bytes, 3 valores
    expect(decodificarSegredo(Buffer.alloc(48, 7).toString("base64")), "zeros").toBeNull();
    expect(decodificarSegredo(randomBytes(16).toString("base64")), "curto").toBeNull();
    expect(decodificarSegredo("não-é-base64!!!!".repeat(4)), "invalido").toBeNull();
    expect(decodificarSegredo(randomBytes(48).toString("base64url")), "base64url").toBeNull();
    expect(decodificarSegredo(""), "vazio").toBeNull();
    expect(decodificarSegredo(undefined), "ausente").toBeNull();
    // não canônico: 32 bytes → 44 chars com 1 "=", e o último caractere útil
    // com os 2 bits de sobra ligados decodifica nos MESMOS bytes mas não volta igual
    const ALFA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const canon = randomBytes(32).toString("base64");
    const ult = ALFA.indexOf(canon[42]);
    const naoCanon = canon.slice(0, 42) + ALFA[ult | 1] + "=";
    expect(Buffer.from(naoCanon, "base64").equals(Buffer.from(canon, "base64"))).toBe(true);
    expect(decodificarSegredo(naoCanon), "nao canonico").toBeNull();
    const bom = randomBytes(48);
    expect(decodificarSegredo(bom.toString("base64"))?.equals(bom)).toBe(true);
    expect(decodificarSegredo(randomBytes(32).toString("base64"))).not.toBeNull();
  });
  it("o gate só conta o segredo forte", () => {
    process.env.EARLY_ACCESS_HMAC_SECRET = "a".repeat(64);
    expect(segredoConfigurado()).toBe(false);
    process.env.EARLY_ACCESS_HMAC_SECRET = SEGREDO_FALSO;
    expect(segredoConfigurado()).toBe(true);
  });
  it("determinístico, 32 hex, nunca contém o IP", () => {
    process.env.EARLY_ACCESS_HMAC_SECRET = SEGREDO_FALSO;
    const a = ipHmac("189.40.1.2");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(ipHmac("189.40.1.2")).toBe(a);
    expect(a).not.toContain("189");
  });
  it("⚠️ separação de domínio: o mesmo valor dá HMACs diferentes para ip e email", () => {
    process.env.EARLY_ACCESS_HMAC_SECRET = SEGREDO_FALSO;
    expect(ipHmac("x@y.co")).not.toBe(emailHmac("x@y.co"));
  });
  it("outro segredo → outro HMAC (não é SHA puro)", () => {
    process.env.EARLY_ACCESS_HMAC_SECRET = SEGREDO_FALSO;
    const a = ipHmac("1.1.1.1");
    process.env.EARLY_ACCESS_HMAC_SECRET = randomBytes(48).toString("base64");
    expect(ipHmac("1.1.1.1")).not.toBe(a);
  });
});

describe("⑤ códigos de indicação", () => {
  it("alfabeto Crockford, tamanho fixo, casa com o CHECK do banco", () => {
    expect(ALFABETO).toHaveLength(32);
    expect(ALFABETO).not.toMatch(/[ILOU]/);
    for (let i = 0; i < 500; i++) {
      const c = gerarCodigo();
      expect(c).toHaveLength(TAMANHO);
      expect(c).toMatch(REFERRAL_FORMATO);
    }
  });
  it("candidatos distintos (a RPC tenta em ordem quando colide)", () => {
    const c = gerarCandidatos(5);
    expect(new Set(c).size).toBe(5);
  });
  it("sem viés grosseiro: todos os 32 símbolos aparecem em 2000 códigos", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 2000; i++) for (const ch of gerarCodigo()) vistos.add(ch);
    expect(vistos.size).toBe(32);
  });
});

describe("⑥ lista de países", () => {
  it("249 códigos ISO 3166-1 alpha-2, únicos e no formato", () => {
    expect(PAISES_ISO).toHaveLength(249);
    expect(new Set(PAISES_ISO).size).toBe(249);
    for (const c of PAISES_ISO) expect(c).toMatch(/^[A-Z]{2}$/);
  });
});
