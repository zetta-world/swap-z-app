import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * O ESPELHO DO REGISTRO NÃO PODE CONGELAR.
 *
 * ⚠️ POR QUE ISTO É UM TESTE (09/08).
 *
 * `lab_strategies` é espelho de `registry.ts` — "código → banco, NUNCA o
 * contrário", como o cabeçalho da rota declara. O `GET` sincronizava só quando
 * a tabela estava VAZIA:
 *
 *     const rows = await readLab(db);
 *     if (rows.length === 0) { await syncRegistry(db); … }
 *
 * Parecia otimização. Era a invariante quebrada: o espelho travava na primeira
 * vez, e mudança em estratégia EXISTENTE nunca mais propagava.
 *
 * O estrago, medido no banco em 09/08: as 28 linhas com o MESMO `updated_at`
 * (08/08 20:36:27) — o instante em que `carteira_verde` nasceu e o `strategyId`
 * disparou um sync de carona. Depois disso, `carteira_verde` seguiu CINZA na
 * tela com o registro dizendo MORTA, e o `killedWhy` dela chegou com length
 * ZERO: a refutação inteira, invisível.
 *
 * ⚠️ E ISSO ERA A CAUSA DE UM DEFEITO QUE EU JÁ TINHA "CONSERTADO". Em 08/08
 * diagnostiquei as três verdes da Fase 4 aparecendo cinza como "esqueci de
 * promover no registro". Estava meio certo: eu esqueci, mas mesmo depois de
 * promover elas só chegaram ao banco por CARONA no sync acidental. Consertei o
 * sintoma e deixei a causa em pé por dois dias.
 *
 * A família de sempre — dois estados com a mesma aparência — na forma mais
 * cara: "reprovada com motivo escrito" e "nunca medida" ficam idênticas, e o
 * motivo escrito não existe para quem olha.
 */

/**
 * ⚠️ COMENTÁRIO NÃO É CÓDIGO, E A PRIMEIRA VERSÃO DESTE TESTE NÃO SABIA DISSO.
 *
 * Ele varria o arquivo cru — e o bloco que documenta a correção CITA o trecho
 * defeituoso (`if (rows.length === 0) … syncRegistry`). Resultado: os dois
 * testes reprovaram o código correto, apontando para a explicação do conserto.
 *
 * O inverso é pior e é o motivo de isto virar nota: um teste que lê comentário
 * como código também APROVA por comentário. Bastaria alguém descrever o
 * comportamento certo num bloco de texto para a trava ficar verde sobre um
 * código errado.
 */
function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")   // blocos
    .replace(/^\s*\/\/.*$/gm, " ");        // linhas
}

const src = semComentarios(readFileSync("src/app/admin/api/lab/route.ts", "utf8"));

describe("o GET do laboratório espelha o registro SEMPRE", () => {
  it("sincroniza antes de ler, sem condição", () => {
    // A ordem importa: sync e DEPOIS leitura, senão devolve o estado velho.
    const iSync = src.indexOf("await syncRegistry(db)");
    const iRead = src.indexOf("await readLab(db)");
    expect(iSync, "o GET não sincroniza").toBeGreaterThan(0);
    expect(iRead, "o GET não lê").toBeGreaterThan(0);
    expect(iSync, "sincronizou DEPOIS de ler — devolve o estado velho")
      .toBeLessThan(iRead);
  });

  /**
   * O guarda exato que causou o congelamento. Se alguém o reintroduzir por
   * economia, o espelho volta a travar e a tela volta a mentir.
   */
  it("NÃO volta o guarda de lista vazia", () => {
    expect(src, [
      "",
      "Voltou o `if (rows.length === 0) syncRegistry(...)`.",
      "Isso trava o espelho na primeira sincronização: mudança de status,",
      "hipótese ou killedWhy em estratégia EXISTENTE nunca mais chega à tela.",
      "Em 09/08 isso deixou `carteira_verde` como CINZA no painel com o",
      "registro dizendo MORTA, e o killedWhy dela com length ZERO.",
      "",
    ].join("\n")).not.toMatch(/rows\.length === 0[\s\S]{0,120}syncRegistry/);
  });

  it("o POST continua existindo como sincronização explícita", () => {
    expect(src).toMatch(/export async function POST/);
  });
});

/**
 * A DIREÇÃO DO ESPELHO, afirmada onde ela pode ser quebrada.
 *
 * `syncRegistry` faz upsert com `onConflict: "slug"` e escreve TODOS os campos
 * que a tela lê. Se algum sair da lista, ele passa a divergir em silêncio — que
 * é exatamente o defeito acima com outro nome.
 */
describe("o espelho carrega tudo que a tela mostra", () => {
  const store = semComentarios(readFileSync("src/lib/lab/store.ts", "utf8"));

  it("status, hipótese e motivo vão todos no upsert", () => {
    for (const campo of ["status", "hypothesis", "killed_why", "capital_required_usd", "subtitle"]) {
      expect(store, `\`${campo}\` fora do syncRegistry — vai divergir calado`)
        .toMatch(new RegExp(`${campo}:`));
    }
  });

  it("o upsert resolve por slug, não cria linha duplicada", () => {
    expect(store).toMatch(/onConflict:\s*"slug"/);
  });
});
