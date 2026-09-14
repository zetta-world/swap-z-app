/**
 * ⚠️⚠️ UM HONEYPOT CONFIRMADO NÃO BLOQUEAVA O SWAP — achado A27 da auditoria
 * externa (14/09).
 *
 * O bloqueio exige `category === "danger"` (token-safety.ts: `blocks = level
 * === "danger"`), e a categoria saía SÓ do score, com corte em 70. Nenhum sinal
 * de perigo chega a 70 sozinho:
 *
 *     GoPlus is_honeypot        60  →  "risky", passa
 *     Cannot sell all           50  →  "risky", passa
 *     Honeypot.is confirmado    50  →  "risky", passa
 *
 * `add("danger", …)` ROTULAVA o sinal como perigo e a categoria ignorava o
 * rótulo. O swap só era barrado por ACÚMULO acidental — um honeypot confirmado,
 * sozinho, pintava um aviso amarelo e o botão seguia clicável.
 *
 * ⚠️ E O ACHADO EXTERNO APONTOU O ARQUIVO ERRADO: mandava investigar
 * `src/lib/swap/token-safety.ts`, que está CORRETO — ele bloqueia fielmente
 * todo `category === "danger"`. O defeito estava em quem o ALIMENTA.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { osPioresPrimeiro, type Signal } from "@/lib/swap/sinais-de-risco";
import { assessTokenSafety } from "@/lib/swap/token-safety";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const RISK   = semComentarios(readFileSync("src/app/api/risk/route.ts", "utf8"));
const SAFETY = semComentarios(readFileSync("src/lib/swap/token-safety.ts", "utf8"));

describe("① os sinais de 'o dinheiro não volta' bloqueiam sozinhos", () => {
  it("⚠️⚠️ honeypot das DUAS fontes e `cannot_sell_all` são impeditivos", () => {
    expect(RISK).toMatch(/is_honeypot === "1"[\s\S]{0,90}60, true\)/);
    expect(RISK).toMatch(/cannot_sell_all === "1"[\s\S]{0,90}50, true\)/);
    expect(RISK).toMatch(/honeypotResult\?\.isHoneypot[\s\S]{0,140}50, true\)/);
  });

  it("⚠️⚠️ e um impeditivo manda MAIS que o score", () => {
    expect(RISK).toMatch(/const category = impedido \? "danger"/);
    // A régua antiga, sozinha, era o defeito.
    expect(RISK).not.toMatch(/const category = score >= 70 \? "danger"/);
  });

  it("o motivo do bloqueio viaja na resposta — 'bloqueado' sem porquê não ensina", () => {
    expect(RISK).toMatch(/impedidoPor: impedido/);
    // E chega até o cliente: ficar só dentro de `scoreRisk` não serve a ninguém.
    expect(RISK).toMatch(/score, category, signals, impedidoPor,/);
  });

  /**
   * ⚠️⚠️ ESTA É A TRAVA DO FIO, e ela é de LEITURA DE FONTE de propósito.
   *
   * `osPioresPrimeiro` tem teste que a EXECUTA (bloco ④). Mas uma função certa,
   * testada e DESLIGADA do caminho que decide é o padrão nº 8 desta casa — já
   * aconteceu oito vezes. Os testes de comportamento seguiriam verdes com a
   * rota devolvendo `signals` na ordem de avaliação.
   */
  it("⚠️⚠️ e a rota REALMENTE ordena antes de devolver", () => {
    expect(RISK).toMatch(/return \{ score, category, signals: osPioresPrimeiro\(signals\)/);
  });
});

describe("② e NÃO é 'todo sinal danger bloqueia'", () => {
  /**
   * ⚠️ Vários sinais `danger` são caros, não fatais: taxa de venda de 12%
   * (peso 30), dono oculto (20), top-10 com 55% (15). Bloquear todo swap de
   * token concentrado trocaria um defeito por outro — e ensinaria o usuário a
   * ignorar o bloqueio, que é como um aviso morre.
   */
  it("⚠️ taxa alta, dono oculto e concentração seguem SEM bloquear", () => {
    expect(RISK).toMatch(/sellTax > 0\.10\)\s*add\("danger", `Sell tax[^`]*`, 30\);/);
    expect(RISK).toMatch(/hidden_owner === "1"\)\s*add\("danger", "Hidden owner",\s*20\);/);
    expect(RISK).toMatch(/top10 > 0\.50\)\s*add\("danger", `Top-10 holders[^`]*`, 15\);/);
  });

  it("⚠️ `cannot_buy` fica de fora — ali reverte a transação, não prende o dinheiro", () => {
    // Perde-se o gás, não o principal. É prejuízo, não é o dinheiro preso.
    expect(RISK).toMatch(/cannot_buy === "1"\)\s*add\("danger", "Cannot buy",\s*50\);/);
  });
});

describe("③ o consumidor já estava certo — e continua", () => {
  it("token-safety bloqueia fielmente todo `danger`, como sempre fez", () => {
    expect(SAFETY).toMatch(/api\.category === "danger" \? "danger"/);
    expect(SAFETY).toMatch(/const blocks = level === "danger"/);
  });

  /**
   * A aritmética que prova o defeito: com o corte em 70, os pesos reais dos
   * três sinais fatais caíam todos em "risky".
   */
  it("⚠️ pela régua velha, os três fatais passariam — é o que mudou", () => {
    const categoriaVelha = (n: number) =>
      n >= 70 ? "danger" : n >= 40 ? "risky" : n >= 20 ? "caution" : "safe";
    expect(categoriaVelha(60)).toBe("risky");  // GoPlus honeypot
    expect(categoriaVelha(50)).toBe("risky");  // cannot_sell_all
    expect(categoriaVelha(50)).toBe("risky");  // Honeypot.is
    // E três avisos baratos somando 70 bloqueavam — a régua errada para a pergunta.
    expect(categoriaVelha(30 + 20 + 20)).toBe("danger");
  });
});

