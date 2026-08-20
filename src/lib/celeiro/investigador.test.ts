import { describe, it, expect } from "vitest";
import { promptDoInvestigador, lerResposta, placarDosModelos, type MutacaoJulgada } from "@/lib/celeiro/investigador";
import { extratoDe, type Fluxo } from "@/lib/celeiro/fluxo";

/**
 * O INVESTIGADOR — os testes que impedem a IA de voltar a adivinhar.
 *
 * ⚠️ A medição que criou este módulo: seis modelos, 3.300 decisões, alpha de
 * −6,7 a −30,4 pp contra um passeio aleatório. Previsão de direção por LLM é
 * PIOR que moeda. O erro nunca foi o modelo — foi a pergunta.
 */

const GENOMA = { tetoDerrapagemPct: 0.15, minimoDePeriodos: 90, parAlvo: "BTC" };

function extratoVazando() {
  const fluxos: Fluxo[] = [
    { agente: "maker", causa: "preco", usdt: 6, ocorreuEmMs: 0 },
    { agente: "maker", causa: "taxa", usdt: -8.5, ocorreuEmMs: 0 },
    { agente: "maker", causa: "derrapagem", usdt: -1.5, ocorreuEmMs: 0 },
  ];
  return extratoDe("maker", fluxos);
}

describe("o prompt", () => {
  /**
   * ⚠️ ELE ENTREGA A CONTA E NÃO A CONCLUSÃO. Se o texto dissesse "perdeu
   * porque a taxa está alta", o modelo leria a conclusão pronta e o trabalho
   * viraria concordar — foi assim que a arena antiga fez 18 lições em prosa.
   */
  it("mostra a decomposição sem dizer a causa", () => {
    const p = promptDoInvestigador(extratoVazando(), GENOMA, 42);
    expect(p).toContain("taxa: -8.5000 USDT");
    expect(p).toContain("preco: 6.0000 USDT");
    expect(p).toContain("42 lançamentos");
    // A conta aparece; a conclusão, não.
    expect(p.toLowerCase()).not.toContain("porque a taxa");
  });

  /** O modelo precisa ver o que pode mudar, senão propõe parâmetro inexistente. */
  it("entrega o genoma atual", () => {
    const p = promptDoInvestigador(extratoVazando(), GENOMA, 10);
    expect(p).toContain("tetoDerrapagemPct");
    expect(p).toContain("parAlvo");
  });

  /**
   * ⚠️ AS TRÊS REGRAS QUE FAZEM O A/B SER LEGÍVEL têm de estar no prompt, não
   * só no validador: um modelo que só descobre a regra sendo recusado gasta
   * chamada à toa.
   */
  it("declara as regras que o validador vai cobrar", () => {
    const p = promptDoInvestigador(extratoVazando(), GENOMA, 10);
    expect(p).toContain("EXATAMENTE UM parâmetro");
    expect(p).toContain("citar um número");
    expect(p).toContain("ANTES");
    expect(p).toContain('"hipotese":""');   // o "não sei" é oferecido
  });
});

