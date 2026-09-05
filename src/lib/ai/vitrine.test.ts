/**
 * ⚠️⚠️ A TRAVA CONTRA A VITRINE QUE MENTE.
 *
 * Dois defeitos foram consertados em 05/09, e este arquivo guarda os dois:
 *
 *  1. a página vendia "Claude Sonnet 4.6" com `AI_PROVIDER=kimi` — o nome
 *     estava escrito à mão em ~44 lugares, e nenhum deles sabia do outro;
 *  2. ⚠️ o passe Pilot (30 SOL) vendia "Claude Opus 4.8" contra o "Sonnet" dos
 *     planos abaixo, e **nunca existiu roteamento de modelo por plano**.
 *
 * O segundo é o que cobra dinheiro de gente, e ele não era efeito da pausa da
 * Anthropic: continuaria falso no dia em que ela voltasse.
 */
import { describe, it, expect, afterEach } from "vitest";
import { modeloDaVitrine } from "@/lib/ai/vitrine";

const ANTES = { ...process.env };
afterEach(() => {
  for (const k of ["AI_PROVIDER", "ANTHROPIC_MODEL", "ZION_MODEL", "KIMI_MODEL"]) {
    if (ANTES[k] === undefined) delete process.env[k];
    else process.env[k] = ANTES[k];
  }
});

describe("a vitrine anuncia quem de fato atende", () => {
  it("com AI_PROVIDER=kimi ela diz Kimi — não Sonnet", () => {
    process.env.AI_PROVIDER = "kimi";
    delete process.env.ZION_MODEL;
    delete process.env.KIMI_MODEL;
    const m = modeloDaVitrine();
    expect(m.id).toBe("kimi-k2.6");
    expect(m.nome).toBe("Kimi K2.6");
    expect(m.nome).not.toMatch(/Sonnet|Opus/);
  });

  it("com AI_PROVIDER=anthropic ela acompanha sozinha — sem deploy", () => {
    // ⚠️ É a regra do `ativo.ts`: trocar de provedor é UMA VARIÁVEL, nunca um
    // deploy de código. A vitrine agora obedece à mesma regra.
    process.env.AI_PROVIDER = "anthropic";
    delete process.env.ZION_MODEL;
    expect(modeloDaVitrine().nome).toBe("Claude Sonnet 4.6");

    process.env.ANTHROPIC_MODEL = "claude-opus-4-8";
    expect(modeloDaVitrine().nome).toBe("Claude Opus 4.8");
  });

  it("⚠️ `ZION_MODEL` tem precedência AQUI porque tem precedência LÁ", () => {
    // `app/api/zion/route.ts`: `const model = process.env.ZION_MODEL ?? ativo.modelo`.
    // Ignorá-la faria a vitrine voltar a mentir por um caminho que ninguém
    // lembraria de conferir.
    process.env.AI_PROVIDER = "kimi";
    process.env.ZION_MODEL = "claude-opus-4-8";
    expect(modeloDaVitrine().nome).toBe("Claude Opus 4.8");
  });

  it("⚠️ id desconhecido aparece CRU — não inventamos nome comercial", () => {
    // Um nome bonito chutado é o mesmo defeito de novo, só mais difícil de achar.
    process.env.AI_PROVIDER = "anthropic";
    delete process.env.ZION_MODEL;
    process.env.ANTHROPIC_MODEL = "modelo-que-ninguem-mapeou";
    const m = modeloDaVitrine();
    expect(m.nome).toBe("modelo-que-ninguem-mapeou");
  });

  it("⚠️⚠️ ela declara que o modelo é O MESMO para todos os planos", () => {
    // Enquanto isto for `true`, nenhuma tela pode anunciar modelos diferentes
    // por plano. O dia em que houver roteamento por tier, este campo vira
    // `false` e o teste abaixo obriga a revisar as telas.
    expect(modeloDaVitrine().mesmoParaTodosOsPlanos).toBe(true);
  });
});
