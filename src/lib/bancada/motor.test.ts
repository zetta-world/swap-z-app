/**
 * ⚠️⚠️ O QUE ESTE ARQUIVO PERSEGUE É O LOOKAHEAD.
 *
 * Um backtest que usa a vela do sinal para resolver alvo e stop transforma
 * QUALQUER regra em ouro, e o número que ele produz é indistinguível de uma
 * descoberta. Metade dos testes daqui existe para que isso quebre alto.
 */
import { describe, it, expect } from "vitest";
import { rodar, sinais } from "@/lib/bancada/motor";
import type { EstrategiaDoCliente } from "@/lib/bancada/vocabulario";
import type { VelaComTempo } from "@/lib/mercado/velas";

const MIN = 60_000;
/** Vela no minuto `i`. Sem high/low explícitos, a barra é um ponto no `close`. */
function v(i: number, close: number, high = close, low = close): VelaComTempo {
  return { t: i * MIN, close, high, low, volume: 1 };
}

const media2: EstrategiaDoCliente = {
  entrada: { tipo: "media", n: 2 }, direcao: "compra",
  alvoPct: 2, stopPct: 2, horasLimite: 1, praca: "futuros_gate", papel: "maker",
};

/** Série em que a média de 2 cruza para cima exatamente na vela 2. */
function serieQueCruzaNaVela2(resto: VelaComTempo[]): VelaComTempo[] {
  return [v(0, 100), v(1, 100), v(2, 101), ...resto];
}

describe("o sinal olha só para trás", () => {
  it("cruzamento, não estado: cinquenta velas acima da média abrem UMA posição", () => {
    // ⚠️ "Fechou acima da média" fica verdadeiro para sempre numa alta, e
    // abriria cinquenta posições da mesma perna do mesmo movimento. O `n` da
    // tela contaria repetição como evidência.
    const velas = [v(0, 100), v(1, 100), ...Array.from({ length: 50 }, (_, k) => v(2 + k, 101 + k))];
    expect(sinais(velas, media2).filter(Boolean)).toHaveLength(1);
  });

  it("antes de o indicador nascer não há sinal — ausência, não `false`", () => {
    const velas = [v(0, 100)];
    expect(sinais(velas, { ...media2, entrada: { tipo: "media", n: 5 } })).toEqual([false]);
  });

  it("o canal olha as N velas ANTERIORES, nunca a própria", () => {
    // Comparar a máxima da janela consigo mesma nunca romperia.
    const canal: EstrategiaDoCliente = { ...media2, entrada: { tipo: "canal", n: 2 } };
    const velas = [v(0, 100), v(1, 100), v(2, 100), v(3, 105)];
    expect(sinais(velas, canal)[3]).toBe(true);
  });

  it("⚠️ a PRIMEIRA vela em que o indicador existe nunca é um cruzamento", () => {
    // Ali não sabemos se acabou de entrar ou se já estava dentro há semanas.
    // Marcar sinal seria inventar uma travessia a partir da nossa ignorância —
    // e ela cairia sempre no começo da janela, enviesando toda rodada curta.
    const canal: EstrategiaDoCliente = { ...media2, entrada: { tipo: "canal", n: 2 } };
    const velas = [v(0, 100), v(1, 100), v(2, 105)];
    expect(sinais(velas, canal)).toEqual([false, false, false]);
  });
});

describe("⚠️⚠️ a vela do sinal NÃO resolve a posição", () => {
  it("a máxima da própria vela do sinal não fecha no alvo", () => {
    // A vela 2 dispara o sinal E tem máxima de 200 — mais que suficiente para o
    // alvo de 2%. Se o motor a usasse, sairia uma operação vencedora do nada.
    const velas = serieQueCruzaNaVela2([
      v(3, 101), v(4, 101), v(5, 101),
    ]);
    velas[2] = { ...velas[2], high: 200 };

    const r = rodar(velas, media2);
    expect(r.operacoes).toHaveLength(0);
    // Ela fica ABERTA: o horizonte de 1h não venceu em 3 minutos de janela.
    expect(r.aindaAbertas).toBe(1);
  });

  it("a MESMA máxima, uma vela depois, fecha no alvo (a metade positiva)", () => {
    const velas = serieQueCruzaNaVela2([
      { ...v(3, 101), high: 200 }, v(4, 101),
    ]);
    const r = rodar(velas, media2);
    expect(r.operacoes).toHaveLength(1);
    expect(r.operacoes[0].desfecho).toBe("alvo");
  });
});