describe("a leitura da resposta", () => {
  const boa = JSON.stringify({
    hipotese: "a taxa levou 8,50 USDT, 85% de todo o vazamento",
    diff: { tetoDerrapagemPct: 0.08 },
    esperado: "menos operações, taxa cai abaixo de 5 USDT e o líquido sobe",
  });

  it("aceita uma proposta bem formada", () => {
    const l = lerResposta(boa, GENOMA);
    expect(l.ok).toBe(true);
    if (l.ok) {
      expect(l.proposta.diff).toEqual({ tetoDerrapagemPct: 0.08 });
      expect(l.proposta.hipotese).toContain("8,50");
    }
  });

  it("acha o JSON dentro de texto solto", () => {
    const l = lerResposta(`Claro! Segue:\n\`\`\`json\n${boa}\n\`\`\`\nEspero ajudar.`, GENOMA);
    expect(l.ok).toBe(true);
  });

  /**
   * ⚠️⚠️ "NÃO SEI" É RESPOSTA VÁLIDA E TEM RECUSA PRÓPRIA. Um Investigador
   * obrigado a sempre propor algo aprende a INVENTAR — e proposta inventada
   * custa capital de teste real. Agregá-la a "devolveu lixo" trataria igual
   * duas coisas opostas.
   */
  it("honestidade e lixo são recusas diferentes", () => {
    const naoSei = lerResposta('{"hipotese":"","diff":{},"esperado":""}', GENOMA);
    expect(naoSei).toEqual({ ok: false, recusa: "sem_hipotese", porque: expect.stringContaining("não sustenta") });

    const lixo = lerResposta("desculpe, não consigo ajudar", GENOMA);
    expect(lixo.ok).toBe(false);
    if (!lixo.ok) expect(lixo.recusa).toBe("json_ilegivel");
  });

  /**
   * ⚠️ HIPÓTESE SEM NÚMERO É NARRATIVA. Corta a categoria inteira que produziu
   * 18 lições em prosa e zero resultado medido.
   */
  it("recusa hipótese sem número", () => {
    const semNumero = JSON.stringify({
      hipotese: "a taxa está alta demais para este agente",
      diff: { tetoDerrapagemPct: 0.08 },
      esperado: "o líquido melhora",
    });
    const l = lerResposta(semNumero, GENOMA);
    expect(l.ok).toBe(false);
    if (!l.ok) expect(l.recusa).toBe("hipotese_sem_numero");
  });

  /**
   * ⚠️ DOIS PARÂMETROS TORNAM O A/B ILEGÍVEL: se pagar, não se sabe qual pagou;
   * se não pagar, não se sabe qual atrapalhou. Teste que não isola não é teste.
   */
  it("recusa mudança de dois parâmetros de uma vez", () => {
    const dois = JSON.stringify({
      hipotese: "taxa 8,50 e derrapagem 1,50 juntas",
      diff: { tetoDerrapagemPct: 0.08, minimoDePeriodos: 120 },
      esperado: "líquido sobe",
    });
    const l = lerResposta(dois, GENOMA);
    expect(l.ok).toBe(false);
    if (!l.ok) expect(l.recusa).toBe("diff_multiplo");
  });

  it("recusa parâmetro que não existe no genoma", () => {
    const inventado = JSON.stringify({
      hipotese: "vazou 8,50 em taxa", diff: { alavancagem: 3 }, esperado: "sobe",
    });
    const l = lerResposta(inventado, GENOMA);
    expect(l.ok).toBe(false);
    if (!l.ok) expect(l.recusa).toBe("parametro_desconhecido");
  });

  /**
   * ⚠️ MUTAÇÃO QUE NÃO MUDA NADA GASTARIA UM CICLO INTEIRO DE A/B para provar
   * que dois braços idênticos rendem igual — e o veredito "não pagou"
   * culparia o modelo por uma não-mudança.
   */
  it("recusa valor igual ao que já está no genoma", () => {
    const igual = JSON.stringify({
      hipotese: "taxa levou 8,50", diff: { tetoDerrapagemPct: 0.15 }, esperado: "sobe",
    });
    const l = lerResposta(igual, GENOMA);
    expect(l.ok).toBe(false);
    if (!l.ok) expect(l.recusa).toBe("valor_invalido");
  });

  /**
   * ⚠️ SEM `esperado`, QUALQUER DESFECHO VIRA ACERTO. É a diferença entre
   * hipótese e narrativa lida depois do fato.
   */
  it("recusa proposta sem resultado previsto", () => {
    const semEsperado = JSON.stringify({
      hipotese: "taxa levou 8,50", diff: { tetoDerrapagemPct: 0.08 }, esperado: "",
    });
    const l = lerResposta(semEsperado, GENOMA);
    expect(l.ok).toBe(false);
    if (!l.ok) expect(l.recusa).toBe("sem_esperado");
  });
});

