import { describe, it, expect } from "vitest";
import {
  rotasDeEventos, classificarRota, agregar, vereditoDoTeto, chaveDaRota,
  type EventoAnomalia, type Classe,
} from "@/lib/zion/descartadas";
import type { Realism } from "@/lib/zion/arb-realism";

/**
 * ⚠️ A PERGUNTA QUE ISTO PROTEGE (17/08). As quatro mesas de arbitragem têm a
 * janela vazia por aritmética — piso 0,55%/0,60% acima do teto 0,30%. A
 * derrapagem do mesmo dia mostrou que o PISO descreve custo real (impacto
 * 0,000% a $50), então quem está sob suspeita é o TETO. Esta medição lê o
 * livro das rotas que o teto descarta.
 */

const ev = (p: Partial<EventoAnomalia> = {}): EventoAnomalia => ({
  symbol: "POL", buy: "gateio", sell: "binance",
  spreadPct: 0.56, acimaDoPiso: true, venues: 5,
  createdAt: "2026-08-17T18:59:08Z",
  ...p,
});

const realismo = (p: Partial<Realism> = {}): Realism => ({
  theoreticalNetPct: 0.16, realisticNetPct: 0.16, slippagePct: 0, fullyFilled: true, ...p,
});

describe("rotasDeEventos — o que entra e o que fica de fora", () => {
  it("descarta as ABAIXO do piso: elas não pagariam nem se fossem reais", () => {
    const r = rotasDeEventos([
      ev({ symbol: "POL", acimaDoPiso: true }),
      ev({ symbol: "NAOPAGA", acimaDoPiso: false }),
    ]);
    expect(r.map((x) => x.symbol)).toEqual(["POL"]);
  });

  it("agrupa por ROTA, não por símbolo — mesma moeda em rotas diferentes são duas", () => {
    const r = rotasDeEventos([
      ev({ buy: "gateio", sell: "binance" }),
      ev({ buy: "kucoin", sell: "binance" }),
    ]);
    expect(r).toHaveLength(2);
    expect(new Set(r.map(chaveDaRota))).toEqual(
      new Set(["POL:gateio>binance", "POL:kucoin>binance"]),
    );
  });

  it("conta anúncios e guarda o MAIOR spread — o caso mais forte da rota", () => {
    // ⚠️ Assimétrico de propósito: com [0,4 · 0,9] o máximo (0,9) difere do
    // mínimo (0,4), da média (0,65) e do último (0,4). Trocar `Math.max` por
    // qualquer um dos três derruba esta asserção — que é o ponto do teste.
    const r = rotasDeEventos([
      ev({ spreadPct: 0.4 }),
      ev({ spreadPct: 0.9 }),
      ev({ spreadPct: 0.4 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].anuncios).toBe(3);
    expect(r[0].spreadTopoPct).toBe(0.9);
  });

  it("guarda a MENOR contagem de venues — a testemunha mais fraca", () => {
    // Mesma lógica invertida: 3 é o mínimo, 7 o máximo, 5 a média.
    const r = rotasDeEventos([
      ev({ venues: 7 }), ev({ venues: 3 }), ev({ venues: 5 }),
    ]);
    expect(r[0].venuesMin).toBe(3);
  });

  it("o último visto é o mais RECENTE, mesmo fora de ordem", () => {
    const r = rotasDeEventos([
      ev({ createdAt: "2026-08-17T19:00:00Z" }),
      ev({ createdAt: "2026-08-17T12:00:00Z" }),
    ]);
    expect(r[0].ultimoEm).toBe("2026-08-17T19:00:00Z");
  });

  it("ordena pelo maior spread primeiro", () => {
    const r = rotasDeEventos([
      ev({ symbol: "BAIXO", spreadPct: 0.4 }),
      ev({ symbol: "ALTO", spreadPct: 0.9 }),
    ]);
    expect(r.map((x) => x.symbol)).toEqual(["ALTO", "BAIXO"]);
  });

  it("ignora evento sem rota completa ou com spread não numérico", () => {
    expect(rotasDeEventos([ev({ sell: "" })])).toHaveLength(0);
    expect(rotasDeEventos([ev({ spreadPct: NaN })])).toHaveLength(0);
  });
});

describe("classificarRota — a delegação ao portão do dinheiro", () => {
  it("livro não lido é CADÁVER, não 'não sei'", () => {
    // ⚠️ A hipótese sob teste é "isto é dado podre". Livro que não responde
    // CONFIRMA a hipótese; tratá-lo como inconclusivo esconderia a resposta.
    const v = classificarRota(null, 0.15);
    expect(v.classe).toBe("cadaver");
    expect(v.motivo).toMatch(/não respondeu|vazio/);
  });

  it("livro sem profundidade para o tamanho é RASO, não cadáver", () => {
    // Não é cotação podre — é liquidez fina. Ações opostas.
    const v = classificarRota(realismo({ fullyFilled: false }), 0.15);
    expect(v.classe).toBe("raso");
  });

  it("líquido real abaixo do mínimo é RASO — a profundidade comeu o spread", () => {
    const v = classificarRota(realismo({ realisticNetPct: 0.05 }), 0.15);
    expect(v.classe).toBe("raso");
  });

  it("líquido real que sobrevive é REAL — o teto barrou dinheiro", () => {
    const v = classificarRota(realismo({ realisticNetPct: 0.2 }), 0.15);
    expect(v.classe).toBe("real");
  });

  it("o mínimo é o do portão: 0,20% passa em 0,15 e reprova em 0,25", () => {
    // A fronteira é do `realismGate`, não desta função. Se alguém fixar um
    // limiar aqui, esta asserção separa as duas.
    const r = realismo({ realisticNetPct: 0.2 });
    expect(classificarRota(r, 0.15).classe).toBe("real");
    expect(classificarRota(r, 0.25).classe).toBe("raso");
  });
});

describe("agregar e o veredito", () => {
  const classes = (r: number, s: number, c: number, nm = 0): Classe[] => [
    ...Array<Classe>(r).fill("real"),
    ...Array<Classe>(s).fill("raso"),
    ...Array<Classe>(c).fill("cadaver"),
    ...Array<Classe>(nm).fill("nao_medido"),
  ];

  it("conta cada classe e o total", () => {
    expect(agregar(classes(2, 3, 4))).toEqual({ real: 2, raso: 3, cadaver: 4, naoMedido: 0, total: 9 });
  });

  it("⚠️ não-medido é contado À PARTE, e entra no total sem virar cadáver", () => {
    expect(agregar(classes(1, 1, 1, 3)))
      .toEqual({ real: 1, raso: 1, cadaver: 1, naoMedido: 3, total: 6 });
  });

  it("sem descarte não há o que julgar", () => {
    expect(vereditoDoTeto(agregar([]), 0.3, 0.55, 50)).toMatch(/não há o que julgar/);
  });

  it("REAL = 0 diz que as mesas estão CORRETAMENTE paradas", () => {
    // ⚠️ A frase importa tanto quanto o número: ela é o que impede a próxima
    // pessoa de mexer no teto só para ver acontecer alguma coisa.
    const t = vereditoDoTeto(agregar(classes(0, 5, 2)), 0.3, 0.55, 50);
    expect(t).toMatch(/corretamente paradas/);
    expect(t).not.toMatch(/há número para discutir/);
  });

  /**
   * ⚠️⚠️ A FRASE "esta estratégia não paga neste custo" SAIU (01/09), e a saída
   * dela é o conserto — não uma perda.
   *
   * A amostra lida são as N rotas de MENOR spread acima do piso. Essa direção é
   * deliberada (se nem as plausíveis sobrevivem, o teto está justificado), mas
   * ela ANTI-SELECIONA por aritmética a única classe capaz de ser REAL: spread
   * grande com livro fundo fica sempre entre as não lidas. "Estas N não pagaram"
   * é o que a amostra sustenta; "esta estratégia não paga" não é.
   */
  it("⚠️ o veredito NÃO generaliza para a estratégia quando a amostra é uma ponta só", () => {
    const t = vereditoDoTeto(agregar(classes(0, 5, 2)), 0.3, 0.55, 50, {
      lidas: 12, noHistorico: 101, regra: "as de MENOR spread acima do piso",
    });
    expect(t).toMatch(/12 de 101/);
    expect(t).toMatch(/MENOR spread/);
    expect(t).not.toMatch(/esta estratégia não paga/);
  });

  it("⚠️ rota não medida sai do denominador da conclusão", () => {
    const t = vereditoDoTeto(agregar(classes(0, 3, 1, 4)), 0.3, 0.55, 50);
    expect(t).toMatch(/das 4 rotas descartadas E MEDIDAS/);  // 3 raso + 1 cadaver
    expect(t).toMatch(/4 rota\(s\) NÃO foram medidas/);
    expect(t).toMatch(/não são cadáver/);
  });

  it("⚠️ TUDO não medido não é 'o teto está certo' — é rodada perdida", () => {
    const t = vereditoDoTeto(agregar(classes(0, 0, 0, 6)), 0.3, 0.55, 50);
    expect(t).toMatch(/rodada perdida/);
    expect(t).not.toMatch(/corretamente paradas/);
  });

  it("REAL > 0 acusa o teto, e NÃO autoriza mexer nele", () => {
    const t = vereditoDoTeto(agregar(classes(3, 5, 2)), 0.3, 0.55, 50);
    expect(t).toMatch(/3 de 10/);
    expect(t).toMatch(/há número para discutir o teto/);
    // Não promete ação: quem troca o gate é gente, fora desta rota.
    expect(t).not.toMatch(/subir|aumentar|liberar/i);
  });

  it("o veredito carrega os DOIS números da janela", () => {
    const t = vereditoDoTeto(agregar(classes(1, 0, 0)), 0.3, 0.55, 50);
    expect(t).toContain("0.30%");
    expect(t).toContain("0.55%");
  });

  /**
   * ⚠️ O "$50" ERA LITERAL enquanto o medido vinha de `ARB_SIZE_USD`. Com a
   * variável em 200, a mesma tela imprimia "$200" no cabeçalho do corte e "$50"
   * no veredito — e a frase é o que alguém copia para uma decisão.
   */
  it("⚠️ o tamanho da frase é o MEDIDO, não um literal", () => {
    expect(vereditoDoTeto(agregar(classes(0, 2, 0)), 0.3, 0.55, 200)).toContain("$200");
    expect(vereditoDoTeto(agregar(classes(0, 2, 0)), 0.3, 0.55, 200)).not.toContain("$50");
  });
});

describe("⚠️ a quarta classe: livro que ninguém olhou não é cadáver", () => {
  /**
   * ⚠️⚠️ O DEFEITO DE 31/08. `fetchOrderbook` devolvia o mesmo `null` para 429,
   * timeout, e para a kraken — que não tinha adaptador e nem chegava a fazer a
   * chamada. Tudo virava CADÁVER, e o veredito citava o número como prova de
   * que "o teto está barrando o que o livro barraria de qualquer forma".
   */
  it("praça sem adaptador é NÃO MEDIDO, nunca cadáver", () => {
    const v = classificarRota(null, 0.15, "sem_adaptador");
    expect(v.classe).toBe("nao_medido");
    expect(v.motivo).toMatch(/não diz nada sobre o mercado/);
  });

  it("429 e queda de rede também são NÃO MEDIDO", () => {
    expect(classificarRota(null, 0.15, "http").classe).toBe("nao_medido");
    expect(classificarRota(null, 0.15, "rede").classe).toBe("nao_medido");
  });

  it("⚠️ mas livro que a praça respondeu VAZIO continua sendo cadáver", () => {
    const v = classificarRota(null, 0.15, "vazio");
    expect(v.classe).toBe("cadaver");
    expect(v.motivo).toMatch(/respondeu e o livro veio vazio/);
  });

  it("⚠️ sem motivo declarado, o padrão continua cadáver — não afrouxa calado", () => {
    expect(classificarRota(null, 0.15).classe).toBe("cadaver");
  });
});
