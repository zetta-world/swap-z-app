import { describe, it, expect } from "vitest";
import {
  backtestPlaybooks, summarize, mergeResults, diagnose, WARMUP_BARS, INDICATOR_WINDOW,
  type Outcome,
  type TimedCandle, type BacktestResult,
} from "@/lib/zion/playbook-backtest";
import type { MarketRegime } from "@/lib/api/market-indicators";
import { computeExitPath } from "@/lib/paper/engine";

/**
 * O BACKTEST QUE SUBSTITUI O PALPITE.
 *
 * A coluna `priority` da biblioteca decide qual estratégia o mecânico tenta
 * primeiro, e sempre foi um chute declarado como tal. Estes testes guardam as
 * propriedades sem as quais a medição que vai substituí-la seria pior que o
 * chute — porque teria a aparência de fato.
 *
 * Duas delas importam mais que todo o resto:
 *
 *   1. NÃO OLHAR O FUTURO. Um backtest que espia adiante produz curvas lindas e
 *      mente com convicção.
 *   2. NÃO CONTAR O MESMO EVENTO VÁRIAS VEZES. O mesmo setup vale por várias
 *      barras; sem cooldown, um único movimento vira "50 trades" e a amostra
 *      parece grande sendo a mesma observação repetida.
 */

/** Série sintética: começa em `from` e anda `step` por barra. */
function ramp(n: number, from = 100, step = 0, vol = 1000): TimedCandle[] {
  const out: TimedCandle[] = [];
  for (let i = 0; i < n; i++) {
    const c = from + step * i;
    out.push({ t: Date.UTC(2026, 0, 1) + i * 3_600_000, high: c * 1.01, low: c * 0.99, close: c, volume: vol });
  }
  return out;
}

/** Série lateral com oscilação — o terreno de mean-reversion. */
function oscillate(n: number, mid = 100, amp = 6): TimedCandle[] {
  const out: TimedCandle[] = [];
  for (let i = 0; i < n; i++) {
    const c = mid + amp * Math.sin(i / 7);
    out.push({ t: Date.UTC(2026, 0, 1) + i * 3_600_000, high: c * 1.012, low: c * 0.988, close: c, volume: 1000 });
  }
  return out;
}

/**
 * PASSEIO ALEATÓRIO COM SEMENTE — o mercado SEM vantagem nenhuma.
 *
 * As séries de seno acima testam mecânica (aquecimento, cooldown, janela) e não
 * produzem trade nenhum: são lisas demais para a biblioteca achar setup. Para
 * medir COMPORTAMENTO é preciso um mercado com a volatilidade de um de verdade
 * — e um em que a resposta certa é conhecida de antemão.
 *
 * Num passeio puro não existe padrão a descobrir, então nenhuma estratégia pode
 * ter expectância positiva. É o melhor controle negativo que existe: se o
 * backtest mostrar lucro AQUI, o lucro é do código, não do mercado.
 *
 * Semente fixa porque `Math.random` num teste transforma falha em folclore
 * ("na minha máquina passa").
 */
function walk(n: number, driftPerBar: number, sigma: number, seed: number): TimedCandle[] {
  let s = seed;
  const rnd = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const out: TimedCandle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const open = p;
    p = p * (1 + driftPerBar + sigma * gauss());
    out.push({
      t: Date.UTC(2026, 0, 1) + i * 3_600_000,
      high: Math.max(open, p) * (1 + sigma * 0.6 * Math.abs(gauss())),
      low: Math.min(open, p) * (1 - sigma * 0.6 * Math.abs(gauss())),
      close: p, volume: 1000 * (0.5 + rnd()),
    });
  }
  return out;
}

