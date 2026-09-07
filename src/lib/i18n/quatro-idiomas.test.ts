import { describe, it, expect } from "vitest";
import { messages } from "@/lib/i18n/messages";

/**
 * ⚠️⚠️ QUATRO LOCALES, SEMPRE — e a trava vale para o catálogo inteiro.
 *
 * `lookup()` devolve a PRÓPRIA CHAVE quando a tradução falta: o texto não
 * quebra, ele vira `bancada.histTitulo` na tela. Isso não derruba build, não
 * derruba teste, e não aparece em nenhuma revisão feita em inglês — só aparece
 * para o cliente que escolheu português. Foi assim que o veredito da bancada
 * devolveu prosa em português para uma UI de quatro idiomas.
 *
 * ⚠️ A PARIDADE JÁ ERA VERDADE quando esta trava foi escrita (0 faltando, 0
 * sobrando nos três idiomas). Ela não conserta nada hoje: ela impede que a
 * próxima entrega quebre em silêncio o que já está certo.
 */

type Catalogo = Record<string, unknown>;

function chaves(o: Catalogo, prefixo = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string") out.push(prefixo + k);
    else if (v && typeof v === "object") out.push(...chaves(v as Catalogo, `${prefixo}${k}.`));
  }
  return out;
}

function texto(cat: Catalogo, chave: string): string {
  let cur: unknown = cat;
  for (const p of chave.split(".")) cur = (cur as Catalogo)?.[p];
  return typeof cur === "string" ? cur : "";
}

const EN = chaves(messages.en as unknown as Catalogo);
const OUTROS = ["pt", "es", "zh"] as const;

describe("o catálogo tem as mesmas chaves nos quatro idiomas", () => {
  it("existe catálogo para varrer (senão a trava é decorativa)", () => {
    // ⚠️ Invariante nº 33: varredura que não achou nada precisa provar que
    // olhou.
    expect(EN.length).toBeGreaterThan(500);
  });

  it.each(OUTROS)("%s não tem chave faltando nem chave a mais", (locale) => {
    const deles = new Set(chaves(messages[locale] as unknown as Catalogo));
    const faltam = EN.filter((k) => !deles.has(k));
    const sobram = [...deles].filter((k) => !EN.includes(k));
    expect({ faltam, sobram }).toEqual({ faltam: [], sobram: [] });
  });

  /**
   * ⚠️ O PLACEHOLDER TAMBÉM ATRAVESSA. Uma tradução que perde `{n}` mostra a
   * frase sem o número — e `format()` não avisa, porque ele só recoloca o que
   * encontra. Uma que INVENTA `{pct}` mostra `{pct}` cru na tela.
   */
  it.each(OUTROS)("%s usa exatamente os mesmos {placeholders} do inglês", (locale) => {
    const cat = messages[locale] as unknown as Catalogo;
    const en = messages.en as unknown as Catalogo;
    const divergem = EN.filter((k) => {
      const a = [...texto(en, k).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      const b = [...texto(cat, k).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      return a !== b;
    });
    expect(divergem).toEqual([]);
  });
});

/**
 * ⚠️⚠️ "1 operações" — o que o dono leu na tela em 07/09.
 *
 * O plural era interpolado (`"{n} operações"`) e servia para todo `n`. Não é um
 * detalhe de gramática: é a diferença entre uma ferramenta cuidada e uma que
 * ninguém releu, e o cliente lê isso antes de ler qualquer número.
 *
 * A trava é sobre a FORMA das duas chaves: a singular não pode carregar `{n}`
 * (senão ela é a plural com outro nome) e a plural precisa carregar.
 */
describe("singular não é o plural com outro nome", () => {
  const PARES: Array<[string, string]> = [
    ["bancada.sampleUm", "bancada.sample"],
    ["bancada.opsUma", "bancada.opsQuantas"],
    ["bancada.mesasExpiradaUma", "bancada.mesasExpiradas"],
    ["bancada.quotaLeftUm", "bancada.quotaLeft"],
  ];

  it.each(["en", ...OUTROS] as const)("%s: a singular não interpola e a plural sim", (locale) => {
    const cat = messages[locale] as unknown as Catalogo;
    for (const [um, muitos] of PARES) {
      expect(texto(cat, um), `${locale} · ${um}`).not.toMatch(/\{n\}/);
      expect(texto(cat, um), `${locale} · ${um}`).not.toBe("");
      expect(texto(cat, muitos), `${locale} · ${muitos}`).toMatch(/\{n\}/);
    }
  });
});
