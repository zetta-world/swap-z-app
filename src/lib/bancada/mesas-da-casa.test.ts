/**
 * ⚠️⚠️ O QUE NÃO PODE APARECER PARA UM CLIENTE PAGANTE.
 *
 * Estas mesas levam o nome da casa. Uma delas na vitrine com o número errado —
 * ou uma que a própria casa mediu como perdedora — não é um bug de tela: é uma
 * promessa falsa a quem está pagando.
 */
import { describe, it, expect } from "vitest";
import {
  mesasElegiveis, montarCartao, mereceCartao, custoIdaEVoltaDaMesa, RESSALVAS,
  DECIDIDOS_PARA_SUSTENTAR, mesaPodeRodar, ressalvasComuns, ressalvasSoDeste,
  type MedicaoDaMesa, type CartaoDaMesa,
} from "@/lib/bancada/mesas-da-casa";
import { DESKS, deskFor } from "@/lib/zion/desks";

function medicao(p: Partial<MedicaoDaMesa> = {}): MedicaoDaMesa {
  return {
    source: "strat_dex", decididos: 335, alvo: 266, stop: 69, expiradas: 57,
    brutoPorOpPct: 4.944, simbolos: 14, dias: 24,
    primeiroDia: "2026-08-03", ultimoDia: "2026-09-06", ...p,
  };
}

describe("⚠️ quem entra na vitrine", () => {
  it("nenhuma mesa com CÉREBRO de modelo entra", () => {
    // 3.300 decisões mediram LLM prevendo direção de −6,7 a −30,4 pontos ABAIXO
    // do passeio aleatório. Os números confirmam: grok −0,99%/op, kimi −1,22.
    // Oferecer uma dessas seria vender o que a própria casa aposentou.
    for (const m of mesasElegiveis()) expect(m.brain, m.name).toBe("none");
    const nomes = mesasElegiveis().map((m) => m.source);
    for (const proibida of ["grok_scan", "kimi_scan", "mistral_scan", "self_scan", "deepseek_scan", "strat_ai"]) {
      expect(nomes, proibida).not.toContain(proibida);
    }
  });

  it("nenhuma mesa ARQUIVADA entra — Valhalla é história, não produto", () => {
    for (const m of mesasElegiveis()) expect(m.status, m.name).toBe("live");
  });

  it("as quatro mecânicas do torneio estão lá", () => {
    const nomes = mesasElegiveis().map((m) => m.source);
    for (const viva of ["strat_mech", "strat_dex", "strat_day", "radar"]) {
      expect(nomes, viva).toContain(viva);
    }
  });

  it("⚠️ toda mesa elegível tem ficha — caixa-preta não vai para vitrine", () => {
    for (const m of mesasElegiveis()) expect(m.sheet, m.name).toBeDefined();
  });
});

describe("⚠️ o custo descontado é o da PRAÇA da mesa", () => {
  it("DEX paga mais que CEX, e a diferença não é decorativa", () => {
    // Foi uma taxa única aplicada a todo mundo que aposentou o Maker por engano.
    expect(custoIdaEVoltaDaMesa("dex")).toBeCloseTo(0.60, 6);
    expect(custoIdaEVoltaDaMesa("cex")).toBeCloseTo(0.40, 6);
  });

  it("a FREYJA é da DEX, então desconta 0,60 — não 0,40", () => {
    const freyja = deskFor("strat_dex")!;
    expect(freyja.venue).toBe("dex");
    const c = montarCartao(freyja, medicao());
    expect(c.liquidoPorOpPct!).toBeCloseTo(4.944 - 0.60, 3);
  });
});

