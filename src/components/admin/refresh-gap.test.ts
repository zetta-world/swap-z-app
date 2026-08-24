/**
 * O ESTRANGULAMENTO DA ATUALIZAÇÃO — a decisão pura de dentro do hook.
 *
 * ⚠️ `recordEvent` emite um ping a CADA evento do flywheel, e só o radar bate
 * uma vez por minuto. Um tick que grava seis eventos seguidos dispararia seis
 * buscas no mesmo segundo — seis vezes o custo para seis vezes a mesma tela.
 *
 * O resto do hook é fiação de DOM (relógio, visibilidade, foco) e não tem o que
 * afirmar sem navegador. Esta é a parte que decide, e ela é testável.
 */

import { describe, it, expect } from "vitest";
import { devoRodar } from "@/components/admin/refresh-gap";

const GAP = 15_000;

describe("devoRodar", () => {
  it("na primeira vez sempre roda", () => {
    expect(devoRodar(1_000, 0, GAP)).toBe(true);
  });

  it("segura a rajada dentro da janela", () => {
    expect(devoRodar(100_000, 95_000, GAP)).toBe(false);
    expect(devoRodar(100_000, 99_900, GAP)).toBe(false);
  });

  it("solta assim que a janela fecha", () => {
    expect(devoRodar(100_000, 85_000, GAP)).toBe(true);
    expect(devoRodar(100_000, 84_000, GAP)).toBe(true);
  });

  it("na borda exata, roda — o gap é mínimo, não exclusivo", () => {
    expect(devoRodar(100_000, 100_000 - GAP, GAP)).toBe(true);
  });

  /**
   * ⚠️ ESTE É O CASO DO CELULAR. Quem tira o telefone do bolso quer ver o
   * AGORA, não o de quando guardou. O retorno à aba força, e forçar ignora o
   * estrangulamento de propósito — senão a primeira tela depois de uma viagem
   * de metrô seria a mesma que ele deixou.
   */
  it("forçado atravessa o estrangulamento", () => {
    expect(devoRodar(100_000, 99_999, GAP, true)).toBe(true);
    expect(devoRodar(0, 0, GAP, true)).toBe(true);
  });

  it("gap zero nunca estrangula", () => {
    expect(devoRodar(100_000, 100_000, 0)).toBe(true);
  });
});