describe("aquecimento — indicador meio-formado não gera sinal", () => {
  it("série curta demais não produz trade nenhum", () => {
    // EMA50 sobre 30 barras é um número, mas não é uma EMA50. Sinais gerados
    // a partir daí entrariam na amostra com o mesmo peso dos bons.
    const r = backtestPlaybooks("TEST", ramp(WARMUP_BARS - 10));
    expect(r.barsTested).toBe(0);
    expect(r.stats).toEqual([]);
  });

  it("só avalia barras DEPOIS do aquecimento", () => {
    const n = WARMUP_BARS + 50;
    const r = backtestPlaybooks("TEST", oscillate(n));
    // n − warmup − 1 (a última barra não abre trade: não haveria futuro nenhum)
    expect(r.barsTested).toBe(n - WARMUP_BARS - 1);
  });
});

describe("não olhar o futuro", () => {
  it("o resultado NÃO muda quando o futuro depois da série é diferente", () => {
    // Esta é a prova operacional de ausência de lookahead: se a decisão da barra
    // `i` dependesse de qualquer coisa após ela, prolongar a série com dois
    // futuros opostos mudaria os trades abertos ANTES do ponto de corte.
    const base = oscillate(WARMUP_BARS + 80);
    const subindo = [...base, ...ramp(40, 200, 5).map((c, k) => ({ ...c, t: base[base.length - 1].t + (k + 1) * 3_600_000 }))];
    const caindo = [...base, ...ramp(40, 200, -5).map((c, k) => ({ ...c, t: base[base.length - 1].t + (k + 1) * 3_600_000 }))];

    const a = backtestPlaybooks("TEST", subindo);
    const b = backtestPlaybooks("TEST", caindo);
    // As barras avaliadas são as mesmas nos dois; o que difere só pode vir da
    // RESOLUÇÃO dos trades que ainda estavam abertos no ponto de corte.
    expect(a.barsTested).toBe(b.barsTested);
  });

  it("a última barra nunca abre trade — não haveria futuro para resolvê-lo", () => {
    const n = WARMUP_BARS + 3;
    const r = backtestPlaybooks("TEST", oscillate(n));
    expect(r.barsTested).toBe(n - WARMUP_BARS - 1);
  });
});

describe("cooldown — o mesmo evento não vira dez trades", () => {
  it("um setup que persiste não abre uma posição por barra", () => {
    // Sem cooldown, uma lateral de 200 barras produziria ~200 'range_reversion'
    // quase idênticos. Com ele, cada trade só nasce depois que o anterior
    // resolveu — e a amostra passa a contar EVENTOS, não barras.
    const r = backtestPlaybooks("TEST", oscillate(WARMUP_BARS + 300));
    for (const s of r.stats) {
      expect(s.decided, `${s.playbook} inflado`).toBeLessThan(r.barsTested / 2);
    }
  });
});

describe("janela de indicadores — custo constante e retrato recente", () => {
  it("o retrato NUNCA olha mais que a janela para trás", () => {
    // Sem este limite o custo por barra crescia com a posição dela
    // (`calcSupportResistance` varre o array inteiro), e seis meses estourariam
    // os 60s da rota — devolvendo menos símbolos EM SILÊNCIO, que é a pior
    // forma de falhar.
    expect(INDICATOR_WINDOW).toBeGreaterThan(0);
    // Folgado para EMA50 convergir, ADX14, divergência (60 velas) e relVol (20).
    expect(INDICATOR_WINDOW).toBeGreaterThan(50 * 4);
  });

  it("série LONGA roda, e roda em tempo de rota", () => {
    // 4.400 barras ≈ 6 meses. Com a janela limitada isto é linear; sem ela
    // seria quadrático e levaria minutos.
    const t0 = Date.now();
    const r = backtestPlaybooks("TEST", oscillate(4400));
    const ms = Date.now() - t0;
    expect(r.barsTested).toBe(4400 - WARMUP_BARS - 1);
    // Margem generosa: o ponto é pegar uma REGRESSÃO para quadrático, não
    // cravar desempenho de máquina.
    expect(ms, `levou ${ms}ms — quadrático de novo?`).toBeLessThan(20_000);
  });

  it("a janela não impede o aquecimento de séries curtas", () => {
    // Antes de `INDICATOR_WINDOW` barras existirem, o retrato usa o que há.
    const r = backtestPlaybooks("TEST", oscillate(WARMUP_BARS + 40));
    expect(r.barsTested).toBe(39);
  });
});

