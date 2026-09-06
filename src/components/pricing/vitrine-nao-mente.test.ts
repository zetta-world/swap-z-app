/**
 * ⚠️⚠️ NENHUMA TELA ESCREVE O NOME DO MODELO À MÃO.
 *
 * Este teste lê o FONTE das telas de venda e recusa qualquer nome de modelo
 * literal. Ele existe porque a correção de 05/09 não é o texto — é a FONTE: no
 * dia em que alguém digitar "Sonnet 4.6" num card de novo, a página volta a
 * poder divergir do produto, e ninguém percebe até um cliente reclamar.
 *
 * ⚠️ E ele olha o CATÁLOGO de i18n junto, porque foi lá que a mentira morou nos
 * quatro idiomas.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.join(process.cwd(), "src");

/** Nomes comerciais de modelo. Um deles num literal de tela é o defeito. */
const NOMES = /\b(Sonnet\s*[\d.]+|Opus\s*[\d.]+|Claude\s+(Sonnet|Opus|Haiku)|GPT-[\d.]+|Kimi\s*K[\d.]+)\b/;

const TELAS = [
  "components/pricing/PricingView.tsx",
  "components/pricing/PricingCard.tsx",
  "components/pricing/NormalPlansView.tsx",
  "components/enterprise/EnterpriseView.tsx",
  "components/settings/SettingsView.tsx",
  "components/about/AboutView.tsx",
  "lib/i18n/messages.ts",
  "lib/pricing/plans.ts",
];

/** ⚠️ Comentário não é tela — a nota que EXPLICA o defeito cita os nomes. */
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("a vitrine não escreve o nome do modelo à mão", () => {
  it.each(TELAS)("%s", (rel) => {
    const arq = path.join(RAIZ, rel);
    const linhas = semComentarios(fs.readFileSync(arq, "utf8")).split("\n");
    const culpadas = linhas
      .map((l, i) => ({ n: i + 1, l }))
      .filter(({ l }) => NOMES.test(l));

    expect(
      culpadas.length === 0 ? null
        : `\n  ${rel}\n${culpadas.map((c) => `  linha ${c.n}: ${c.l.trim()}`).join("\n")}\n\n`
          + "Use `modeloDaVitrine()` e a variável {model} — a vitrine não pode ter fonte própria.",
    ).toBeNull();
  });

  /**
   * ⚠️ A tabela `NOME_PUBLICADO` é a ÚNICA exceção, e de propósito: ela traduz
   * id configurado → nome publicado, e mora ao lado da função que a usa.
   */
  it("a única exceção é o mapa de nomes, e ele é derivado do id", () => {
    const src = fs.readFileSync(path.join(RAIZ, "lib/ai/vitrine.ts"), "utf8");
    expect(src).toMatch(/NOME_PUBLICADO/);
    expect(semComentarios(src)).toMatch(NOMES);
  });
});
