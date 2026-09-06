/**
 * ⚠️⚠️ O QUE ESTE ARQUIVO PERSEGUE É O LOOKAHEAD, de novo — e aqui ele é mais
 * perigoso que no motor simples.
 *
 * O motor do cliente lê uma média sobre fechamentos; se ele espiar o futuro, o
 * defeito aparece num teste pequeno. Aqui cada barra recalcula RSI, EMA, MACD,
 * ATR, ADX e OBV sobre a fatia até ela — e basta UMA fatia larga demais para a
 * mesa inteira passar a "acertar" com um pedaço do futuro na mão. O número
 * sairia bonito, plausível, e com o nome da FREYJA em cima.
 */
import { describe, it, expect, vi } from "vitest";
import { rodarMesa, agregar, MAX_BARRAS_AVALIADAS, type VelasDaMesa } from "@/lib/bancada/mesa-real";
import type { VelaComTempo } from "@/lib/mercado/velas";

const H = 3_600_000;

/** Série de 1h com preço dado por `f`. */
function serie(n: number, f: (i: number) => number, passo = H): VelaComTempo[] {
  return Array.from({ length: n }, (_, i) => {
    const c = f(i);
    return { t: i * passo, close: c, high: c * 1.004, low: c * 0.996, volume: 100 + i };
  });
}

function velas(n: number, f: (i: number) => number): VelasDaMesa {
  return {
    h1: serie(n, f),
    h4: serie(Math.ceil(n / 4), (i) => f(i * 4), 4 * H),
    d1: serie(Math.ceil(n / 24), (i) => f(i * 24), 24 * H),
    w1: serie(Math.ceil(n / 168), (i) => f(i * 168), 168 * H),
  };
}

describe("⚠️⚠️ nenhuma decisão enxerga o futuro", () => {
  it("o que acontece DEPOIS da barra não muda a decisão DELA", () => {
    // Duas séries idênticas até a barra 600 e radicalmente diferentes depois.
    // Se alguma decisão tomada antes de 600 mudar, alguma fatia vazou futuro.
    const comum = (i: number) => 100 + Math.sin(i / 9) * 6 + i * 0.02;
    const a = velas(900, comum);
    const b = velas(900, (i) => (i <= 600 ? comum(i) : comum(600) * 3));

    const ra = rodarMesa(a, "BTC", 0.40);
    const rb = rodarMesa(b, "BTC", 0.40);

    const antesDeA = ra.operacoes.filter((o) => o.abriuEm < 600 * H).map((o) => `${o.abriuEm}:${o.entrada.toFixed(4)}`);
    const antesDeB = rb.operacoes.filter((o) => o.abriuEm < 600 * H).map((o) => `${o.abriuEm}:${o.entrada.toFixed(4)}`);
    expect(antesDeB).toEqual(antesDeA);
  });

  it("⚠️ os indicadores são calculados sobre a fatia ATÉ a barra, nunca além", async () => {
    // Trava direta na chamada: nenhuma fatia pode conter vela posterior à barra
    // que está decidindo. Um `slice` trocado por engano passa despercebido no
    // resultado e é pego aqui.
    const mod = await import("@/lib/api/market-indicators");
    const original = mod.computeIndicators;
    const chamadas: Array<{ ultimo: number }> = [];
    const espiao = vi.spyOn(mod, "computeIndicators").mockImplementation((sim, c1h, c4h, c1d, c1w) => {
      chamadas.push({ ultimo: c1h.length });
      return original(sim, c1h, c4h, c1d, c1w);
    });

    const v = velas(420, (i) => 100 + i * 0.05);
    rodarMesa(v, "BTC", 0.40);

    // ⚠️ SEM ISTO O TESTE SERIA VAZIO. Um espião que não intercepta deixa
    // `chamadas` vazia, e o laço abaixo passa sem verificar nada — a armadilha
    // exata que esta base já pegou quatro vezes este mês.
    expect(chamadas.length).toBeGreaterThan(100);

    // A fatia da barra `i` tem exatamente `i + 1` velas — nunca mais.
    let esperado = 201;   // BARRAS_DE_AQUECIMENTO + 1
    for (const c of chamadas) {
      expect(c.ultimo).toBe(esperado);
      esperado++;
    }
    espiao.mockRestore();
  });
});