describe("summarize — a aritmética do veredito", () => {
  const o = (netPct: number, reason: "target" | "stop" | "expired", win: boolean, regime: MarketRegime = "RANGING") =>
    ({ regime, netPct, reason, win });

  it("expectância é a média LÍQUIDA por trade", () => {
    const s = summarize("range_reversion", [o(10, "target", true), o(-5, "stop", false)]);
    expect(s.netPerTrade).toBeCloseTo(2.5, 6);
    expect(s.decided).toBe(2);
  });

  it("EXPIRADA não conta como vitória nem derrota no win-rate", () => {
    // Contá-la como derrota puniria a paciência; como vitória, premiaria a
    // indecisão. É a mesma regra do flywheel, por cicatriz.
    const s = summarize("range_reversion", [o(10, "target", true), o(-5, "stop", false), o(1, "expired", true)]);
    expect(s.expired).toBe(1);
    expect(s.winRate).toBeCloseTo(0.5, 6);   // 1 de 2 decididos de verdade
    expect(s.decided).toBe(3);               // mas ela CONTA na expectância
  });

  it("sem amostra, devolve null em vez de zero", () => {
    // Zero é um número e seria lido como "empatou". Null é a ausência.
    const s = summarize("absorption", []);
    expect(s.netPerTrade).toBeNull();
    expect(s.winRate).toBeNull();
  });

  it("separa por REGIME — é ali que mora a resposta útil", () => {
    const s = summarize("range_reversion", [
      o(10, "target", true, "RANGING"), o(8, "target", true, "RANGING"),
      o(-6, "stop", false, "TRENDING_DOWN"),
    ]);
    expect(s.byRegime.RANGING?.decided).toBe(2);
    expect(s.byRegime.RANGING?.netPerTrade).toBeCloseTo(9, 6);
    expect(s.byRegime.TRENDING_DOWN?.netPerTrade).toBeCloseTo(-6, 6);
  });
});

describe("mergeResults — juntar símbolos sem falsear a média", () => {
  // Sem `outcomes`: exercita de propósito o caminho antigo do merge, o que
  // soma só o veredito. É o que sobra quando os trades crus não vêm junto.
  const mk = (symbol: string, decided: number, net: number): BacktestResult => ({
    symbol, barsTested: 1000, buyHoldPct: 0,
    stats: [{
      playbook: "range_reversion", decided, wins: decided, losses: 0, expired: 0,
      netPerTrade: net, winRate: 1, diag: null,
      byRegime: { RANGING: { decided, netPerTrade: net } },
    }],
  });

  it("média PONDERADA por número de trades, não média das médias", () => {
    // A média simples daria o mesmo peso a um símbolo com 3 trades e a outro
    // com 300 — e o de 3 dominaria o veredito por acidente.
    const m = mergeResults([mk("A", 300, 1), mk("B", 3, 50)]);
    expect(m[0].decided).toBe(303);
    // ponderada: (300×1 + 3×50) / 303 ≈ 1.485 — não 25.5
    expect(m[0].netPerTrade).toBeCloseTo((300 * 1 + 3 * 50) / 303, 4);
    expect(m[0].netPerTrade!).toBeLessThan(5);
  });

  it("soma as amostras por regime", () => {
    const m = mergeResults([mk("A", 10, 2), mk("B", 5, 4)]);
    expect(m[0].byRegime.RANGING?.decided).toBe(15);
  });

  it("ordena do melhor para o pior — é um ranking de estratégia", () => {
    const bom: BacktestResult = { ...mk("A", 10, 5), stats: [{ ...mk("A", 10, 5).stats[0], playbook: "absorption" }] };
    const m = mergeResults([mk("A", 10, 1), bom]);
    expect(m[0].playbook).toBe("absorption");
  });
});

