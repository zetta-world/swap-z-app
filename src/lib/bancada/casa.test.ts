/**
 * ⚠️⚠️ O CATÁLOGO DA CASA CONFERIDO CONTRA O MOTOR — não contra si mesmo.
 *
 * Uma lista de estratégias que afirma "esta é boa" e "esta morreu" é opinião
 * até alguém checar contra a régua que a plataforma de fato aplica. Este
 * arquivo faz essa checagem: os parâmetros passam pelo MESMO `lerEstrategia` da
 * rota, e o veredito de vida ou morte passa pelo MESMO portão do pedágio.
 */
import { describe, it, expect } from "vitest";
import { ESTRATEGIAS_DA_CASA, estrategiaDaCasa } from "@/lib/bancada/casa";
import { lerEstrategia, oPortaoDoPedagio } from "@/lib/bancada/vocabulario";
import { oPedagioAntesDeRodar } from "@/lib/bancada/custo";
import { messages } from "@/lib/i18n/messages";

describe("toda estratégia da casa é carregável de verdade", () => {
  it.each(ESTRATEGIAS_DA_CASA.map((e) => [e.id, e] as const))(
    "%s: os parâmetros passam pelo mesmo `lerEstrategia` da rota", (_id, e) => {
      // ⚠️ Se falhasse, o botão "usar esta" preencheria o formulário com algo
      // que o servidor recusaria — e o cliente levaria a culpa por um erro nosso.
      const r = lerEstrategia(e.params);
      expect(r.ok).toBe(true);
    });

  it("⚠️ toda chave de texto existe nos QUATRO idiomas", () => {
    // O `Schema` já obriga os quatro a terem as mesmas chaves; o que este teste
    // pega é a chave que o catálogo cita e que ninguém criou.
    const chaves = ESTRATEGIAS_DA_CASA.flatMap((e) =>
      [e.nomeKey, e.comoFuncionaKey, ...(e.medicao ? [e.medicao.porqueKey] : [])]);
    for (const lang of ["en", "pt", "es", "zh"] as const) {
      const cat = messages[lang] as unknown as Record<string, Record<string, string>>;
      for (const chave of chaves) {
        const [ns, k] = chave.split(".");
        expect(cat[ns]?.[k], `${lang} · ${chave}`).toBeTruthy();
      }
    }
  });
});

describe("⚠️ viva ou morta, conferido contra o portão", () => {
  it("nenhuma estratégia VIVA é recusada pelo nosso próprio portão", () => {
    // Oferecer como ponto de partida algo que a plataforma barra na hora seria
    // vender um botão que não funciona.
    for (const e of ESTRATEGIAS_DA_CASA.filter((x) => x.viva)) {
      const v = oPortaoDoPedagio(e.params);
      expect(v.ok, `${e.id}: ${v.ok ? "" : v.porque}`).toBe(true);
    }
  });

  it("⚠️ toda estratégia MORTA carrega a medição que a matou", () => {
    // Uma lápide sem número é opinião. O que dá valor ao cemitério é o dado.
    for (const e of ESTRATEGIAS_DA_CASA.filter((x) => !x.viva)) {
      expect(e.medicao, e.id).not.toBeNull();
      expect(e.medicao!.quando, e.id).toMatch(/\d{2}\/\d{2}\/\d{4}/);
      expect(e.medicao!.resultado.length, e.id).toBeGreaterThan(2);
    }
  });
});

describe("⚠️⚠️ o par que é a aula inteira: a ideia não mudou, o TAMANHO mudou", () => {
  it("o Maker de ±0,6% na spot é recusado — com o número", () => {
    const morto = estrategiaDaCasa("maker_faixa_morto")!;
    const v = oPortaoDoPedagio(morto.params);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.porque).toMatch(/0\.400%|pelo menos/);

    // E o bloco do pedágio mostra o estrago antes de qualquer rodada.
    const p = oPedagioAntesDeRodar(morto.params);
    expect(p.severidade).toBe("grave");
    expect(p.fatiaDoAlvo!).toBeGreaterThan(0.6);   // o pedágio come >60% do alvo
  });

  it("o MESMO gatilho com bracket largo em futuros passa", () => {
    const vivo = estrategiaDaCasa("maker_faixa_largo")!;
    expect(vivo.params.entrada).toEqual(estrategiaDaCasa("maker_faixa_morto")!.params.entrada);
    expect(oPortaoDoPedagio(vivo.params).ok).toBe(true);
    expect(oPedagioAntesDeRodar(vivo.params).severidade).toBe("ok");
  });

  it("⚠️ a Rotação morreu e AINDA ASSIM passa no portão", () => {
    // Ela não morreu de taxa: morreu do mercado daquela janela, com ficar em
    // caixa batendo. É a prova de que o portão do pedágio não é o único juiz —
    // e de que o veredito precisa do competidor.
    const r = estrategiaDaCasa("rotacao_morta")!;
    expect(r.viva).toBe(false);
    expect(oPortaoDoPedagio(r.params).ok).toBe(true);
  });
});
