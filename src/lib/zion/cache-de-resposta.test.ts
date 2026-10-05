/**
 * CE-07 — o cache exato do ZION: só público, só idêntico, só completo, e expira.
 */
import { describe, it, expect } from "vitest";
import { CacheDeResposta, chaveDeResposta, podeUsarCache, TTL_DO_CACHE_MS, type ArgsDoCache } from "@/lib/zion/cache-de-resposta";

const VARREDURA: ArgsDoCache = {
  op: "trading", fromAddr: "", toAddr: "", walletJson: "", txHistorySummary: "",
  balanceContext: "", positionsContext: "", autopilotMode: false,
};

describe("podeUsarCache: NADA do usuário pode estar no pedido", () => {
  it("varredura automática de trading/sniper/arbitrage entra", () => {
    for (const op of ["trading", "sniper", "arbitrage"] as const) expect(podeUsarCache({ ...VARREDURA, op })).toBe(true);
  });

  it("qualquer dado do usuário tira do cache", () => {
    expect(podeUsarCache({ ...VARREDURA, fromAddr: "0xabc" })).toBe(false);
    expect(podeUsarCache({ ...VARREDURA, toAddr: "0xabc" })).toBe(false);
    expect(podeUsarCache({ ...VARREDURA, walletJson: "{}" })).toBe(false);
    expect(podeUsarCache({ ...VARREDURA, txHistorySummary: "[1]" })).toBe(false);
    expect(podeUsarCache({ ...VARREDURA, balanceContext: "saldo" })).toBe(false);
    expect(podeUsarCache({ ...VARREDURA, positionsContext: "pos" })).toBe(false);
    expect(podeUsarCache({ ...VARREDURA, autopilotMode: true })).toBe(false);
  });

  it("modos que levam pergunta/par/estado do usuário nunca entram", () => {
    for (const op of ["pair", "ask", "futures", "accumulation", "research", "autopilot_cex"] as const) {
      expect(podeUsarCache({ ...VARREDURA, op })).toBe(false);
    }
  });
});

describe("chaveDeResposta: só prompt IDÊNTICO compartilha resposta", () => {
  it("muda com o modelo, o sistema ou a mensagem — e com a fronteira entre eles", () => {
    const base = chaveDeResposta("kimi", "SYS", "USER");
    expect(chaveDeResposta("kimi", "SYS", "USER")).toBe(base);
    expect(chaveDeResposta("kimi2", "SYS", "USER")).not.toBe(base);
    expect(chaveDeResposta("kimi", "SYS ", "USER")).not.toBe(base);
    expect(chaveDeResposta("kimi", "SYS", "USER.")).not.toBe(base);
    // "SY"+"SUSER" ≠ "SYS"+"USER": o separador impede a colisão por concatenação.
    expect(chaveDeResposta("kimi", "SY", "SUSER")).not.toBe(base);
  });
});

describe("CacheDeResposta", () => {
  it("lê o que gravou dentro do TTL e esquece depois", () => {
    const c = new CacheDeResposta();
    c.gravar("k", "resposta", 1_000);
    expect(c.ler("k", 1_000 + TTL_DO_CACHE_MS - 1)).toBe("resposta");
    expect(c.ler("k", 1_000 + TTL_DO_CACHE_MS)).toBeNull();
    expect(c.tamanho).toBe(0);
  });

  it("resposta vazia não é gravada (nada para servir)", () => {
    const c = new CacheDeResposta();
    c.gravar("k", "", 0);
    expect(c.ler("k", 1)).toBeNull();
  });

  it("tem teto de entradas (LRU): a mais antiga sai primeiro", () => {
    const c = new CacheDeResposta();
    for (let i = 0; i < 70; i++) c.gravar(`k${i}`, `r${i}`, 0);
    expect(c.tamanho).toBe(64);
    expect(c.ler("k0", 1)).toBeNull();
    expect(c.ler("k69", 1)).toBe("r69");
  });

  it("conta acertos e faltas — a métrica que diz se ele paga a si mesmo", () => {
    const c = new CacheDeResposta();
    c.ler("x", 0);
    c.gravar("x", "r", 0);
    c.ler("x", 1);
    expect({ acertos: c.acertos, faltas: c.faltas }).toEqual({ acertos: 1, faltas: 1 });
  });
});
