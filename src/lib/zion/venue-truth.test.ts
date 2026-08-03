import { describe, it, expect } from "vitest";
import { measureVenues, classifyVenue, truthVerdict, type VenueQuote } from "@/lib/zion/venue-truth";

/**
 * A CONFERÊNCIA MANUAL, AUTOMATIZADA.
 *
 * A auditoria da coorte concluiu que o spread de 0.7% que as mesas capturavam
 * era ruído do feed de uma corretora. A verificação final proposta era abrir as
 * duas corretaras lado a lado e olhar. Isto faz o mesmo, com número, sempre.
 *
 * A distinção inteira mora em UMA coisa: desvio COM sinal é praça diferente;
 * desvio SEM sinal é feed oscilando. Um par isolado nunca separa os dois — só a
 * mediana de três ou mais, repetida em muitos símbolos.
 */

const q = (venue: string, priceUsd: number): VenueQuote => ({ venue, priceUsd });

describe("classificar uma venue pelo par (viés, dispersão)", () => {
  it("desvio pequeno é ESTÁVEL, mesmo sem sinal nenhum", () => {
    // Oscilar 0.02% em volta das outras é normal. Chamar isso de ruidosa
    // produziria alarme onde não há defeito.
    expect(classifyVenue(0.001, 0.02)).toBe("estável");
  });

  it("desvio grande COM sinal é praça diferente, não defeito", () => {
    // Sempre mais cara: pode ser taxa, liquidez, par de cotação. É real.
    expect(classifyVenue(0.5, 0.52)).toBe("cara");
    expect(classifyVenue(-0.5, 0.52)).toBe("barata");
  });

  it("desvio grande SEM sinal é RUÍDO — a assinatura que a coorte viu", () => {
    // Ora acima, ora abaixo: os positivos cancelam os negativos no viés, mas a
    // dispersão continua grande. É preço oscilando, não praça própria.
    expect(classifyVenue(0.02, 0.7)).toBe("ruidosa");
  });
});

describe("medir contra a mediana", () => {
  it("a venue que oscila aparece com dispersão alta e viés perto de zero", () => {
    // `oscila` fica 0.7% acima num símbolo e 0.7% abaixo no outro — exatamente
    // o padrão de aparecer nos DOIS lados das pernas de arbitragem.
    const m = new Map<string, VenueQuote[]>([
      ["BTC", [q("a", 100), q("b", 100), q("oscila", 100.7)]],
      ["ETH", [q("a", 100), q("b", 100), q("oscila", 99.3)]],
    ]);
    const s = measureVenues(m).find((x) => x.venue === "oscila")!;
    expect(s.verdict).toBe("ruidosa");
    expect(Math.abs(s.biasPct)).toBeLessThan(0.1);
    expect(s.dispersionPct).toBeGreaterThan(0.6);
  });

  it("a venue consistentemente barata NÃO é confundida com ruidosa", () => {
    // Esta distinção é o valor inteiro do módulo: condenar uma praça
    // genuinamente mais barata mataria a única arbitragem real que existisse.
    const m = new Map<string, VenueQuote[]>([
      ["BTC", [q("a", 100), q("b", 100), q("barata", 99.3)]],
      ["ETH", [q("a", 100), q("b", 100), q("barata", 99.3)]],
    ]);
    const s = measureVenues(m).find((x) => x.venue === "barata")!;
    expect(s.verdict).toBe("barata");
    expect(s.biasPct).toBeLessThan(0);
  });

  it("símbolo com menos de 3 cotações é IGNORADO, não incluído com zero", () => {
    // Com duas, cada uma fica à mesma distância da 'mediana' por construção. O
    // cálculo rodaria e devolveria simetria falsa — zeros disfarçados de medição.
    const m = new Map<string, VenueQuote[]>([["BTC", [q("a", 100), q("b", 101)]]]);
    expect(measureVenues(m)).toEqual([]);
  });

  it("cotação inválida não entra na conta", () => {
    const m = new Map<string, VenueQuote[]>([
      ["BTC", [q("a", 100), q("b", 100), q("c", 100.1), q("morta", 0)]],
    ]);
    expect(measureVenues(m).some((s) => s.venue === "morta")).toBe(false);
  });

  it("ordena pela dispersão — a pior primeiro", () => {
    const m = new Map<string, VenueQuote[]>([
      ["BTC", [q("calma", 100), q("media", 100.1), q("doida", 102)]],
      ["ETH", [q("calma", 100), q("media", 99.9), q("doida", 98)]],
    ]);
    expect(measureVenues(m)[0].venue).toBe("doida");
  });
});

describe("o veredito em uma frase", () => {
  it("diz explicitamente quando NENHUMA venue chega perto do spread exigido", () => {
    // Este é o resultado que encerra a questão: se o maior desvio observado é
    // 0.03% e a mesa exige 0.60%, o spread que ela capturava não existia.
    const m = new Map<string, VenueQuote[]>([
      ["BTC", [q("a", 100), q("b", 100.02), q("c", 99.98)]],
      ["ETH", [q("a", 100), q("b", 100.03), q("c", 99.97)]],
    ]);
    const v = truthVerdict(measureVenues(m), 0.6);
    expect(v).toContain("não estava no mercado");
  });

  it("nomeia a venue ruidosa quando existe uma", () => {
    const m = new Map<string, VenueQuote[]>([
      ["BTC", [q("a", 100), q("b", 100), q("gateio", 100.8)]],
      ["ETH", [q("a", 100), q("b", 100), q("gateio", 99.2)]],
    ]);
    expect(truthVerdict(measureVenues(m), 0.6)).toContain("gateio");
  });

  it("sem amostra, diz que não mediu — não devolve frase tranquilizadora", () => {
    // "Inconclusivo" nunca pode sair parecido com "está tudo bem".
    expect(truthVerdict([], 0.6)).toContain("sem cotações suficientes");
  });
});