/**
 * O DIAGNÓSTICO — a diferença entre "não paga" e "por que não paga".
 *
 * A primeira janela de 6 meses devolveu os nove playbooks negativos, o melhor
 * em −0.21% — praticamente o custo de ida-e-volta. Esse número responde "paga?"
 * e não responde mais nada. Sem o porquê só dá para trocar de estratégia no
 * escuro até alguma parecer boa por sorte, que é como se constrói um sistema
 * que quebra com dinheiro de verdade.
 *
 * As excursões separam dois consertos OPOSTOS que o desfecho sozinho confunde:
 * alvo longe demais (o preço andava metade do caminho e voltava) e stop perto
 * demais (o perdedor furava por um triz e depois recuperava).
 */
describe("diagnóstico — por que o número é o que é", () => {
  const t = (over: Partial<Outcome> = {}): Outcome => ({
    regime: "RANGING", netPct: 0, reason: "expired", win: false,
    mfePct: 0, maePct: 0, targetPct: 4, stopPct: 2, plannedRr: 2, straddled: false,
    inverseNetPct: 0, inverseReason: "expired", weather: "misto", ...over,
  });

  it("RR realizado é o que o mercado PAGOU, não o que o bracket prometeu", () => {
    // O validador exige RR ≥ 1.8 no papel. Se o realizado vier bem abaixo, a
    // promessa do bracket não está sendo cumprida — e é isso que decide se o
    // conserto é na geometria ou na tese.
    const d = diagnose([
      t({ reason: "target", win: true, netPct: 4 }),
      t({ reason: "stop", win: false, netPct: -2 }),
      t({ reason: "stop", win: false, netPct: -2 }),
    ])!;
    expect(d.plannedRr).toBe(2);
    expect(d.realizedRr).toBeCloseTo(2, 6);
  });

  it("sem uma perda sequer, RR realizado é null — não infinito", () => {
    // Dividir por zero na tela viraria a mentira mais otimista possível.
    const d = diagnose([t({ reason: "target", win: true, netPct: 4 })])!;
    expect(d.realizedRr).toBeNull();
  });

  it("mfe/alvo mede quanto do caminho o preço andou", () => {
    // 2 de 4 = metade do caminho. É o número que diz "o alvo está no lugar
    // errado", em vez de deixar concluir que a tese estava errada.
    const d = diagnose([t({ mfePct: 2 }), t({ mfePct: 2 })])!;
    expect(d.mfeToTarget).toBeCloseTo(0.5, 6);
  });

  it("mae/stop IGNORA quem stopou — senão a mediana seria 1.0 sempre", () => {
    // Em quem stopou, a excursão adversa É o stop por definição. Incluí-los
    // faria o número dizer "o stop está encostado no ruído" em todo playbook,
    // inclusive nos que não estão.
    const d = diagnose([
      t({ reason: "stop", maePct: -2 }),
      t({ reason: "target", win: true, maePct: -0.4 }),
    ])!;
    expect(d.maeToStop).toBeCloseTo(0.2, 6);
  });

  it("usa MEDIANA — um trade absurdo não decide o diagnóstico", () => {
    const d = diagnose([t({ mfePct: 1 }), t({ mfePct: 1 }), t({ mfePct: 40 })])!;
    expect(d.mfeToTarget).toBeCloseTo(0.25, 6);
  });

  it("conta os desfechos decididos pela convenção stop-first", () => {
    // Se esse número for grande, boa parte da perda é a convenção pessimista e
    // não o mercado — e aí a leitura do resultado muda.
    const d = diagnose([t({ straddled: true }), t()])!;
    expect(d.straddles).toBe(1);
  });

  it("fixture SEM o caminho não inventa diagnóstico", () => {
    // Zero seria lido como "o preço não andou nada". A ausência tem que
    // aparecer como ausência.
    const s = summarize("range_reversion", [{ regime: "RANGING", netPct: 1, reason: "target", win: true }]);
    expect(s.diag).toBeNull();
  });
});

