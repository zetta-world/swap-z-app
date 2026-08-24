import { describe, it, expect } from "vitest";
import { computeExit, computeExitPath } from "@/lib/paper/engine";
import { CUSTO_IDA_E_VOLTA_PCT, CUSTO_POR_PERNA_PCT, PERNAS_POR_CICLO } from "@/lib/zion/custo";

/**
 * ARITMÉTICA DE P&L — os números que decidem a BARRA DE LANÇAMENTO.
 *
 * A suíte existente já cobria o caso de GANHO com o valor exato. Os buracos
 * eram os outros: a perda só afirmava `< 0` (um bug que subtraísse o custo duas
 * vezes passaria), o lado vendido não tinha nenhum caso, e o replay de candles
 * nunca foi conferido contra conta feita à mão.
 *
 * Isso importa mais que um teste comum: a barra de lançamento é um compromisso
 * ÉTICO com quem não pode perder US$100, e ela decide a partir destes números.
 * Se a conta estiver errada, o compromisso está construído sobre areia — e
 * nenhum dos 17 checks da bancada perceberia, porque todos passariam.
 */

/**
 * ⚠️ LIDO DA FONTE, NUNCA DIGITADO (16/08).
 *
 * Este `COST` era `0.2` na mão, com o comentário "BACKTEST_COST_PCT padrão".
 * A cópia estava certa no dia em que foi escrita e passou a mentir junto com o
 * código: `paper/engine.ts` cobrava o custo de UMA ordem pelo ciclo INTEIRO, e
 * o teste confirmava o erro com o mesmo número errado. Oito asserções verdes
 * sobre metade da taxa real da Gate.io.
 *
 * Um teste que copia a constante que ele deveria conferir não confere nada —
 * ele só garante que a cópia continua igual à cópia.
 */
const COST = CUSTO_IDA_E_VOLTA_PCT;
const t0 = Date.parse("2026-07-01T00:00:00Z");
const H = 3_600_000;

const long = {
  side: "buy", entry_price: 100, cost_usd: 50,
  target_price: 110, stop_price: 95,
  opened_at: "2026-07-01T00:00:00Z", horizon_hours: 72,
};

describe("perda — valor EXATO, não só 'negativo'", () => {
  it("stop em 95 sobre entrada 100 = −5% bruto, −5,2% líquido", () => {
    const v = computeExit(long, 94, t0 + H)!;
    expect(v.reason).toBe("stop");
    // Sai NO stop (95), não no preço observado (94): o bracket define a saída.
    expect(v.netPct).toBeCloseTo(-5 - COST, 6);
    expect(v.pnlUsd).toBeCloseTo(50 * (-5 - COST) / 100, 6);
  });

  it("o custo entra UM CICLO por trade — não dois, não nenhum", () => {
    // O bug clássico é subtrair o custo no cálculo e de novo ao creditar.
    const win = computeExit(long, 111, t0 + H)!;
    const loss = computeExit(long, 94, t0 + H)!;
    // Ganho bruto +10, perda bruta −5. A soma dos líquidos tem de ser
    // (10 − 5) − 2×COST: exatamente um ciclo por trade, nos dois.
    expect(win.netPct + loss.netPct).toBeCloseTo(10 - 5 - 2 * COST, 6);
  });

  /**
   * ⚠️ A CONVENÇÃO EM SI, FIXADA — e não só o número que ela produz.
   *
   * O defeito de 16/08 não foi um valor errado, foi uma AMBIGUIDADE: o mesmo
   * `0,2` significava "o ciclo custa 0,2%" aqui e "cada perna custa 0,2%, logo
   * o ciclo custa 0,4%" em `lab/tendencia.ts`. Nenhum teste falhava, porque
   * cada um conferia a própria cópia.
   *
   * Esta asserção é a que teria pegado: ela afirma a RELAÇÃO entre as duas
   * convenções, e é o único ponto do sistema onde as duas se encontram.
   */
  it("uma posição de papel custa DUAS pernas — a taxa da Gate.io é por ordem", () => {
    expect(PERNAS_POR_CICLO).toBe(2);
    expect(CUSTO_IDA_E_VOLTA_PCT).toBeCloseTo(CUSTO_POR_PERNA_PCT * 2, 10);

    // E o motor cobra o ciclo, não a perna: entrada 100 → alvo 110 é +10%
    // bruto e +10% menos DUAS pernas líquido.
    const win = computeExit(long, 111, t0 + H)!;
    expect(win.netPct).toBeCloseTo(10 - CUSTO_POR_PERNA_PCT * 2, 6);
    // A conta errada de até 16/08, explícita para ninguém voltar a ela:
    expect(win.netPct).not.toBeCloseTo(10 - CUSTO_POR_PERNA_PCT, 6);
  });

  it("o custo SEMPRE reduz o resultado, nos dois lados", () => {
    const win = computeExit(long, 111, t0 + H)!;
    const loss = computeExit(long, 94, t0 + H)!;
    expect(win.netPct).toBeLessThan(10);    // ganho encolhe
    expect(loss.netPct).toBeLessThan(-5);   // perda aumenta
  });
});