describe("⚠️⚠️ a ressalva viaja com o número, sempre", () => {
  it("expectância por operação NUNCA sai sozinha", () => {
    const c = montarCartao(deskFor("strat_dex")!, medicao());
    expect(c.ressalvas).toContain(RESSALVAS.porOperacao);
  });

  it("mais de um símbolo acusa correlação — n independente << n contado", () => {
    expect(montarCartao(deskFor("strat_dex")!, medicao({ simbolos: 14 })).ressalvas)
      .toContain(RESSALVAS.correlacao);
    expect(montarCartao(deskFor("strat_dex")!, medicao({ simbolos: 1 })).ressalvas)
      .not.toContain(RESSALVAS.correlacao);
  });

  it("janela curta acusa regime único", () => {
    expect(montarCartao(deskFor("strat_dex")!, medicao({ dias: 24 })).ressalvas)
      .toContain(RESSALVAS.umRegime);
    expect(montarCartao(deskFor("strat_dex")!, medicao({ dias: 400 })).ressalvas)
      .not.toContain(RESSALVAS.umRegime);
  });

  it("⚠️ a mesa que EXPIRA mais do que decide diz isso", () => {
    // SKAÐI: 185 expiradas contra 128 decididas. Mais da metade dos sinais
    // morre de relógio, não de tese — quem lê só "acertou 49%" não sabe.
    const skadi = deskFor("strat_day")!;
    const c = montarCartao(skadi, medicao({ source: "strat_day", decididos: 128, alvo: 63, stop: 65, expiradas: 185 }));
    expect(c.ressalvas).toContain(RESSALVAS.expiraMuito);
  });

  it("⚠️ abaixo do limiar o número NÃO sustenta veredito", () => {
    const poucos = montarCartao(deskFor("strat_dex")!, medicao({ decididos: DECIDIDOS_PARA_SUSTENTAR - 1, alvo: 80, stop: 19 }));
    expect(poucos.sustentacao).toBe("ruido");
    expect(poucos.ressalvas).toContain(RESSALVAS.amostraCurta);

    const bastantes = montarCartao(deskFor("strat_dex")!, medicao({ decididos: DECIDIDOS_PARA_SUSTENTAR }));
    expect(bastantes.sustentacao).toBe("sustenta");
    expect(bastantes.ressalvas).not.toContain(RESSALVAS.amostraCurta);
  });

  it("⚠️ sem medição não há número inventado", () => {
    const c = montarCartao(deskFor("strat_dex")!, null);
    expect(c.liquidoPorOpPct).toBeNull();
    expect(c.acertoPct).toBeNull();
    expect(c.sustentacao).toBe("ruido");
  });

  it("zero decididos não vira divisão por zero nem 0%", () => {
    const c = montarCartao(deskFor("strat_dex")!, medicao({ decididos: 0, alvo: 0, stop: 0 }));
    expect(c.acertoPct).toBeNull();
    expect(c.liquidoPorOpPct).toBeNull();
  });
});

describe("a aritmética do cartão bate com a medição", () => {
  it("acerto e líquido saem dos números crus, sem arredondar antes", () => {
    const c = montarCartao(deskFor("strat_mech")!, medicao({
      source: "strat_mech", decididos: 323, alvo: 201, stop: 122, expiradas: 21, brutoPorOpPct: 2.771,
    }));
    expect(c.acertoPct!).toBeCloseTo(62.23, 1);
    expect(c.liquidoPorOpPct!).toBeCloseTo(2.371, 3);   // CEX: −0,40
    expect(c.sustentacao).toBe("sustenta");
  });

  it("⚠️ o cartão carrega a JANELA junto — número sem data é propaganda", () => {
    const c = montarCartao(deskFor("strat_dex")!, medicao());
    expect(c.medicao!.primeiroDia).toBe("2026-08-03");
    expect(c.medicao!.dias).toBe(24);
    expect(c.medicao!.simbolos).toBe(14);
  });
});

describe("o registro de mesas não regrediu", () => {
  it("toda mesa VIVA tem `tests` e `subtitle` — a vitrine lê os dois", () => {
    for (const d of DESKS.filter((x) => x.status === "live")) {
      expect(d.tests.length, d.name).toBeGreaterThan(5);
      expect(d.subtitle.length, d.name).toBeGreaterThan(5);
    }
  });
});

