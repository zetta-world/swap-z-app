import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { AGENTES, ehRegua, oControle, agentePor } from "@/lib/celeiro/agentes";

/**
 * ⚠️⚠️ A RÉGUA DE DIREÇÃO FOI MUTADA (27/08), E O FILTRO ESTAVA "CERTO".
 *
 * O Investigador excluía da mutação quem tem `controle`, com o comentário certo
 * ao lado: *"um experimento cujo controle muda no meio não mede nada"*. Mas
 * `controle` marca o piso de RETORNO (Aluguel de Ocioso), e o piso de DIREÇÃO é
 * outra flag — `controleDeDirecao`, no Comprador Cego.
 *
 * O filtro olhava uma flag; o registro tinha duas. Em 27/08 14:01 o Cego levou
 * `alvoPct: 1 → 2`, julgado por um A/B que ainda tinha um braço só. A régua
 * contra a qual os agentes de sinal são medidos mudou de geometria no meio do
 * experimento.
 *
 * ⚠️ O DEFEITO NÃO ERA O `!`, ERA A PERGUNTA ESTAR ESPALHADA. Um `&&` no ponto
 * de uso teria consertado este caso e deixado o próximo em aberto.
 */

describe("⚠️ as DUAS réguas do Celeiro", () => {
  it("existem duas, e são agentes diferentes", () => {
    const retorno = AGENTES.filter((a) => a.controle === true);
    const direcao = AGENTES.filter((a) => a.controleDeDirecao === true);
    expect(retorno).toHaveLength(1);
    expect(direcao).toHaveLength(1);
    expect(retorno[0].id).not.toBe(direcao[0].id);
  });

  it("⚠️⚠️ `ehRegua` reconhece as duas — era isto que faltava", () => {
    expect(ehRegua(oControle())).toBe(true);
    expect(ehRegua(agentePor("comprador_cego")!)).toBe(true);
  });

  it("⚠️ o filtro antigo (`!a.controle`) deixaria o Cego passar", () => {
    // A prova de que o defeito era real, escrita como o filtro antigo era.
    const cego = agentePor("comprador_cego")!;
    expect(!cego.controle).toBe(true);      // ← passava
    expect(ehRegua(cego)).toBe(true);       // ← agora não passa
  });

  it("quem NÃO é régua segue investigável", () => {
    for (const id of ["alavancado_de_tendencia", "cacador_de_tendencia", "pool_novo", "colheita_funding"]) {
      expect(ehRegua(agentePor(id)!), id).toBe(false);
    }
  });

  it("⚠️ nenhum agente novo entra sem responder à pergunta", () => {
    // Régua é decisão explícita: quem não declara nenhuma das duas flags é
    // investigável, e isso tem de ser escolha, não descuido.
    const reguas = AGENTES.filter(ehRegua);
    expect(reguas.map((a) => a.id).sort()).toEqual(["aluguel_ocioso", "comprador_cego"]);
  });
});

describe("o Investigador pergunta pela função, não pela flag solta", () => {
  const fonte = readFileSync("src/lib/celeiro/investigar.ts", "utf8");

  it("⚠️ o filtro usa `ehRegua`", () => {
    expect(fonte).toMatch(/AGENTES\.filter\(\(a\) => !ehRegua\(a\)\)/);
  });

  it("⚠️ e NÃO voltou a olhar uma flag só", () => {
    expect(fonte).not.toMatch(/filter\(\(a\) => !a\.controle\)/);
  });
});
