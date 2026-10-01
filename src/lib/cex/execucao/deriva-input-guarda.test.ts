/**
 * ⚠️⚠️ §44 — GUARDA ESTRUTURAL DO A125: as duas semânticas não se reencontram.
 *
 * O defeito do A125 era um campo genérico `trades` servindo dois senhores:
 * o settlement (que precisa SÓ dos trades da ordem) e a deriva (que precisa
 * do histórico ACCOUNT-WIDE). O conserto separou os nomes; esta guarda trava
 * a separação no fonte, com âncoras — não regex solta:
 *
 *   (a) `LeituraDaOrdem` NÃO expõe campo `trades` e expõe `tradesDaOrdem` +
 *       `historico`;
 *   (b) `ingerirTrades(` no reconciliador recebe o que deriva de
 *       `tradesDaOrdem` — NUNCA de `historico`;
 *   (c) a deriva recebe `leitura.historico` — nunca o array filtrado.
 *
 * O lado comportamental destas travas está em venue-leitura-pipeline.test.ts
 * (que pega os breaks §41/§42 de verdade). Esta guarda existe para a versão
 * do defeito que volta SEM mudar comportamento: um rename, um alias, um
 * campo ambíguo reintroduzido.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const LEITURA = readFileSync("src/lib/cex/execucao/venue-leitura.ts", "utf8");
const RECONC = readFileSync("src/lib/cex/execucao/reconciliador.ts", "utf8");

/** O corpo do tipo `LeituraDaOrdem` — da declaração ao fim da união. */
function blocoDoTipo(fonte: string, nome: string): string {
  const i = fonte.indexOf(`export type ${nome}`);
  expect(i, `${nome} existe`).toBeGreaterThan(-1);
  // O último membro da união é a âncora do fim (o tipo fecha na mesma linha).
  const ultimo = fonte.indexOf('tipo: "indeterminado"', i);
  expect(ultimo, "a união termina no membro indeterminado").toBeGreaterThan(i);
  const fim = fonte.indexOf("\n", ultimo);
  expect(fim).toBeGreaterThan(ultimo);
  return fonte.slice(i, fim);
}

describe("§44a — LeituraDaOrdem: sem campo genérico `trades`, com os dois nomes distintos", () => {
  const BLOCO = blocoDoTipo(LEITURA, "LeituraDaOrdem");

  it("⚠️⚠️ NÃO há campo `trades` no contrato (o rename é a trava — §36)", () => {
    // `\btrades\b` não casa dentro de `tradesDaOrdem` (sem fronteira entre
    // 's' e 'D') — o que esta asserção proíbe é o campo AMBÍGUO de antes.
    expect(BLOCO).not.toMatch(/\btrades\s*:/);
    expect(BLOCO).not.toMatch(/\btrades\s*[?]\s*:/);
  });

  it("⚠️⚠️ expõe `tradesDaOrdem` E `historico` nos caminhos com trades", () => {
    const achada = BLOCO.indexOf('"achada"');
    const soTrades = BLOCO.indexOf('"so_trades"');
    expect(achada).toBeGreaterThan(-1);
    expect(soTrades).toBeGreaterThan(achada);
    for (const trecho of [BLOCO.slice(achada, soTrades), BLOCO.slice(soTrades)]) {
      expect(trecho).toMatch(/\btradesDaOrdem:\s*TradeDaVenue\[\]/);
      expect(trecho).toMatch(/\bhistorico:\s*HistoricoDoSimbolo \| null/);
    }
  });

  it("⚠️ o histórico declara a flag de completude (§13B) e os trades account-wide", () => {
    const i = LEITURA.indexOf("export interface HistoricoDoSimbolo");
    expect(i).toBeGreaterThan(-1);
    const fim = LEITURA.indexOf("}", i);
    const bloco = LEITURA.slice(i, fim);
    expect(bloco).toMatch(/\btrades:\s*TradeDaVenue\[\]/);
    expect(bloco).toMatch(/\bpossivelmenteIncompleto:\s*boolean/);
  });
});

describe("§44b — reconciliador.ts: ingerirTrades NUNCA recebe nada derivado de `historico`", () => {
  it("⚠️⚠️ o settlement é alimentado por `leitura.tradesDaOrdem`", () => {
    expect(RECONC).toMatch(/const trades = leitura\.tradesDaOrdem;/);
    expect(RECONC).toMatch(/ingerirTrades\(db, intent\.id, idOrdem, trades\.map\(/);
  });

  it("⚠️⚠️ nenhuma chamada a ingerirTrades toca `historico`", () => {
    const chamadas = RECONC.matchAll(/ingerirTrades\(/g);
    let contadas = 0;
    for (const m of chamadas) {
      contadas++;
      // O trecho da chamada até o seu fechamento não pode mencionar o
      // histórico account-wide — settlement e deriva não se misturam.
      const trecho = RECONC.slice(m.index, m.index! + 400);
      const fim = trecho.indexOf("})))");
      expect(fim, "chamada de ingerirTrades localizável").toBeGreaterThan(-1);
      expect(trecho.slice(0, fim)).not.toMatch(/\bhistorico\b/);
    }
    expect(contadas, "a guarda achou a chamada real").toBeGreaterThanOrEqual(1);
  });

  it("⚠️⚠️ a DERIVA recebe `leitura.historico` — e o campo ambíguo não voltou", () => {
    expect(RECONC).toMatch(/conferirDeriva\(db, intent, leitura\.historico, idDescoberto\)/);
    // `leitura.trades` solto (sem sufixo) é a assinatura do defeito antigo.
    expect(RECONC).not.toMatch(/leitura\.trades\b(?!DaOrdem)/);
  });
});
