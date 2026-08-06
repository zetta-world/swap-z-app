/**
 * O REGISTRO DO LABORATÓRIO — as travas que impedem uma estratégia de nascer
 * sem o que a torna mensurável.
 *
 * ⚠️ POR QUE CADA TRAVA EXISTE.
 *
 * Toda uma delas é cicatriz. As 23 mesas antigas recebiam $1.000
 * independentemente da estratégia — e mesa sub-capitalizada não rende menos,
 * rende NEGATIVO por custo fixo. O resultado é lido como "a estratégia não
 * presta", e provavelmente já matamos ideias boas assim.
 */

import { describe, it, expect } from "vitest";
import { LAB_STRATEGIES, FAMILIES, BY_SLUG } from "@/lib/lab/registry";

describe("integridade do registro", () => {
  it("todo slug é único — é chave de dados, não rótulo", () => {
    const slugs = LAB_STRATEGIES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("o índice cobre o registro inteiro", () => {
    expect(BY_SLUG.size).toBe(LAB_STRATEGIES.length);
  });

  it("toda família declarada tem pelo menos uma estratégia — aba vazia é ruído", () => {
    for (const f of FAMILIES) {
      const n = LAB_STRATEGIES.filter((s) => s.family === f.id).length;
      expect(n, `família sem estratégia: ${f.id}`).toBeGreaterThan(0);
    }
  });

  it("toda estratégia pertence a uma família conhecida", () => {
    const conhecidas = new Set(FAMILIES.map((f) => f.id));
    const orfas = LAB_STRATEGIES.filter((s) => !conhecidas.has(s.family));
    expect(orfas.map((s) => s.slug)).toEqual([]);
  });
});

describe("capital — a variável que a auditoria de 05/08 achou faltando", () => {
  it("toda estratégia declara capital positivo", () => {
    const sem = LAB_STRATEGIES.filter((s) => !(s.capitalRequiredUsd > 0));
    expect(sem.map((s) => s.slug)).toEqual([]);
  });

  /**
   * Número de capital sem justificativa vira constante que ninguém confere —
   * foi assim que a coluna `priority` nasceu e sobreviveu meses sem ser medida.
   * O banco exige 25 caracteres via CHECK; aqui exige-se o mesmo, para o erro
   * aparecer no CI e não no insert.
   */
  it("todo capital vem com o PORQUÊ, e o porquê explica de verdade", () => {
    const fracos = LAB_STRATEGIES.filter((s) => s.capitalWhy.length < 25);
    expect(fracos.map((s) => `${s.slug}: "${s.capitalWhy}"`)).toEqual([]);
  });

  /**
   * As estratégias que existem para ser comparadas entre si precisam do MESMO
   * capital, senão a comparação mede duas variáveis ao mesmo tempo. É a mesma
   * regra do duelo VÖLUNDR × MÍMIR.
   */
  it("as direcionais que se comparam compartilham o capital", () => {
    const duelo = ["trend_ma50_long_short", "trend_ma50_long_only", "regime_filter", "buy_and_hold"];
    const capitais = new Set(duelo.map((slug) => BY_SLUG.get(slug)!.capitalRequiredUsd));
    expect([...capitais]).toHaveLength(1);
  });

  it("as duas de negócio não consomem capital, e dizem isso", () => {
    const negocio = LAB_STRATEGIES.filter((s) => s.family === "negocio");
    expect(negocio.length).toBeGreaterThan(0);
    for (const s of negocio) {
      expect(s.capitalWhy, s.slug).toMatch(/não consome capital/i);
    }
  });
});

describe("subtítulo — o leigo tem que entender", () => {
  it("toda estratégia tem subtítulo funcional", () => {
    const sem = LAB_STRATEGIES.filter((s) => s.subtitle.length < 15);
    expect(sem.map((s) => s.slug)).toEqual([]);
  });

  /**
   * O subtítulo mostra o capital. Se ele disser $1.000 e o campo disser $5.000
   * a tela mente — e é exatamente a divergência silenciosa que fez o painel
   * exibir $20.842 onde havia $11.491.
   */
  it("o capital do subtítulo BATE com o capital declarado", () => {
    const divergentes = LAB_STRATEGIES.filter((s) => {
      const m = s.subtitle.match(/\$([\d.]+)/);
      if (!m) return false;
      return Number(m[1].replace(/\./g, "")) !== s.capitalRequiredUsd;
    });
    expect(divergentes.map((s) => `${s.slug}: ${s.subtitle} ≠ $${s.capitalRequiredUsd}`)).toEqual([]);
  });
});

describe("os três estados, e o que cada um obriga", () => {
  it("CINZA é o estado padrão — não medido não é reprovado", () => {
    const cinzas = LAB_STRATEGIES.filter((s) => s.status === "cinza");
    expect(cinzas.length).toBeGreaterThan(LAB_STRATEGIES.length / 2);
  });

  it("toda MORTA diz por que morreu — reprovar sem motivo é esquecer", () => {
    const mortas = LAB_STRATEGIES.filter((s) => s.status === "morta");
    for (const s of mortas) {
      expect(s.killedWhy, `${s.slug} morta sem motivo`).toBeTruthy();
    }
  });

  /**
   * Estratégia VERDE afirma um resultado positivo. Sem a hipótese registrada
   * não dá para saber se o resultado confirmou uma previsão ou se a previsão
   * foi escrita depois do resultado — que é a diferença entre medir e
   * racionalizar.
   */
  it("toda VERDE carrega a hipótese que a sustenta", () => {
    const verdes = LAB_STRATEGIES.filter((s) => s.status === "verde");
    expect(verdes.length).toBeGreaterThan(0);
    for (const s of verdes) {
      expect(s.hypothesis, `${s.slug} verde sem hipótese`).toBeTruthy();
      expect(s.hypothesis!.length).toBeGreaterThan(30);
    }
  });

  /**
   * O filtro de regime é a prioridade nº 1 do dono e a hipótese mais frágil do
   * mapa — eu já levantei uma hipótese de regime antes (o clima) e a minha
   * própria medição derrubou. A ressalva tem que viajar com ela.
   */
  /**
   * ⚠️ ESTE TESTE MUDOU EM 06/08, E A MUDANÇA É O RESULTADO.
   *
   * Ele afirmava `status === "cinza"` — não medido. O filtro de regime era a
   * prioridade nº 1 do dono e a hipótese mais frágil do mapa, e a ressalva
   * registrada dizia "candidato, não promessa" porque eu já tinha levantado
   * uma hipótese de regime antes (o clima) e a minha própria medição derrubou.
   *
   * Derrubou de novo, e desta vez INVERTIDA: RANGING rende −0,446% (n=176) e
   * TRENDING_UP rende −0,777% (n=135). A lateralidade é o MELHOR terreno desta
   * biblioteca, não o pior.
   *
   * A hipótese continua gravada ao lado do `killedWhy` de propósito: apagá-la
   * deixaria só a conclusão, e a conclusão sem a previsão que ela derrubou é
   * exatamente o que permite alguém reescrever a previsão depois do resultado.
   */
  it("o filtro de regime foi MEDIDO e reprovado — e a hipótese fica ao lado", () => {
    const s = BY_SLUG.get("regime_filter")!;
    expect(s.status).toBe("morta");
    // A previsão original permanece, para a refutação ser conferível.
    expect(s.hypothesis).toMatch(/candidato, não promessa/i);
    expect(s.hypothesis).toMatch(/direção paga, lateralidade mata/i);
    // E o motivo carrega os DOIS números com as DUAS amostras.
    expect(s.killedWhy).toMatch(/RANGING/);
    expect(s.killedWhy).toMatch(/n=176/);
    expect(s.killedWhy).toMatch(/n=135/);
  });

  /**
   * A refutação do regime NÃO mata a média móvel. São estratégias opostas —
   * reversão à média precisa de faixa, seguidor de tendência precisa de
   * tendência — e o `killedWhy` tem que dizer isso, senão daqui a um mês
   * alguém lê "regime refutado" e desliga a coisa errada.
   */
  it("a reprovação do regime declara o que ela NÃO refuta", () => {
    const s = BY_SLUG.get("regime_filter")!;
    expect(s.killedWhy).toMatch(/NÃO REFUTA/i);
    expect(s.killedWhy).toMatch(/trend_ma50_long_short/);
    expect(BY_SLUG.get("trend_ma50_long_short")!.status).not.toBe("morta");
  });

  it("o funding carrega a discrepância de 1,4% contra 5-20%", () => {
    const s = BY_SLUG.get("funding_basis")!;
    expect(s.hypothesis).toMatch(/1,4%/);
    expect(s.hypothesis).toMatch(/5% a 20%|5-20/);
  });
});

describe("cobertura do Mapa do Lucro", () => {
  it("as 26 estratégias do plano estão registradas", () => {
    expect(LAB_STRATEGIES.length).toBeGreaterThanOrEqual(26);
  });

  /**
   * As seis prioridades explícitas do dono. Se alguma sumir do registro, ela
   * some do painel e some do plano sem ninguém decidir isso.
   */
  it("as prioridades declaradas pelo dono existem, todas", () => {
    for (const slug of [
      "regime_filter",       // 1 — filtro de regime
      "funding_basis",       // 2 — remedir funding com janela longa
      "stablecoin_lending",  // 3 — rendimento integrado
      "tokenized_treasury",  // 3
      "dex_cex_arb",         // 5 — DEX ↔ CEX
      "covered_call",        // 6 — venda de opção coberta
    ]) {
      expect(BY_SLUG.has(slug), `prioridade ausente: ${slug}`).toBe(true);
    }
  });
});