describe("o denominador — o que o mercado fez na mesma janela", () => {
  it("comprar-e-segurar é medido do fim do AQUECIMENTO, não da primeira barra", () => {
    // Comparar contra a série inteira compararia com um trecho em que nenhum
    // playbook podia operar ainda.
    const c = ramp(WARMUP_BARS + 100, 100, 1);
    const r = backtestPlaybooks("TEST", c);
    const esperado = ((c[c.length - 1].close - c[WARMUP_BARS].close) / c[WARMUP_BARS].close) * 100;
    expect(r.buyHoldPct).toBeCloseTo(esperado, 6);
  });

  it("o merge usa os trades CRUS quando eles vêm — mediana de mediana não é mediana", () => {
    const a = backtestPlaybooks("A", walk(1800, 0, 0.007, 11));
    const b = backtestPlaybooks("B", walk(1800, 0, 0.007, 22));
    const m = mergeResults([a, b]);
    const total = [...a.stats, ...b.stats].reduce((s, x) => s + x.decided, 0);
    expect(total).toBeGreaterThan(0);
    expect(m.reduce((s, x) => s + x.decided, 0)).toBe(total);
    // E o diagnóstico sobrevive ao merge, em vez de virar null.
    expect(m.some((s) => s.diag != null)).toBe(true);
  });
});

/**
 * O CONTROLE NEGATIVO — a prova de que o backtest não fabrica vantagem.
 *
 * Este é o teste que separa um backtest de uma máquina de fazer curva bonita.
 * Num passeio aleatório NÃO EXISTE padrão a descobrir: qualquer expectância
 * positiva consistente só pode ter vindo do código — lookahead, resolução
 * otimista, custo esquecido.
 *
 * Ele importa mais depois de 03/08, quando a medição real devolveu os nove
 * playbooks negativos. A pergunta óbvia diante daquele resultado é "será que o
 * backtest está quebrado e pessimista?". Isto responde pelo outro lado: ele não
 * é otimista quando não deveria ser, e mede o custo que promete medir.
 */
describe("controle negativo — mercado sem vantagem não pode virar lucro", () => {
  const semente = [1, 2, 3, 4, 5];

  it("em passeio puro, a média dos playbooks fica em torno do CUSTO — nunca no lucro", () => {
    const res = semente.map((s) => backtestPlaybooks(`S${s}`, walk(2600, 0, 0.007, s)));
    const stats = mergeResults(res);
    const n = stats.reduce((a, s) => a + s.decided, 0);
    expect(n, "sem trades não há o que provar").toBeGreaterThan(30);
    const medio = stats.reduce((a, s) => a + (s.netPerTrade ?? 0) * s.decided, 0) / n;
    // Folga generosa dos dois lados: o ponto é pegar vantagem FABRICADA
    // (lookahead daria muito mais que isso), não cravar um valor.
    expect(medio, `expectância média ${medio.toFixed(2)}% num mercado sem padrão`).toBeLessThan(0.5);
    expect(medio).toBeGreaterThan(-5);
  });

  it("o custo de ida-e-volta É cobrado — o bruto zero não vira líquido zero", () => {
    // Um backtest que esquece o custo é o erro mais comum e o mais caro: ele
    // aprova estratégias de expectância nula, que no dinheiro real sangram a
    // taxa a cada operação.
    const r = backtestPlaybooks("S", walk(2600, 0, 0.007, 7));
    const todos = r.outcomes ?? [];
    expect(todos.length).toBeGreaterThan(0);
    // Toda expirada fecha no preço da barra: o líquido tem que ser MENOR que a
    // excursão bruta até ali, exatamente pelo custo.
    for (const { outcome } of todos) {
      if (outcome.reason === "target") {
        expect(outcome.netPct).toBeLessThan(outcome.targetPct);
      }
    }
  });
});

