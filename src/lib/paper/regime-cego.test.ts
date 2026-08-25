import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { permiteEntrada } from "@/lib/paper/engine";

/**
 * ⚠️⚠️ O FILTRO CEGO — defeito meu de 23/08, apontado pela outra sessão.
 *
 * O filtro de regime falha ABERTO de propósito: sem sinal, a entrada passa,
 * para o filtro nunca ser o motivo de a mesa parar. A consequência é que uma
 * falha de leitura (rate-limit da corretora) faz TUDO passar sem ser julgado —
 * e o instrumento que mede o filtro ficava calado exatamente aí.
 *
 * Filtro funcionando sem nada para barrar e filtro CEGO produziam o mesmo
 * silêncio. É a invariante nº 33 dentro do próprio instrumento.
 */

const ENGINE = readFileSync(join(process.cwd(), "src/lib/paper/engine.ts"), "utf8");

describe("permiteEntrada — falha ABERTO, e é de propósito", () => {
  it("sem sinal, PASSA", () => {
    // Se falhasse fechado, uma queda da API da corretora pararia as mesas.
    expect(permiteEntrada(null)).toBe(true);
  });

  it("tendência positiva passa, não-positiva barra", () => {
    expect(permiteEntrada(1.5)).toBe(true);
    expect(permiteEntrada(0)).toBe(false);
    expect(permiteEntrada(-2)).toBe(false);
  });
});

describe("a cegueira do filtro tem de ser DITA", () => {
  it("existe a condição `cego` e ela entra no gatilho do evento", () => {
    // Sem ela, `bloqueados > 0 || ignorados > 0` nunca dispara quando tudo
    // volta `null` — que é exatamente o que o rate-limit produz.
    expect(ENGINE).toMatch(/const cego = regime\.porSimbolo\.size > 0 && semSinal === regime\.porSimbolo\.size/);
    expect(ENGINE).toMatch(/if \(bloqueadosPorRegime > 0 \|\| regime\.ignorados > 0 \|\| cego\)/);
  });

  it("⚠️ a cegueira exige ter avaliado algo — zero símbolos NÃO é cegueira", () => {
    // Tick sem sugestão de CEX avalia zero símbolos. Chamar isso de "filtro
    // cego" encheria o log de alarme falso, e alarme que toca à toa é alarme
    // que se aprende a ignorar.
    expect(ENGINE).toMatch(/porSimbolo\.size > 0 &&/);
  });

  it("as duas causas NÃO partilham a mesma frase", () => {
    // Uma diz que o filtro trabalhou; a outra que ele não enxergou nada. Se o
    // `why` fosse o mesmo, o log não distinguiria as duas — que é o defeito
    // original em outra roupa.
    expect(ENGINE).toMatch(/FILTRO CEGO — avaliou/);
    expect(ENGINE).toMatch(/entradas long barradas por tendência de 24h não positiva/);
    expect(ENGINE).toMatch(/why: cego\s*\n?\s*\?/);
  });

  it("a frase da cegueira diz o que ACONTECEU, não só que falhou", () => {
    // "tudo passou SEM ser julgado" é a consequência que o dono precisa ler —
    // saber que o filtro falhou sem saber que as entradas passaram assim mesmo
    // deixaria a pergunta mais importante sem resposta.
    expect(ENGINE).toMatch(/Tudo passou SEM ser julgado/);
  });
});
