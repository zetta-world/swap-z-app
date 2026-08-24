import { describe, it, expect } from "vitest";
import { naoRefletidos, deveRefletir, parseLessons, lessonsBlock } from "@/lib/zion/retro";

describe("Auto-Retro — reflection loop plumbing", () => {
  const H = 3_600_000;

  it("naoRefletidos: conta os resolvidos DEPOIS da última reflexão", () => {
    const t0 = Date.parse("2026-08-16T00:00:00Z");
    const trades = [t0 - 5 * H, t0 - 1 * H, t0 + 1 * H, t0 + 5 * H];
    expect(naoRefletidos(trades, t0)).toBe(2);
    // Nunca refletiu: todo decidido é novo.
    expect(naoRefletidos(trades, null)).toBe(4);
    // Refletiu depois do último: nada novo.
    expect(naoRefletidos(trades, t0 + 10 * H)).toBe(0);
    // ⚠️ FRONTEIRA: resolvido no INSTANTE da reflexão já entrou nela. `>=`
    // aqui refletiria o mesmo trade duas vezes, para sempre, a cada varredura.
    expect(naoRefletidos([t0], t0)).toBe(0);
  });

  it("naoRefletidos: um resolved_at ilegível conta como NOVO, nunca some", () => {
    const t0 = Date.parse("2026-08-16T00:00:00Z");
    // Date.parse("") é NaN — o caminho real quando `resolved_at` vem null.
    expect(naoRefletidos([NaN, t0 - H], t0)).toBe(1);
    expect(naoRefletidos([NaN, NaN], t0)).toBe(2);
  });

  it("deveRefletir: dispara a partir de everyN não refletidos", () => {
    expect(deveRefletir(10, 10)).toBe(true);
    expect(deveRefletir(9, 10)).toBe(false);
    expect(deveRefletir(0, 10)).toBe(false);
  });

  /**
   * ⚠️ O CASO QUE MATOU O VOLANTE POR 20 DIAS — em forma de teste.
   *
   * O gatilho antigo era `decididosAgora − marco >= N`. Arquivar a rodada
   * zerou o numerador e deixou o marco lá em cima (radar: marco 23, vivos 5),
   * o que dava −18 e NUNCA mais disparava. Com contagem de não-refletidos, os
   * cinco trades novos do radar são cinco trades novos, e assim que chegarem a
   * dez a reflexão volta a acontecer.
   */
  it("regressão: arquivar a rodada não pode congelar o gatilho para sempre", () => {
    const retro = Date.parse("2026-07-25T00:00:00Z");
    // Os 23 que existiam quando o marco foi gravado — hoje arquivados e fora
    // da consulta. Sobraram 5, todos resolvidos DEPOIS da reflexão.
    const vivos = [1, 2, 3, 4, 5].map((d) => retro + d * 24 * H);
    const marcoAntigo = (agora: number, marco: number) => agora - marco >= 10;

    expect(marcoAntigo(vivos.length, 23)).toBe(false);        // o defeito
    expect(naoRefletidos(vivos, retro)).toBe(5);              // a verdade
    expect(deveRefletir(naoRefletidos(vivos, retro), 10)).toBe(false); // 5 < 10, ainda não
    // ...e com mais cinco, dispara — que é o que o gatilho antigo não fazia
    // nem com mil.
    const maisCinco = [...vivos, ...[6, 7, 8, 9, 10].map((d) => retro + d * 24 * H)];
    expect(marcoAntigo(maisCinco.length, 23)).toBe(false);    // 10 − 23 = −13
    expect(deveRefletir(naoRefletidos(maisCinco, retro), 10)).toBe(true);
  });

  it("parseLessons: direct JSON, embedded JSON, caps and truncation", () => {
    expect(parseLessons('{"lessons":["a","b"]}')).toEqual(["a", "b"]);
    expect(parseLessons('Here you go:\n{"lessons":["only one"]}\nthanks')).toEqual(["only one"]);
    expect(parseLessons('{"lessons":["1","2","3","4","5"]}')).toHaveLength(3); // cap
    const long = parseLessons(`{"lessons":["${"x".repeat(500)}"]}`)[0];
    // 400, not 220: the first retro round proved 220 severs the prescription
    // ("...require a s") while keeping only the diagnosis.
    expect(long.length).toBe(400);
    // A real lesson from the 26/07 round must now survive intact.
    const real = "Counter-trend SELL entries in TRANSITIONING regimes (SOL, OP) consistently hit stops within 1-5h — avoid selling strength in ambiguous regimes unless there is a confirmed lower high or breakdown structure.";
    expect(parseLessons(JSON.stringify({ lessons: [real] }))[0]).toBe(real);
  });

  it("parseLessons: junk in, empty out (never throws into the cron)", () => {
    expect(parseLessons("no json here")).toEqual([]);
    expect(parseLessons('{"lessons": "not-an-array"}')).toEqual([]);
    expect(parseLessons("")).toEqual([]);
  });

  it("lessonsBlock: renders context-not-permission framing, empty when no lessons", () => {
    expect(lessonsBlock(undefined)).toBe("");
    expect(lessonsBlock([])).toBe("");
    const block = lessonsBlock(["counter-trend buys in RANGING all stopped"]);
    expect(block).toContain("<your_lessons>");
    expect(block).toContain("never override the desk's hard rules");
    expect(block).toContain("1. counter-trend buys in RANGING all stopped");
  });
});
