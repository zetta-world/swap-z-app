/**
 * ⚠️ O TESTE QUE FIXA AS CICATRIZES. As três linhas da tabela de equilíbrio não
 * são exemplos: são medições que custaram dinheiro a esta casa. Se a fórmula
 * geral não as reproduzir EXATAMENTE, é a fórmula que está errada.
 */
import { describe, it, expect } from "vitest";
import { equilibrioExigido, oPedagioAntesDeRodar } from "@/lib/bancada/custo";
import { oPortaoDoPedagio, lerEstrategia, type EstrategiaDoCliente } from "@/lib/bancada/vocabulario";

const base: EstrategiaDoCliente = {
  entrada: { tipo: "media", n: 20 }, direcao: "compra",
  alvoPct: 2.5, stopPct: 2.5, horasLimite: 24, praca: "spot_gate", papel: "taker",
};

describe("o acerto que empata", () => {
  // Custo de ida e volta na Gate spot: 2 × 0,20% = 0,40%.
  it("reproduz as três linhas da cicatriz", () => {
    expect(equilibrioExigido(0.6, 0.6, 0.4)!.acertoParaEmpatarPct).toBeCloseTo(83.33, 2);
    expect(equilibrioExigido(1.5, 1.5, 0.4)!.acertoParaEmpatarPct).toBeCloseTo(63.33, 2);
    expect(equilibrioExigido(2.5, 2.5, 0.4)!.acertoParaEmpatarPct).toBeCloseTo(58.0, 2);
  });

  it("⚠️ o bracket ASSIMÉTRICO — onde a fórmula do plano erra", () => {
    // Alvo 3%, stop 1%, custo 0,40%.
    //   geral:      (1 + 0,4) / (3 + 1)          = 35,0%
    //   do plano:   0,5 + 0,4/(2 × 3)            = 56,7%   ← errado por 21 pontos
    const geral = equilibrioExigido(3, 1, 0.4)!.acertoParaEmpatarPct;
    expect(geral).toBeCloseTo(35.0, 2);
    const simetricaDoPlano = 50 + (0.4 / (2 * 3)) * 100;
    expect(Math.abs(geral - simetricaDoPlano)).toBeGreaterThan(20);
  });

  it("⚠️ alvo menor que o pedágio é IMPOSSÍVEL, não difícil", () => {
    // Alvo 0,3% contra ida-e-volta de 0,40%: nem acertar sempre paga.
    const e = equilibrioExigido(0.3, 0.3, 0.4)!;
    expect(e.acertoParaEmpatarPct).toBeGreaterThan(100);
    expect(e.alcancavel).toBe(false);
    // E a frase precisa dizer a palavra — "precisa acertar 116%" soa como meta.
    const frase = oPedagioAntesDeRodar({ ...base, alvoPct: 0.3, stopPct: 0.3 }).frase;
    expect(frase).toMatch(/Nem acertando SEMPRE/);
    expect(frase).not.toMatch(/precisa acertar 1\d\d/);
  });

  it("sem denominador devolve null, nunca Infinity", () => {
    // Infinity numa tela parece um número.
    expect(equilibrioExigido(0, 0, 0.4)).toBeNull();
    expect(equilibrioExigido(NaN, 1, 0.4)).toBeNull();
  });
});