/**
 * ⚠️⚠️ A METADE QUE O ACHADO EXTERNO NÃO VIU: o bloqueio passou a existir, mas
 * dizia o motivo ERRADO.
 *
 * `token-safety.ts` corta os sinais em QUATRO e usa `signals[0]` como motivo.
 * A rota devolvia na ordem de AVALIAÇÃO, e o sinal do Honeypot.is é o ÚLTIMO a
 * ser empurrado — depois de até dezessete do GoPlus.
 */
const sinal = (kind: Signal["kind"], label: string, weight: number, imp?: true): Signal =>
  imp ? { kind, label, weight, impeditivo: imp } : { kind, label, weight };

describe("④ os piores primeiro — porque quem lê só vê quatro", () => {
  it("⚠️⚠️ o impeditivo vem na frente mesmo pesando MENOS", () => {
    // Exatamente o caso real: Honeypot.is (50, impeditivo) empurrado por
    // último, atrás de um sinal de peso maior que NÃO prende o dinheiro.
    const r = osPioresPrimeiro([
      sinal("danger", "Cannot buy", 50),
      sinal("danger", "Honeypot.is: sell fails", 50, true),
    ]);
    expect(r[0].label).toBe("Honeypot.is: sell fails");
  });

  it("⚠️⚠️ o caso que produzia um sinal VERDE como motivo de bloqueio", () => {
    // GoPlus acha o token limpo; só o Honeypot.is o condena. Antes, `signals[0]`
    // era "Top-10 holders 12.0%" — kind `ok` — e o cartão escrevia
    // "Token BLOQUEADO … : Top-10 holders 12.0%".
    const r = osPioresPrimeiro([
      sinal("ok", "Top-10 holders 12.0%", 0),
      sinal("ok", "LP locked 80.0%", 0),
      sinal("danger", "Honeypot.is: cannot sell", 50, true),
    ]);
    expect(r[0].kind).toBe("danger");
    expect(r[0].label).toBe("Honeypot.is: cannot sell");
  });

  it("⚠️ e sobrevive ao corte de quatro do consumidor", () => {
    const ruido = Array.from({ length: 17 }, (_, i) => sinal("warn", `ruído ${i}`, 10));
    const r = osPioresPrimeiro([...ruido, sinal("danger", "Cannot sell all", 50, true)]);
    expect(r.slice(0, 4)[0].label).toBe("Cannot sell all");
  });

  it("perigo antes de aviso, aviso antes de ok, e peso decide o empate", () => {
    const r = osPioresPrimeiro([
      sinal("ok", "LP locked", 0),
      sinal("warn", "Proxy contract", 10),
      sinal("danger", "Hidden owner", 20),
      sinal("warn", "Contract not open source", 15),
    ]);
    expect(r.map((x) => x.label)).toEqual([
      "Hidden owner", "Contract not open source", "Proxy contract", "LP locked",
    ]);
  });

  it("empate de tipo e peso PRESERVA a ordem de avaliação — sort estável", () => {
    const r = osPioresPrimeiro([
      sinal("warn", "primeiro", 10), sinal("warn", "segundo", 10), sinal("warn", "terceiro", 10),
    ]);
    expect(r.map((x) => x.label)).toEqual(["primeiro", "segundo", "terceiro"]);
  });

  it("não muda a lista original — a rota devolve a ordenada", () => {
    const original = [sinal("ok", "a", 0), sinal("danger", "b", 50, true)];
    osPioresPrimeiro(original);
    expect(original[0].label).toBe("a");
  });
});

/**
 * ⚠️⚠️ O BLOQUEIO TEM DUAS CAUSAS E DIZIA A MESMA FRASE.
 *
 * "você pode não conseguir vender o que comprar" é afirmação sobre o CONTRATO.
 * Vale para honeypot confirmado; NÃO vale para bloqueio por acúmulo, onde o
 * token vende normalmente e o que somou 70 foram sinais caros. Afirmar o
 * mecanismo errado é a mesma classe de defeito que o A27.
 */
describe("⑤ o bloqueio diz POR QUE bloqueou", () => {
  it("⚠️⚠️ impeditivo: a frase nomeia o sinal e afirma o mecanismo", () => {
    const a = assessTokenSafety({
      score: 50, category: "danger",
      signals: [{ label: "Top-10 holders 12.0%" }, { label: "Honeypot.is: cannot sell" }],
      impedidoPor: "Honeypot.is: cannot sell",
    });
    expect(a.blocks).toBe(true);
    expect(a.message).toContain("Honeypot.is: cannot sell");
    expect(a.message).toContain("não conseguir vender");
    // E NÃO cita o sinal verde que por acaso veio antes.
    expect(a.message).not.toContain("Top-10");
  });

  it("⚠️ acúmulo: NÃO afirma que o token não vende — porque ele vende", () => {
    const a = assessTokenSafety({
      score: 70, category: "danger",
      signals: [{ label: "Sell tax 12.0%" }, { label: "Hidden owner" }],
    });
    expect(a.blocks).toBe(true);
    expect(a.message).toContain("acúmulo");
    expect(a.message).not.toContain("não conseguir vender");
  });

  it("o resto das faixas segue intocado", () => {
    expect(assessTokenSafety({ score: 50, category: "risky", signals: [] }).blocks).toBe(false);
    expect(assessTokenSafety(null).level).toBe("unverified");
    expect(assessTokenSafety(null).blocks).toBe(false);
  });
});