describe("⚠️⚠️ quem é medido em OUTRO livro não vira card", () => {
  it("os quatro arbitradores passam em `mesasElegiveis` e NÃO merecem card", () => {
    // Eles são mecânicos e vivos, então passam no primeiro filtro. Mas são
    // julgados na carteira de USDT, não em `zion_suggestions` — e a arbitragem
    // está morta desde 03/08. Um card "ainda sem operação decidida" afirmaria
    // que não foram medidas, quando o certo é que são medidas em outro lugar.
    const nomes = mesasElegiveis().map((m) => m.source);
    for (const arb of ["arbiter", "arbiter2", "arbiter2_3x", "arbiter2_5x"]) {
      expect(nomes, arb).toContain(arb);
    }
    expect(mereceCartao(null)).toBe(false);
    expect(mereceCartao(medicao({ decididos: 0, alvo: 0, stop: 0, expiradas: 0 }))).toBe(false);
  });

  it("uma mesa que só expirou AINDA merece card — expirar é um resultado", () => {
    // A ULLR tem 1 decidida e 7 expiradas. Some-la esconderia que ela roda.
    expect(mereceCartao(medicao({ decididos: 0, alvo: 0, stop: 0, expiradas: 7 }))).toBe(true);
  });
});

describe("⚠️⚠️ a linha mais perigosa do banco: uma operação, +17,40%", () => {
  it("a ULLR não ganha cor de veredito, e a ressalva de amostra aparece", () => {
    // Este é o numero que, pintado de verde num card, viraria promessa. Ele
    // vem de UMA operação.
    const ullr = deskFor("ullr_launch")!;
    const c = montarCartao(ullr, medicao({
      source: "ullr_launch", decididos: 1, alvo: 1, stop: 0, expiradas: 7,
      brutoPorOpPct: 18.0, simbolos: 5, dias: 3,
    }));
    expect(c.liquidoPorOpPct!).toBeCloseTo(17.40, 2);   // DEX: −0,60
    expect(c.sustentacao).toBe("ruido");
    expect(c.ressalvas).toContain(RESSALVAS.amostraCurta);
  });
});

/**
 * ⚠️⚠️ O BOTÃO "RODAR ESTA" NÃO PODE PROMETER O QUE `mesa-real.ts` NÃO FAZ.
 *
 * ACHADO NO BANCO (07/09), não na leitura: o dono rodou ULLR e depois FREYJA
 * sobre BTC/365d e as duas devolveram `+2,140788280112371%` — idêntico até a
 * última casa decimal, uma operação cada. `rodarMesa` não recebe a mesa: ela
 * roda UM caminho (o cardápio de `candidateAttempts`, política "primeiro
 * playbook com plano") e o nome da mesa era só o rótulo por cima.
 *
 * A trava aqui é um CENSO, de propósito. Ela não checa uma regra abstrata —
 * ela conta quantas mesas o botão oferece, e obriga quem aumentar esse número a
 * ter ensinado `mesa-real.ts` a política da mesa nova primeiro.
 */
describe("só roda a mesa que a rodada de fato reproduz", () => {
  it("o botão é oferecido em DUAS mesas, e são estas", () => {
    const rodaveis = mesasElegiveis().filter((d) => mesaPodeRodar(d.source)).map((d) => d.source);
    expect(rodaveis).toEqual(["strat_mech", "strat_dex"]);
  });

  it("as oito restantes seguem elegíveis para a VITRINE — não sumiram", () => {
    // ⚠️ Tirar o botão não é tirar a mesa. O card, a medição e as ressalvas são
    // honestos e são o produto; o que saiu foi a promessa de reproduzi-la.
    const soVitrine = mesasElegiveis().filter((d) => !mesaPodeRodar(d.source));
    expect(soVitrine.length).toBe(8);
  });

  /**
   * ⚠️ AS QUATRO NOMEADAS, uma a uma, com o motivo. Um `expect(x).toBe(false)`
   * sobre uma lista genérica passaria mesmo que a lista tivesse esvaziado.
   */
  it.each([
    // caça pool recém-nascida (2–48h, TVL ≥ US$80 mil), bracket fixo 18%/9%
    ["ullr_launch"],
    // ordena candidatos pelo histórico medido e VETA os negativos no regime
    ["strat_record"],
    // filtro de clima + revalidação da geometria no prazo curto
    ["strat_day"],
    // spread/funding: não toma trade direcional nenhum, e é julgada noutro livro
    ["arbiter2"],
  ])("%s não roda: a regra dela ao vivo não é a que a bancada reproduz", (source) => {
    expect(mesaPodeRodar(source)).toBe(false);
    // ⚠️ E ela continua existindo como mesa — senão este teste passaria por um
    // motivo errado (a mesa sumiu do catálogo).
    expect(deskFor(source)).not.toBeUndefined();
  });

  it("o cartão carrega a decisão, e a ressalva do seletor partilhado vem junto", () => {
    const rodavel = montarCartao(deskFor("strat_dex")!, medicao());
    expect(rodavel.podeRodar).toBe(true);
    expect(rodavel.ressalvas).toContain(RESSALVAS.mesmoSeletor);

    const vitrine = montarCartao(deskFor("ullr_launch")!, medicao({ source: "ullr_launch" }));
    expect(vitrine.podeRodar).toBe(false);
    // ⚠️ Sem botão, a frase não teria a que se referir — e ressalva sem
    // referente ensina o cliente a ignorar as que importam.
    expect(vitrine.ressalvas).not.toContain(RESSALVAS.mesmoSeletor);
  });
});