describe("o teto de barras é DECLARADO, nunca silencioso", () => {
  it("janela dentro do teto não é cortada", () => {
    const r = rodarMesa(velas(400, (i) => 100 + i * 0.03), "BTC", 0.40);
    expect(r.cortadaPeloTeto).toBe(false);
    expect(r.barrasAvaliadas).toBe(200);   // 400 − aquecimento
  });

  it("⚠️ janela acima do teto é cortada E o avisa", () => {
    // "Sem teto silencioso" é regra da casa: um corte que não se anuncia
    // lê-se como cobertura total.
    const n = 200 + MAX_BARRAS_AVALIADAS + 500;
    const r = rodarMesa(velas(n, (i) => 100 + Math.sin(i / 40) * 3), "BTC", 0.40);
    expect(r.cortadaPeloTeto).toBe(true);
    expect(r.barrasAvaliadas).toBe(MAX_BARRAS_AVALIADAS);
  });
});

describe("a mesa parada é distinguível da mesa quebrada", () => {
  it("⚠️ quando não abre, o MOTIVO é contado", () => {
    // Série plana: nenhum playbook encontra setup. Sem esta contagem, uma mesa
    // parada e uma mesa com defeito produzem exatamente a mesma saída — que é o
    // motivo pelo qual `candidateAttempts` devolve o `reason`.
    const r = rodarMesa(velas(400, () => 100), "BTC", 0.40);
    expect(r.operacoes).toHaveLength(0);
    expect(Object.keys(r.porQueNaoAbriu).length).toBeGreaterThan(0);
    expect(Object.values(r.porQueNaoAbriu).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it("série curta demais não inventa operação", () => {
    // Abaixo do aquecimento os indicadores não nasceram — e indicador que não
    // nasceu não é sinal fraco, é ausência.
    const r = rodarMesa(velas(60, (i) => 100 + i), "BTC", 0.40);
    expect(r.operacoes).toHaveLength(0);
    expect(r.barrasAvaliadas).toBe(0);
  });
});

describe("o custo é o do CLIENTE, e a saída é a da casa", () => {
  it("⚠️ o pedágio muda o líquido sem mudar o bruto", () => {
    const v = velas(700, (i) => 100 + Math.sin(i / 11) * 7 + i * 0.03);
    const barato = rodarMesa(v, "BTC", 0.03);   // futuros maker
    const caro = rodarMesa(v, "BTC", 0.60);     // DEX

    // O caminho do preço é o mesmo: só o desconto muda.
    expect(caro.operacoes.length).toBe(barato.operacoes.length);
    if (barato.operacoes.length > 0) {
      expect(caro.operacoes[0].brutoPct).toBeCloseTo(barato.operacoes[0].brutoPct, 6);
      expect(barato.operacoes[0].liquidoPct - caro.operacoes[0].liquidoPct).toBeCloseTo(0.57, 6);
    }
  });

  it("cada operação registra QUAL playbook a abriu", () => {
    const r = rodarMesa(velas(900, (i) => 100 + Math.sin(i / 13) * 8 + i * 0.02), "BTC", 0.40);
    const somaPlaybooks = Object.values(r.porPlaybook).reduce((a, b) => a + b, 0);
    expect(somaPlaybooks).toBe(r.operacoes.length);
  });
});

describe("⚠️ a semanal é AGREGADA das diárias, não substituída por elas", () => {
  it("máxima, mínima, fechamento e volume saem do bloco inteiro", () => {
    const d: VelaComTempo[] = [
      { t: 0, high: 110, low: 90, close: 100, volume: 1 },
      { t: H, high: 130, low: 95, close: 120, volume: 2 },
      { t: 2 * H, high: 115, low: 80, close: 105, volume: 3 },
    ];
    const [semana] = agregar(d, 3);
    expect(semana.t).toBe(0);
    expect(semana.high).toBe(130);          // a maior das três
    expect(semana.low).toBe(80);            // a menor das três
    expect(semana.close).toBe(105);         // o último fechamento
    expect(semana.volume).toBe(6);          // a soma
  });

  it("⚠️ o bloco INCOMPLETO do fim fica de fora", () => {
    // Uma semana que ainda não fechou não é uma vela semanal — é a mesma
    // armadilha da vela corrente, que não entra na `mercado_vela`.
    const d = Array.from({ length: 10 }, (_, i) => ({ t: i * H, high: 1, low: 1, close: 1, volume: 1 }));
    expect(agregar(d, 7)).toHaveLength(1);
  });

  it("fator 1 não mexe na série", () => {
    const d = [{ t: 0, high: 2, low: 1, close: 1.5, volume: 9 }];
    expect(agregar(d, 1)).toEqual(d);
  });
});
