import { describe, it, expect } from "vitest";
import { gradeSample, sampleLabel, shouldTint, NOISE_THRESHOLD } from "@/lib/admin/sample";
import { DESKS } from "@/lib/zion/desks";

/**
 * O NÚMERO AO LADO DO NÚMERO.
 *
 * O Valhalla mostrava cinco mesas com o mesmo peso visual: +1,19%, +0,72%,
 * +0,64%, +0,03% e +0,44%. As amostras eram 3, 5, 2, 14 e 268.
 *
 * SAGA "lucrou" porque UM trade deu certo. VÖLVA·Kimi aparece no positivo com
 * ZERO ganhos. VEÐRFÖLNIR é 7 e 7 — cara-ou-coroa exibido como resultado.
 *
 * O dono perguntou de onde vinha aquele lucro. A pergunta certa era "quantas
 * vezes isso aconteceu?", e a tela não respondia.
 */

describe("classificação da amostra", () => {
  it("abaixo do limiar é RUÍDO — os casos reais do Valhalla", () => {
    for (const n of [2, 3, 5, 14]) expect(gradeSample(n), `n=${n}`).toBe("noise");
  });

  it("HEIMDALL, com 268, é o único que dá para discutir", () => {
    expect(gradeSample(268)).toBe("solid");
  });

  it("a faixa do meio existe — 'dá para desconfiar' não é 'dá para concluir'", () => {
    expect(gradeSample(NOISE_THRESHOLD)).toBe("thin");
    expect(gradeSample(NOISE_THRESHOLD * 3 - 1)).toBe("thin");
    expect(gradeSample(NOISE_THRESHOLD * 3)).toBe("solid");
  });

  it("amostra zero é ruído, não erro", () => {
    // Mesa que ainda não decidiu nada existe e está sendo medida; ela só não
    // tem o que dizer. Sumir com ela esconderia que está rodando.
    expect(gradeSample(0)).toBe("noise");
  });
});

describe("o rótulo mostra o n SEMPRE", () => {
  it("amostra pequena vem marcada como ruído", () => {
    expect(sampleLabel(3)).toBe("n=3 · ruído");
  });

  it("amostra suficiente mostra só o n", () => {
    expect(sampleLabel(268)).toBe("n=268");
  });

  it("o n nunca é escondido", () => {
    // Esconder a amostra é o defeito original: o número fica sozinho na tela e
    // quem lê supõe que ele significa alguma coisa.
    for (const n of [0, 1, 30, 1000]) expect(sampleLabel(n)).toContain(`n=${n}`);
  });
});

describe("a cor é autoridade, e autoridade se ganha", () => {
  it("NÃO pinta abaixo do limiar", () => {
    // Verde num +1,19% de três trades é o mesmo erro do selo de segurança que
    // era constante: produz confiança sem produzir garantia.
    expect(shouldTint(3)).toBe(false);
    expect(shouldTint(NOISE_THRESHOLD - 1)).toBe(false);
  });

  it("pinta a partir do limiar", () => {
    expect(shouldTint(NOISE_THRESHOLD)).toBe(true);
    expect(shouldTint(268)).toBe(true);
  });
});

describe("o filtro do STATS deixou de listar só mortos", () => {
  it("existe pelo menos uma mesa VIVA para filtrar", () => {
    // A lista era escrita à mão e continha exclusivamente agentes aposentados
    // em 28/07, enquanto a manchete do painel já era das mesas novas.
    expect(DESKS.filter((d) => d.status === "live").length).toBeGreaterThan(0);
  });

  it("as mesas do Setor A estão entre as vivas", () => {
    const vivas = DESKS.filter((d) => d.status === "live").map((d) => d.source);
    for (const s of ["strat_mech", "strat_day", "strat_ai", "strat_dex", "ullr_launch"]) {
      expect(vivas, `${s} deveria estar viva`).toContain(s);
    }
  });

  it("os aposentados continuam acessíveis, separados", () => {
    // Sumir com eles apagaria o histórico. O certo é separar, não esconder.
    expect(DESKS.filter((d) => d.status === "valhalla").length).toBeGreaterThan(0);
  });

  it("nenhuma mesa está viva E em Valhalla ao mesmo tempo", () => {
    for (const d of DESKS) {
      expect(["live", "valhalla", "planned"], d.source).toContain(d.status);
    }
  });
});