/**
 * ⚠️⚠️ AS MESMAS 4 RESSALVAS × 10 CARDS (07/09).
 *
 * O dono, com prints: *"está uma bagunça horrível... jogando informações em
 * cima de informações"*. Uma auditoria mediu: 40 elementos de lista tirados de
 * 4 frases, ~4.000 caracteres de texto idêntico numa rolagem de celular.
 *
 * E a repetição não protegia — treinava o leitor a pular a borda cinza inteira,
 * inclusive nos cards em que a ressalva MUDAVA. O corte é por INTERSEÇÃO, e é
 * isso que garante que nada suma: o que vale para todos vira nota da seção; o
 * que distingue continua no card.
 */
describe("a ressalva comum a todos é dita uma vez; a que distingue fica no card", () => {
  const cartao = (ressalvas: string[]): CartaoDaMesa =>
    ({ ...montarCartao(deskFor("strat_dex")!, medicao()), ressalvas } as CartaoDaMesa);

  it("o que os três compartilham sai como comum", () => {
    const cs = [
      cartao([RESSALVAS.porOperacao, RESSALVAS.correlacao, RESSALVAS.expiraMuito]),
      cartao([RESSALVAS.porOperacao, RESSALVAS.correlacao]),
      cartao([RESSALVAS.porOperacao, RESSALVAS.correlacao, RESSALVAS.amostraCurta]),
    ];
    expect(ressalvasComuns(cs).sort()).toEqual([RESSALVAS.correlacao, RESSALVAS.porOperacao].sort());
  });

  /**
   * ⚠️ A ASSERÇÃO QUE IMPORTA: NADA SOME. Toda ressalva de todo card aparece
   * ou na nota da seção, ou no próprio card — nunca em lugar nenhum.
   */
  it("nenhuma ressalva desaparece: comum ∪ do-card = o conjunto original", () => {
    const cs = [
      cartao([RESSALVAS.porOperacao, RESSALVAS.correlacao, RESSALVAS.expiraMuito]),
      cartao([RESSALVAS.porOperacao, RESSALVAS.correlacao]),
      cartao([RESSALVAS.porOperacao, RESSALVAS.umRegime]),
    ];
    const comuns = ressalvasComuns(cs);
    for (const c of cs) {
      const mostradas = [...comuns, ...ressalvasSoDeste(c, comuns)];
      expect(new Set(mostradas)).toEqual(new Set([...comuns, ...c.ressalvas]));
      for (const r of c.ressalvas) expect(mostradas).toContain(r);
    }
  });

  it("a que só um card tem NUNCA vira nota da seção", () => {
    const cs = [
      cartao([RESSALVAS.porOperacao, RESSALVAS.expiraMuito]),
      cartao([RESSALVAS.porOperacao]),
    ];
    expect(ressalvasComuns(cs)).not.toContain(RESSALVAS.expiraMuito);
    expect(ressalvasSoDeste(cs[0], ressalvasComuns(cs))).toEqual([RESSALVAS.expiraMuito]);
  });

  it("com um card só, nada é promovido — a nota longe do número não ajuda", () => {
    expect(ressalvasComuns([cartao([RESSALVAS.porOperacao])])).toEqual([]);
  });

  it("sem interseção, o rodapé fica vazio e cada card mantém as suas", () => {
    const cs = [cartao([RESSALVAS.porOperacao]), cartao([RESSALVAS.umRegime])];
    expect(ressalvasComuns(cs)).toEqual([]);
    expect(ressalvasSoDeste(cs[0], [])).toEqual([RESSALVAS.porOperacao]);
  });
});