describe("lado VENDIDO — o sinal precisa inverter", () => {
  const short = { ...long, side: "sell", target_price: 90, stop_price: 105 };

  it("preço CAINDO até o alvo é GANHO no vendido", () => {
    const v = computeExit(short, 89, t0 + H)!;
    expect(v.reason).toBe("target");
    expect(v.win).toBe(true);
    // Saída em 90 sobre entrada 100 = +10% para quem vendeu.
    expect(v.netPct).toBeCloseTo(10 - COST, 6);
  });

  it("preço SUBINDO até o stop é PERDA no vendido", () => {
    const v = computeExit(short, 106, t0 + H)!;
    expect(v.reason).toBe("stop");
    expect(v.netPct).toBeCloseTo(-5 - COST, 6);
  });

  it("um mesmo movimento dá sinais opostos em long e short", () => {
    // Guarda contra o erro de sinal mais fácil de cometer e mais difícil de ver.
    const up = 111;
    expect(computeExit(long, up, t0 + H)!.netPct).toBeGreaterThan(0);
    expect(computeExit({ ...short, target_price: 90, stop_price: 105 }, up, t0 + H)!.netPct).toBeLessThan(0);
  });
});

describe("replay de candles — a mesma conta pelo caminho, não pelo instante", () => {
  const c = (t: number, high: number, low: number, close: number) => ({ t, high, low, close });

  it("primeiro toque no ALVO vence e usa o preço do alvo", () => {
    const v = computeExitPath(long, [c(t0 + H, 112, 99, 111)], undefined, t0 + 2 * H)!;
    expect(v.reason).toBe("target");
    expect(v.netPct).toBeCloseTo(10 - COST, 6);
  });

  it("STOP-FIRST quando a MESMA vela cruza os dois — convenção pessimista", () => {
    // A vela vai de 94 a 112: não dá pra saber a ordem dentro dela, então
    // assume-se o pior. Otimismo aqui inflaria toda a curva de patrimônio.
    const v = computeExitPath(long, [c(t0 + H, 112, 94, 100)], undefined, t0 + 2 * H)!;
    expect(v.reason).toBe("stop");
    expect(v.netPct).toBeCloseTo(-5 - COST, 6);
  });

  it("respeita a ORDEM: vela que só toca o stop depois já fechou no alvo antes", () => {
    const v = computeExitPath(long, [
      c(t0 + H, 111, 105, 110),      // toca o alvo primeiro
      c(t0 + 2 * H, 106, 90, 92),    // stop só na vela seguinte
    ], undefined, t0 + 3 * H)!;
    expect(v.reason).toBe("target");
  });

  it("expira no ÚLTIMO fechamento quando nada foi tocado", () => {
    const v = computeExitPath(long, [
      c(t0 + H, 104, 99, 103),
      c(t0 + 2 * H, 105, 100, 102),
    ], undefined, t0 + 73 * H)!;
    expect(v.reason).toBe("expired");
    expect(v.netPct).toBeCloseTo(2 - COST, 6);  // fecha em 102
  });

  it("ignora vela ANTERIOR à abertura da posição", () => {
    // Sem isso, um trade herdaria movimento que aconteceu antes de existir.
    const v = computeExitPath(long, [
      c(t0 - 5 * H, 200, 50, 100),   // fora da janela: tocaria alvo E stop
      c(t0 + H, 104, 99, 103),
    ], undefined, t0 + 73 * H)!;
    expect(v.reason).toBe("expired");
  });

  it("segue em aberto enquanto nada foi tocado e o horizonte não venceu", () => {
    expect(computeExitPath(long, [c(t0 + H, 104, 99, 103)], undefined, t0 + 2 * H)).toBeNull();
  });
});

describe("coerência entre os dois caminhos de saída", () => {
  it("sem candles, o replay cai no spot e dá o MESMO número", () => {
    const spot = computeExit(long, 111, t0 + H)!;
    const path = computeExitPath(long, [], 111, t0 + H)!;
    expect(path.netPct).toBeCloseTo(spot.netPct, 9);
    expect(path.pnlUsd).toBeCloseTo(spot.pnlUsd, 9);
  });
});