describe("o pedágio depende da PRAÇA e do PAPEL — a cicatriz do Maker", () => {
  it("o mesmo alvo é ruína no spot e folga no futuro maker", () => {
    const spot = oPedagioAntesDeRodar({ ...base, alvoPct: 0.6, stopPct: 0.6 });
    const fut  = oPedagioAntesDeRodar({ ...base, alvoPct: 0.6, stopPct: 0.6, praca: "futuros_gate", papel: "maker" });

    expect(spot.idaEVoltaPct).toBeCloseTo(0.40, 5);
    expect(fut.idaEVoltaPct).toBeCloseTo(0.03, 5);
    // 67% do alvo contra 5% — foi este número que aposentou o Maker por engano.
    expect(spot.fatiaDoAlvo!).toBeCloseTo(0.667, 2);
    expect(fut.fatiaDoAlvo!).toBeCloseTo(0.05, 2);
    expect(spot.severidade).toBe("grave");
    expect(fut.severidade).toBe("ok");
  });

  it("⚠️ o portão recusa no spot e LIBERA o mesmo alvo no futuro maker", () => {
    const spot = oPortaoDoPedagio({ ...base, alvoPct: 0.6, stopPct: 0.6 });
    expect(spot.ok).toBe(false);
    // A recusa tem de trazer o número, não um "inválido".
    if (!spot.ok) expect(spot.porque).toMatch(/0\.400%|0,40|pelo menos/);

    const fut = oPortaoDoPedagio({ ...base, alvoPct: 0.6, stopPct: 0.6, praca: "futuros_gate", papel: "maker" });
    expect(fut.ok).toBe(true);
  });

  it("⚠️⚠️ o portão julga o ALVO, não a maior perna", () => {
    // Alvo minúsculo com stop largo é a morte do Maker de Faixa: o pedágio come
    // o movimento inteiro. Com `Math.max(alvo, stop)` — a primeira versão —
    // isto PASSAVA, porque o stop de 5% cobria a taxa sozinho.
    expect(oPortaoDoPedagio({ ...base, alvoPct: 0.1, stopPct: 5 }).ok).toBe(false);

    // O contrário passa NESTE portão — o alvo paga a conta com folga. O risco
    // do stop apertado é real, mas quem o denuncia é o equilíbrio, não aqui.
    expect(oPortaoDoPedagio({ ...base, alvoPct: 5, stopPct: 0.1 }).ok).toBe(true);
  });

  it("⚠️ e o stop desproporcional aparece no EQUILÍBRIO, não fica sem resposta", () => {
    const e = equilibrioExigido(0.1, 5, 0.4)!;
    expect(e.acertoParaEmpatarPct).toBeGreaterThan(100);
    expect(e.alcancavel).toBe(false);
  });
});

describe("o vocabulário recusa com MOTIVO, e aceita o que é válido", () => {
  const valida = {
    entrada: { tipo: "media", n: 20 }, direcao: "compra",
    alvoPct: 2.5, stopPct: 2.5, horasLimite: 24, praca: "spot_gate", papel: "taker",
  };

  it("aceita a estratégia bem formada (a metade positiva)", () => {
    const r = lerEstrategia(valida);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.entrada).toEqual({ tipo: "media", n: 20 });
  });

  it.each([
    ["nada", null],
    ["texto", "compra tudo"],
    ["gatilho desconhecido", { ...valida, entrada: { tipo: "lua_cheia", n: 20 } }],
    ["período fracionário", { ...valida, entrada: { tipo: "media", n: 20.5 } }],
    ["período gigante", { ...valida, entrada: { tipo: "media", n: 99999 } }],
    ["nível de RSI absurdo", { ...valida, entrada: { tipo: "rsi", n: 14, nivel: 300 } }],
    ["direção inventada", { ...valida, direcao: "talvez" }],
    ["alvo NaN", { ...valida, alvoPct: NaN }],
    ["alvo negativo", { ...valida, alvoPct: -2 }],
    ["stop ausente", { ...valida, stopPct: undefined }],
    ["horas zero", { ...valida, horasLimite: 0 }],
    ["praça desconhecida", { ...valida, praca: "binance" }],
    ["papel desconhecido", { ...valida, papel: "ninja" }],
  ])("recusa: %s", (_nome, bruto) => {
    const r = lerEstrategia(bruto);
    expect(r.ok).toBe(false);
    // ⚠️ Motivo vazio manda o cliente adivinhar — é o que deixou o Maker dois
    // dias sem abrir posição sem ninguém saber por quê.
    if (!r.ok) expect(r.porque.length).toBeGreaterThan(8);
  });

  it("⚠️ número que chega como TEXTO é recusado, não convertido", () => {
    // `Number("2.5")` funciona, e é justamente por isso: um campo que chega
    // como texto significa que a rota não normalizou, e converter aqui esconde
    // isso até o dia em que chegar "" e virar 0.
    expect(lerEstrategia({ ...valida, alvoPct: "2.5" }).ok).toBe(false);
  });
});