describe("o placar dos modelos", () => {
  /**
   * ⚠️⚠️ PONTUADO PELO CAIXA, NÃO PELO TEXTO NEM PELA CONTAGEM. É o ponto
   * inteiro do Investigador.
   *
   * Os números distinguem de propósito: `falador` tem MAIS mutações que pagaram
   * (3 contra 1) e mesmo assim perde, porque as dele somam +3 USDT e a única do
   * `seco` somou +40. Se alguém trocar a ordenação por contagem de acertos, o
   * ranking inverte e este teste quebra.
   */
  it("ordena por USDT gerado, não por quantas vezes acertou", () => {
    const j: MutacaoJulgada[] = [
      { modelo: "falador", veredito: "pagou", diferenca: 1 },
      { modelo: "falador", veredito: "pagou", diferenca: 1 },
      { modelo: "falador", veredito: "pagou", diferenca: 1 },
      { modelo: "seco", veredito: "pagou", diferenca: 40 },
      { modelo: "seco", veredito: "nao_pagou", diferenca: -2 },
    ];
    const p = placarDosModelos(j);
    expect(p[0].modelo).toBe("seco");
    expect(p[0].usdtGerado).toBeCloseTo(38, 9);
    expect(p[0].pagou).toBe(1);
    expect(p[1].modelo).toBe("falador");
    expect(p[1].pagou).toBe(3);
  });

  /**
   * ⚠️ INCONCLUSIVA NÃO CONTA PARA NENHUM LADO. Premiá-la ensina a propor o que
   * ninguém mede; puni-la ensina a evitar hipótese difícil.
   */
  it("inconclusiva é registrada e sai da conta", () => {
    const j: MutacaoJulgada[] = [
      { modelo: "a", veredito: "pagou", diferenca: 5 },
      { modelo: "a", veredito: "inconclusiva", diferenca: 999 },
    ];
    const p = placarDosModelos(j);
    expect(p[0].usdtGerado).toBeCloseTo(5, 9);
    expect(p[0].inconclusivas).toBe(1);
    expect(p[0].pagou).toBe(1);
    expect(p[0].naoPagou).toBe(0);
  });

  /**
   * ⚠️ NINGUÉM É ZERADO, NEM O PIOR. Zerar um modelo o congela no julgamento do
   * passado: nunca mais propõe, nunca mais produz evidência, nunca sai do fundo.
   * É a versão em software de aposentar por amostra pequena — o erro que este
   * projeto já cometeu com a GERI.
   */
  it("o pior modelo mantém um piso de rodízio", () => {
    const j: MutacaoJulgada[] = [
      { modelo: "bom", veredito: "pagou", diferenca: 100 },
      { modelo: "ruim", veredito: "nao_pagou", diferenca: -50 },
    ];
    const p = placarDosModelos(j);
    const ruim = p.find((x) => x.modelo === "ruim")!;
    expect(ruim.fatiaDoRodizio).toBeGreaterThan(0);
    expect(p.reduce((s, x) => s + x.fatiaDoRodizio, 0)).toBeCloseTo(1, 9);
  });

  /**
   * ⚠️ O PISO SE ENCOLHE QUANDO NÃO CABE. Com muitos modelos, `piso × n` passa
   * de 1 e a sobra vira NEGATIVA — invertendo o rodízio e dando mais vez a quem
   * produziu menos. Aqui: 12 modelos com piso pedido de 0,1 (= 1,2).
   */
  it("com muitos modelos o rodízio não se inverte", () => {
    const j: MutacaoJulgada[] = Array.from({ length: 12 }, (_, i) => ({
      modelo: `m${i}`, veredito: "pagou" as const, diferenca: i + 1,
    }));
    const p = placarDosModelos(j, 0.1);
    expect(p.reduce((s, x) => s + x.fatiaDoRodizio, 0)).toBeCloseTo(1, 9);
    // Quem gerou mais continua com a maior fatia.
    expect(p[0].fatiaDoRodizio).toBeGreaterThan(p[p.length - 1].fatiaDoRodizio);
    for (const x of p) expect(x.fatiaDoRodizio).toBeGreaterThan(0);
  });

  it("sem nenhuma mutação medível, o rodízio é parelho", () => {
    const j: MutacaoJulgada[] = [
      { modelo: "a", veredito: "inconclusiva", diferenca: 0 },
      { modelo: "b", veredito: "inconclusiva", diferenca: 0 },
    ];
    const p = placarDosModelos(j);
    expect(p[0].fatiaDoRodizio).toBeCloseTo(0.5, 9);
    expect(p[1].fatiaDoRodizio).toBeCloseTo(0.5, 9);
  });
});
