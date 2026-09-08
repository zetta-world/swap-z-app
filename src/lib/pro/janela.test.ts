/**
 * ⚠️⚠️ "24h" SOBRE QUATRO HORAS.
 *
 * 250 velas de 1 minuto são 4,2 horas. O cabeçalho do terminal chamava isso de
 * variação de 24h e de "Vol 24h" — e quem opera lê esses dois números antes de
 * mandar ordem.
 */
import { describe, it, expect } from "vitest";
import { janelaDoCabecalho, rotuloDaJanela } from "@/lib/pro/janela";
import type { Candle } from "@/lib/api/geckoterminal";

const T0 = 1_757_000_000; // segundos

function velas(n: number, passoSeg: number, preco = (i: number) => 100 + i): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: T0 + i * passoSeg,
    open: preco(i), high: preco(i) + 1, low: preco(i) - 1, close: preco(i),
    volume: 10,
  }));
}

describe("janelaDoCabecalho", () => {
  it("250 velas de 1m são 4,2h — e a janela DIZ isso, não '24h'", () => {
    const j = janelaDoCabecalho(velas(250, 60), "1m");
    expect(j.cobre24h).toBe(false);
    expect(j.horasCobertas).toBeCloseTo(250 / 60, 1);
    expect(rotuloDaJanela(j)).toBe("4,2h");
  });

  it("o timeframe PADRÃO (5m) também não cobre 24h — 20,8h", () => {
    const j = janelaDoCabecalho(velas(250, 300), "5m");
    expect(j.cobre24h).toBe(false);
    expect(j.horasCobertas).toBeCloseTo(20.8, 1);
    expect(rotuloDaJanela(j)).toBe("21h");
  });

  it("a partir de 15m sobra janela, e aí o rótulo '24h' é verdade", () => {
    const j = janelaDoCabecalho(velas(250, 900), "15m");
    expect(j.cobre24h).toBe(true);
    expect(rotuloDaJanela(j)).toBe("24h");
  });

  it("⚠️ cobrindo 24h, o volume soma SÓ as últimas 24h — não os 62h em mãos", () => {
    // 250 velas de 15m = 62,5h, volume 10 cada. Só 96 velas cabem em 24h.
    const j = janelaDoCabecalho(velas(250, 900), "15m");
    expect(j.volume).toBe(96 * 10);
    // Sem o corte seriam 2.500 — o defeito antigo, sob o rótulo "Vol 24h".
    expect(j.volume).not.toBe(250 * 10);
  });

  it("⚠️ NÃO cobrindo 24h, soma tudo — mas o rótulo deixa de dizer 24h", () => {
    const j = janelaDoCabecalho(velas(250, 60), "1m");
    expect(j.volume).toBe(250 * 10);
    expect(rotuloDaJanela(j)).not.toBe("24h");
  });

  it("a variação vem da vela de 24h atrás quando ela existe", () => {
    // 15m: a vela de 24h atrás é a de índice 250-1-96 = 153, com close 253.
    const j = janelaDoCabecalho(velas(250, 900), "15m");
    expect(j.referencia).toBe(100 + 153);
    expect(j.variacaoPct).toBeCloseTo(((349 - 253) / 253) * 100, 6);
  });

  it("uma vela só não 'cobre zero' — a janela vai até o FECHAMENTO dela", () => {
    const j = janelaDoCabecalho(velas(1, 86_400), "1d");
    expect(j.horasCobertas).toBe(24);
    expect(j.cobre24h).toBe(true);
  });

  it("sem vela nenhuma, tudo `null` — e `null` não é zero", () => {
    const j = janelaDoCabecalho([], "5m");
    expect(j.horasCobertas).toBeNull();
    expect(j.volume).toBeNull();
    expect(j.variacaoPct).toBeNull();   // 0% diria "não mudou"
    expect(rotuloDaJanela(j)).toBe("—");
  });

  it("referência zero não vira divisão — `null`, nunca 0%", () => {
    const j = janelaDoCabecalho(velas(3, 900, () => 0), "15m");
    expect(j.variacaoPct).toBeNull();
  });
});
