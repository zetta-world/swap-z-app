/**
 * ⚠️⚠️ O OBSERVADOR DE ORDENS USAVA CONDIÇÃO E PREÇO INCORRETOS.
 * Achado A22 — e são QUATRO defeitos no mesmo trecho, dois deles trocando o
 * resultado de lado.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  direcaoDoGatilho, simboloVigiado, lerPrecoDoGatilho, gatilhoAtingido,
} from "./gatilho";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const WATCH = semComentarios(readFileSync(join(process.cwd(), "src/lib/hooks/useOrderWatcher.ts"), "utf8"));

describe("① a compra vigia o token, não a moeda com que se paga", () => {
  it("⚠️⚠️ compra → `to`; venda → `from`", () => {
    const compra = { kind: "buy_limit", from: { symbol: "USDC" }, to: { symbol: "WETH" } };
    const venda  = { kind: "sell_safe", from: { symbol: "WETH" }, to: { symbol: "USDC" } };
    expect(simboloVigiado(compra)).toBe("WETH");
    expect(simboloVigiado(venda)).toBe("WETH");
  });

  it("⚠️⚠️ a aritmética do defeito: vigiando o USDC, o gatilho nunca ou sempre", () => {
    // Era o preço do `from` que chegava aqui. USDC ≈ 1,00.
    const precoDoUsdc = 1;
    // Token que se quer comprar a 0,85 → nunca dispara.
    expect(gatilhoAtingido("compra", precoDoUsdc, 0.85)).toBe(false);
    // ETH que se quer comprar a 2500 → dispara na PRIMEIRA sondagem.
    expect(gatilhoAtingido("compra", precoDoUsdc, 2500)).toBe(true);
  });

  it("os três `kind` de compra vigiam o `to`", () => {
    for (const kind of ["buy_limit", "sniper_watch", "limit"]) {
      expect(simboloVigiado({ kind, from: { symbol: "USDC" }, to: { symbol: "PEPE" } }), kind).toBe("PEPE");
    }
  });
});

describe("② o stop_loss olha para baixo", () => {
  it("⚠️⚠️ `stop_loss` dispara na QUEDA, não na subida", () => {
    expect(direcaoDoGatilho("stop_loss")).toBe("venda_stop");
    expect(gatilhoAtingido("venda_stop", 90, 100)).toBe(true);   // caiu até o stop
    expect(gatilhoAtingido("venda_stop", 110, 100)).toBe(false); // subiu: não é stop
  });

  it("⚠️ e a venda de REALIZAÇÃO continua olhando para cima", () => {
    for (const k of ["sell_safe", "sell_medium", "sell_aggressive"]) {
      expect(direcaoDoGatilho(k), k).toBe("venda_alvo");
    }
    expect(gatilhoAtingido("venda_alvo", 110, 100)).toBe(true);
    expect(gatilhoAtingido("venda_alvo", 90, 100)).toBe(false);
  });

  it("⚠️⚠️ os dois tipos de venda NÃO compartilham mais o mesmo ramo", () => {
    // Era o defeito: `stop_loss` caía junto com as realizações.
    const caiu = 90, alvo = 100;
    expect(gatilhoAtingido("venda_stop", caiu, alvo)).not.toBe(gatilhoAtingido("venda_alvo", caiu, alvo));
  });
});

describe("③ o preço é lido, não raspado", () => {
  it("⚠️⚠️ notação científica sobrevive — `1e-5` era virado em `15`", () => {
    // `replace(/[^0-9.]/g, "")` apagava o `e` e o `-`: um gatilho de 0,00001
    // lido como QUINZE, um milhão e meio de vezes maior.
    expect(lerPrecoDoGatilho("1e-5")).toBe(0.00001);
    expect(lerPrecoDoGatilho("2.5E-7")).toBe(2.5e-7);
  });

  it("separador de milhar e símbolo de moeda saem", () => {
    expect(lerPrecoDoGatilho("$1,234.56")).toBe(1234.56);
    expect(lerPrecoDoGatilho("0.85 USDC")).toBe(0.85);
  });

  it("⚠️ vírgula ambígua devolve `null`, não um dos dois palpites", () => {
    // "1,5" é 1,5 ou 15? Ambíguo em PREÇO não vira chute.
    expect(lerPrecoDoGatilho("1,5")).toBeNull();
  });

  it("⚠️ entrada inválida devolve `null` — e `null` não dispara", () => {
    for (const ruim of [null, undefined, "", "abc", "0", "-3", 42]) {
      expect(lerPrecoDoGatilho(ruim), String(ruim)).toBeNull();
    }
  });
});

describe("④ kind desconhecido não dispara", () => {
  it("⚠️⚠️ `null`, e não semântica de venda por omissão", () => {
    // A união de `kind` termina em `(string & {})`: o modelo pode inventar um
    // nome, e o `else` mudo dava a ele o comportamento de venda.
    for (const inventado of ["moon_now", "swap", "dca", ""]) {
      expect(direcaoDoGatilho(inventado), inventado).toBeNull();
    }
    expect(simboloVigiado({ kind: "moon_now", from: { symbol: "A" }, to: { symbol: "B" } })).toBeNull();
  });

  it("preço ou atual inválidos nunca disparam", () => {
    expect(gatilhoAtingido("compra", NaN, 1)).toBe(false);
    expect(gatilhoAtingido("compra", 1, 0)).toBe(false);
    expect(gatilhoAtingido("venda_alvo", -1, 1)).toBe(false);
  });
});

/**
 * ⚠️⚠️ TRAVA DO FIO — as funções acima têm teste que as EXECUTA, e seguiriam
 * verdes com o observador decidindo tudo sozinho como antes.
 */
describe("⑤ e o observador REALMENTE usa as quatro", () => {
  it("⚠️⚠️ a busca de preço usa o símbolo VIGIADO, não o `from`", () => {
    expect(WATCH).toMatch(/const sym\s+= simboloVigiado\(o\.card\)/);
    expect(WATCH).not.toMatch(/o\.card\.from\?\.symbol \?\? o\.card\.to\?\.symbol/);
  });

  it("⚠️⚠️ e o `checkTrigger` delega direção, preço e comparação", () => {
    expect(WATCH).toMatch(/const direcao = direcaoDoGatilho\(o\.card\.kind\)/);
    expect(WATCH).toMatch(/if \(!direcao\) return false/);
    expect(WATCH).toMatch(/const gatilho = lerPrecoDoGatilho\(o\.card\.triggerPrice\)/);
    expect(WATCH).toMatch(/return gatilhoAtingido\(direcao, current, gatilho\)/);
  });

  it("⚠️ a raspagem de caracteres e o `isBuy` inline sumiram", () => {
    expect(WATCH).not.toMatch(/replace\(\/\[\^0-9\.\]\/g/);
    expect(WATCH).not.toMatch(/const isBuy =/);
    expect(WATCH).not.toMatch(/current >= trigger/);
  });
});
