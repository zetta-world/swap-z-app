import { describe, it, expect } from "vitest";
import { measureVenues, measureSymbols, classifyVenue, truthVerdict, type VenueQuote } from "@/lib/zion/venue-truth";

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
  it("diz que nenhum símbolo passa do piso — SEM afirmar que nunca passa", () => {
    // A frase antiga era "o spread não estava no mercado", e ela encerrava o
    // assunto. Estava errada por excesso: mede UM instante, e as mesas operavam
    // altcoin de livro fino, onde o gap ia e voltava ao longo do dia.
    const m = new Map<string, VenueQuote[]>([
      ["BTC", [q("a", 100), q("b", 100.02), q("c", 99.98)]],
      ["ETH", [q("a", 100), q("b", 100.03), q("c", 99.97)]],
    ]);
    const v = truthVerdict(measureVenues(m), 0.6, measureSymbols(m));
    expect(v).toContain("nenhum símbolo");
    expect(v).toContain("UM instante");
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

/**
 * O DEFEITO QUE A PRIMEIRA VERSÃO DESTE MÓDULO TINHA — e que ele mesmo escondia.
 *
 * `measureVenues` mediu ao vivo e devolveu dispersão de 0.02% a 0.055%, todas
 * "estáveis". Concluí que não existia spread de 0.55% em lugar nenhum.
 *
 * O ledger dizia outra coisa: 2.011 ciclos entraram com spread médio de 0.72%,
 * e os símbolos eram MANA, SAND, RUNE, IMX, GRT, BONK, SHIB — altcoin de livro
 * fino, nenhum major. MANA sozinha disparou em 144 horas DISTINTAS: persistente,
 * não um instante ruim.
 *
 * Os dois números não se contradizem. A média entre 57 símbolos é dominada
 * pelos majors; a estratégia selecionava a CAUDA, por construção, porque é a
 * cauda que passa do portão. Medir a média de uma população quando a estratégia
 * escolhe o extremo dela responde a pergunta ao lado da que importa — e uma
 * verificação assim é pior que nenhuma, porque encerra o assunto.
 */
describe("por símbolo — a cauda que a média esconde", () => {
  // Uma carteira realista: muitos majors colados, uma altcoin descolada.
  const mercado = () => new Map<string, VenueQuote[]>([
    ["BTC",  [q("binance", 100), q("okx", 100.01), q("gateio", 100.02)]],
    ["ETH",  [q("binance", 100), q("okx", 100.02), q("gateio", 99.99)]],
    ["SOL",  [q("binance", 100), q("okx", 99.98), q("gateio", 100.01)]],
    ["BNB",  [q("binance", 100), q("okx", 100.01), q("gateio", 99.99)]],
    ["MANA", [q("binance", 100), q("okx", 100.02), q("gateio", 100.75)]],
  ]);

  it("a MÉDIA por venue não acusa nada — foi exatamente o que me enganou", () => {
    // Uma altcoin descolada em cinco símbolos dilui para ~0.15% de dispersão.
    const gateio = measureVenues(mercado()).find((s) => s.venue === "gateio")!;
    expect(gateio.dispersionPct).toBeLessThan(0.3);
  });

  it("por SÍMBOLO, a mesma carteira mostra o gap na cara", () => {
    const gaps = measureSymbols(mercado());
    expect(gaps[0].symbol).toBe("MANA");
    expect(gaps[0].gapPct).toBeGreaterThan(0.7);
    expect(gaps[0].outlier).toBe("gateio");
  });

  it("o veredito NOMEIA os símbolos acima do piso em vez de dizer que está tudo bem", () => {
    // A frase antiga ("nenhuma venue se afasta o bastante") era verdadeira e
    // encerrava o assunto pelo lado errado.
    const v = truthVerdict(measureVenues(mercado()), 0.55, measureSymbols(mercado()));
    expect(v).toContain("MANA");
    expect(v).toContain("acima do piso");
    // E não deixa "existe gap" virar "existe oportunidade": livro fino produz o
    // mesmo número sem ser executável no tamanho.
    expect(v).toContain("executável");
  });

  it("sem símbolo acima do piso, o veredito ainda ressalva que é UM instante", () => {
    // O gap dessas mesas aparecia em altcoin e ia e voltava. Uma leitura limpa
    // agora não prova que ele não volta em dez minutos.
    const calmo = new Map<string, VenueQuote[]>([
      ["BTC", [q("a", 100), q("b", 100.01), q("c", 99.99)]],
      ["ETH", [q("a", 100), q("b", 100.02), q("c", 99.98)]],
    ]);
    const v = truthVerdict(measureVenues(calmo), 0.55, measureSymbols(calmo));
    expect(v).toContain("UM instante");
  });

  it("o gap é a maior distância entre DUAS cotações — o que o detector veria", () => {
    // Não o desvio contra a mediana: o detector pareia o extremo baixo com o
    // extremo alto, e é esse número que vira spread capturado.
    const m = new Map<string, VenueQuote[]>([["X", [q("a", 100), q("b", 101), q("c", 100.5)]]]);
    expect(measureSymbols(m)[0].gapPct).toBeCloseTo(1, 6);
  });
});