describe("as três classes de desfecho, e o pessimismo", () => {
  it("⚠️ stop-first: a vela que toca os DOIS livra o stop", () => {
    const velas = serieQueCruzaNaVela2([
      { ...v(3, 101), high: 200, low: 1 },
    ]);
    const r = rodar(velas, media2);
    expect(r.operacoes[0].desfecho).toBe("stop");
  });

  it("⚠️ a posição que estoura o horizonte EXPIRA — e expirada não é ganho nem perda", () => {
    // Horizonte de 1 minuto, janela de vários: a posição vence sem tocar nada.
    // ⚠️ Este teste nasceu de um defeito real: o horizonte era comparado com um
    // limite 1ms menor que ele mesmo, então NADA expirava — as posições
    // sumiam do resultado como "ainda abertas".
    const curto: EstrategiaDoCliente = { ...media2, horasLimite: 1 / 60 };
    const velas = serieQueCruzaNaVela2([v(3, 101), v(4, 101), v(5, 101)]);
    const r = rodar(velas, curto);
    expect(r.operacoes).toHaveLength(1);
    expect(r.operacoes[0].desfecho).toBe("expirada");
    expect(r.aindaAbertas).toBe(0);
  });

  it("a posição aberta no fim da janela NÃO vira resultado", () => {
    // Marcá-la a mercado no último fechamento seria encerrar uma operação que a
    // estratégia não mandou encerrar — e uma janela que termina numa alta
    // viraria borda que não existe.
    const velas = serieQueCruzaNaVela2([v(3, 101)]);
    const r = rodar(velas, media2);
    expect(r.operacoes).toHaveLength(0);
    expect(r.aindaAbertas).toBe(1);
  });
});

describe("uma posição por vez, e o custo é o da praça", () => {
  it("o sinal que repete enquanto há posição aberta não empilha", () => {
    // Preço serrilhado dentro de ±2%: a média cruza três vezes, e nenhuma
    // dessas oscilações toca alvo nem stop. Sem a trava, seriam TRÊS posições
    // do mesmo movimento, e o `n` da tela contaria repetição como evidência.
    const velas = [v(0, 100), v(1, 100), v(2, 100.5), v(3, 100), v(4, 100.5), v(5, 100), v(6, 100.5), v(7, 100)];
    const sinalizadas = sinais(velas, media2).filter(Boolean).length;
    expect(sinalizadas).toBe(3);

    const r = rodar(velas, media2);
    expect(r.aindaAbertas).toBe(1);
    expect(r.operacoes).toHaveLength(0);
  });

  it("⚠️ líquido = bruto − pedágio, e o pedágio é o da praça E do papel", () => {
    const velas = serieQueCruzaNaVela2([{ ...v(3, 101), high: 200 }, v(4, 101)]);

    const maker = rodar(velas, media2).operacoes[0];                      // futuros maker: 0,03%
    const taker = rodar(velas, { ...media2, praca: "spot_gate", papel: "taker" }).operacoes[0]; // spot: 0,40%

    expect(maker.brutoPct - maker.liquidoPct).toBeCloseTo(0.03, 6);
    expect(taker.brutoPct - taker.liquidoPct).toBeCloseTo(0.40, 6);
    // O movimento de preço é o MESMO nos dois — só o pedágio muda.
    expect(maker.brutoPct).toBeCloseTo(taker.brutoPct, 6);
  });

  it("vendido é o espelho: o alvo fica ABAIXO da entrada", () => {
    const venda: EstrategiaDoCliente = { ...media2, direcao: "venda" };
    // Cruza para baixo na vela 2, e a vela 3 despenca até o alvo.
    const velas = [v(0, 100), v(1, 100), v(2, 99), { ...v(3, 96), low: 96 }, v(4, 96)];
    const r = rodar(velas, venda);
    expect(r.operacoes).toHaveLength(1);
    expect(r.operacoes[0].desfecho).toBe("alvo");
    expect(r.operacoes[0].brutoPct).toBeGreaterThan(0);
  });
});