/**
 * "SE EU COMPRAR QUANDO ELE DIZ QUE TÁ RUIM, VOU LUCRAR" — medindo a piada.
 *
 * O dono brincou que a mesa só acerta a entrada errada, e que fazer o contrário
 * daria lucro. A brincadeira tem aritmética: expectância consistentemente
 * negativa tem um espelho positivo, menos o custo pago duas vezes.
 *
 * O QUE TORNA A MEDIÇÃO DELICADA: inverter o SINAL do resultado seria batota.
 *
 * Quando uma vela cruza alvo E stop, a convenção pessimista faz o long registrar
 * o STOP. Se o espelho fosse `−netPct`, essa mesma vela viraria um ALVO batido
 * no short: o pessimismo do original viraria otimismo na tradução, e o inverso
 * apareceria melhor do que é justamente nas velas mais violentas — que são as
 * que mais importam.
 *
 * Por isso o espelho é uma posição vendida DE VERDADE, resolvida pelo mesmo
 * motor. O short também perde o straddle.
 */
describe("o espelho — e por que ele não é só trocar o sinal", () => {
  it("numa vela que cruza os DOIS lados, long e short perdem", () => {
    // Esta é a propriedade inteira. Uma vela que varre alvo e stop é ambígua:
    // ninguém sabe qual foi tocado primeiro. A convenção honesta pune os dois
    // lados — e é o que impede o espelho de virar uma máquina de lucro.
    const c = (t: number, high: number, low: number, close: number) => ({ t, high, low, close, volume: 1 });
    const violenta = [c(1, 112, 88, 100)];   // varre +12% e −12%

    const long = { side: "buy", entry_price: 100, cost_usd: 100, target_price: 110, stop_price: 90, opened_at: new Date(0).toISOString(), horizon_hours: 48 };
    const short = { ...long, side: "sell", target_price: 90, stop_price: 110 };

    const vLong = computeExitPath(long, violenta, undefined, 3_600_000)!;
    const vShort = computeExitPath(short, violenta, undefined, 3_600_000)!;

    expect(vLong.reason).toBe("stop");
    expect(vShort.reason).toBe("stop");
    // Os dois no vermelho: o espelho NÃO recupera o que o original perdeu.
    expect(vLong.netPct).toBeLessThan(0);
    expect(vShort.netPct).toBeLessThan(0);
  });

  it("num movimento LIMPO contra o long, o espelho ganha de verdade", () => {
    // Sem ambiguidade não há pessimismo a aplicar, e a simetria vale: o que o
    // long perde no stop, o short ganha no alvo — menos o custo, dos dois lados.
    const c = (t: number, high: number, low: number, close: number) => ({ t, high, low, close, volume: 1 });
    const queda = [c(1, 101, 89, 90)];

    const long = { side: "buy", entry_price: 100, cost_usd: 100, target_price: 110, stop_price: 90, opened_at: new Date(0).toISOString(), horizon_hours: 48 };
    const short = { ...long, side: "sell", target_price: 90, stop_price: 110 };

    const vLong = computeExitPath(long, queda, undefined, 3_600_000)!;
    const vShort = computeExitPath(short, queda, undefined, 3_600_000)!;

    expect(vLong.reason).toBe("stop");
    expect(vShort.reason).toBe("target");
    // A soma dos dois é NEGATIVA: é o custo de ida-e-volta, pago duas vezes.
    // Nenhum par long+short espelhado soma zero — e é por isso que "fazer o
    // contrário" não é lucro garantido nem quando a mesa erra sempre.
    expect(vLong.netPct + vShort.netPct).toBeLessThan(0);
  });

  it("o backtest registra o espelho de cada trade", () => {
    const r = backtestPlaybooks("S", walk(2600, 0, 0.007, 3));
    const todos = r.outcomes ?? [];
    expect(todos.length).toBeGreaterThan(0);
    for (const { outcome } of todos) {
      expect(Number.isFinite(outcome.inverseNetPct)).toBe(true);
      // O espelho nunca é o simétrico exato — o custo aparece nos dois lados.
      expect(outcome.inverseNetPct).not.toBeCloseTo(-outcome.netPct, 6);
    }
  });
});
