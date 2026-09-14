/**
 * ⚠️⚠️ TRÊS MUTAÇÕES APLICADAS E NUNCA JULGADAS — a mais velha havia 15 DIAS.
 *
 * ACHADO MEDINDO O CELEIRO a pedido do dono (14/09). A causa não era falta de
 * amostra: era a JANELA. `fluxosDesde(agora - 7 dias)` truncava o extrato, e o
 * julgamento então filtrava `>= aplicadaEm` — um filtro que DECLARA medir desde
 * a mutação sobre um conjunto que já tinha perdido tudo o que era mais velho
 * que 7 dias. O filtro virou no-op e o truncamento ficou invisível.
 *
 * Medido no banco, com a mutação aplicada em 30/08 e `MINIMO_POR_BRACO = 20`:
 *
 *     alavancado  controle: 10 na janela · 29 DESDE  → já dava para julgar
 *     cacador     controle:  5 na janela · 19 DESDE  → faltava UMA operação
 *     maker       controle:  0 na janela · 10 DESDE  → braço morto
 *
 * E o defeito piorava sozinho: quanto mais a mutação esperava, mais evidência
 * dela saía pela borda da janela.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { julgarMutacao, MINIMO_POR_BRACO } from "@/lib/celeiro/fluxo";
import { DIAS_ATE_MUTACAO_TRAVADA, JANELA_DE_ANALISE_MS } from "@/lib/celeiro/investigar";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const INVESTIGAR = semComentarios(readFileSync("src/lib/celeiro/investigar.ts", "utf8"));

describe("① a leitura do julgamento vai até a APLICAÇÃO, não só 7 dias", () => {
  it("⚠️⚠️ a janela recua até a mutação quando ela é mais velha", () => {
    expect(INVESTIGAR).toMatch(
      /Math\.min\(emCurso\.aplicadaEmMs, agoraMs - JANELA_DE_ANALISE_MS\)/);
    // A leitura fixa em 7 dias era o defeito.
    expect(INVESTIGAR).not.toMatch(
      /const fluxos: Fluxo\[\] = await fluxosDesde\(db, ag\.id, agoraMs - JANELA_DE_ANALISE_MS\)/);
  });

  it("⚠️ `Math.min`, não substituição: sem mutação a janela segue sendo a de 7 dias", () => {
    // O extrato que o MODELO enxerga ao propor é outra pergunta — sobre o
    // presente. Alargá-la junto mudaria o que ele lê para decidir.
    expect(JANELA_DE_ANALISE_MS).toBe(7 * 86_400_000);
    expect(INVESTIGAR).toMatch(/emCurso\?\.aplicadaEmMs != null[\s\S]{0,140}: agoraMs - JANELA_DE_ANALISE_MS/);
  });

  /**
   * A aritmética que prova o defeito: com o piso em 20, os números medidos
   * decidem ou não conforme a janela — e é só isso que mudou.
   */
  it("⚠️ os números medidos passam no piso pela leitura nova e falhavam pela velha", () => {
    expect(MINIMO_POR_BRACO).toBe(20);
    const alavancadoNaJanela = 10, alavancadoDesde = 29;
    expect(alavancadoNaJanela).toBeLessThan(MINIMO_POR_BRACO);   // ficava em "aguardar"
    expect(alavancadoDesde).toBeGreaterThanOrEqual(MINIMO_POR_BRACO); // agora julga
  });
});

describe("② esperar é legítimo; esperar para sempre, não", () => {
  it("⚠️⚠️ prazo E braço parado — as duas condições, nunca uma só", () => {
    expect(INVESTIGAR).toMatch(/diasEmCurso >= DIAS_ATE_MUTACAO_TRAVADA && fracoParado/);
    expect(DIAS_ATE_MUTACAO_TRAVADA).toBeGreaterThan(0);
  });

  it("⚠️ o braço parado é medido na janela RECENTE, não desde a aplicação", () => {
    // Desde a aplicação o braço quase sempre tem algo; o que denuncia o A/B
    // morto é ele não ter NADA agora.
    expect(INVESTIGAR).toMatch(/recentes = fluxos\.filter\(\(f\) => f\.ocorreuEmMs >= agoraMs - JANELA_DE_ANALISE_MS\)/);
    expect(INVESTIGAR).toMatch(/recentes\.filter\(\(f\) => f\.braco === "controle"\)\.length === 0/);
    expect(INVESTIGAR).toMatch(/recentes\.filter\(\(f\) => f\.braco === "mutacao"\)\.length === 0/);
  });

  it("⚠️ e o alarme sai de verdade, com dedup por agente", () => {
    expect(INVESTIGAR).toMatch(/notifyTelegram\(/);
    expect(INVESTIGAR).toMatch(/dedupKey: `celeiro:travada:\$\{ag\.id\}`/);
  });

  it("⚠️ `aguardar` continua NÃO fechando a mutação — o alarme não julga", () => {
    // Fechar por falta de tempo descartaria a hipótese por uma amostra que
    // ainda estava crescendo, e o modelo levaria a culpa.
    // ⚠️ O recorte vai até o `return` DO PRÓPRIO RAMO. A primeira versão pegava
    // 900 caracteres corridos e alcançava o caminho de baixo — que fecha a
    // mutação, e deve mesmo fechar. Trava mal recortada acusa código correto.
    const i = INVESTIGAR.indexOf('j.acao === "aguardar"');
    const ramo = INVESTIGAR.slice(i, INVESTIGAR.indexOf("return relato;", i));
    expect(ramo).not.toMatch(/fecharMutacao/);
    expect(ramo).toMatch(/notifyTelegram/);
  });
});

describe("③ o juiz em si não mudou — só o que chega até ele", () => {
  it("o piso por braço segue sendo o mesmo, e segue olhando o braço FRACO", () => {
    const fluxo = (braco: "controle" | "mutacao", n: number) =>
      Array.from({ length: n }, (_, i) => ({
        agente: "x", causa: "preco" as const, usdt: 1,
        ocorreuEmMs: i, braco, genomaVersao: 1, ref: `${braco}:${i}`,
      }));
    // 25 de um lado e 3 do outro não decide nada: o fraco manda.
    const j = julgarMutacao([...fluxo("mutacao", 25), ...fluxo("controle", 3)]);
    expect(j.acao).toBe("aguardar");
    expect(j.porque).toContain("braço fraco");
  });
});
