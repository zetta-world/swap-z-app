import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { agentePor, riscoPorStopPct, tamanhoDaPosicao } from "@/lib/celeiro/agentes";
import { alvoAcompanhaOStop, alavancagemCoerente, stopPorVolatilidade } from "@/lib/celeiro/regime";

/**
 * ⚠️⚠️ O ALAVANCADO PERDEU 263,24 USDT EM 6,8 DIAS — 92% do buraco do Celeiro.
 *
 * A auditoria de 29/08 separou preço de taxa e mostrou que 79% do vazamento era
 * PREÇO. A tentação óbvia era mexer no sinal até o número virar. Este arquivo
 * segura os dois consertos que os dados SUSTENTAM, e nenhum deles é isso.
 *
 * ⚠️ O QUE FOI DESCARTADO, e por que importa registrar: a faixa de sinal acima
 * de 6% era a única positiva das quatro (+21,92 USDT, 6 alvos em 8). Olhada de
 * perto, são **oito posições do mesmo dia, no mesmo ativo, do mesmo sinal** —
 * uma alta do SOL em 27/08 observada oito vezes. Um evento, não uma amostra.
 * Subir o limiar de tendência por causa dela seria ajustar o sistema a um dia.
 */

const AG = agentePor("alavancado_de_tendencia")!;

describe("⚠️⚠️ o tamanho: a conta media o evento errado", () => {
  it("a fórmula da alavanca dimensiona pela LIQUIDAÇÃO, que nunca chegava perto", () => {
    // Os piores movimentos contra REAIS das 36 posições ficaram entre 1,11% e
    // 4,95%. Com folga 2×, a conta devolve de 10× a 45× — sempre no teto.
    for (const pior of [1.11, 2.21, 3.09, 4.95]) {
      const semTeto = alavancagemCoerente(pior, 100);
      expect(semTeto.vezes, `pior ${pior}%`).toBeGreaterThanOrEqual(10);
    }
    // ⚠️ Ou seja: o TETO era a única coisa que mandava. A conta nunca mordeu.
    expect(alavancagemCoerente(4.95, 3).vezes).toBe(3);
  });

  it("⚠️ e o stop dispara SEMPRE antes da liquidação — por uma ordem de grandeza", () => {
    // A 10× a liquidação fica a 10%; o stop real das posições ficou em 1,4–2,0%.
    const liquidaEm = alavancagemCoerente(4.95, 10).liquidaEmPct;
    expect(liquidaEm).toBe(10);
    for (const stopReal of [1.39, 1.71, 2.02]) expect(stopReal).toBeLessThan(liquidaEm);
  });

  it("⚠️⚠️ o risco por stop era 3,2% da banca; agora é ~1%", () => {
    // fração 0,20 × alavanca × stop 1,6% — a conta que não existia.
    expect(riscoPorStopPct(AG, 10, 1.6)).toBeCloseTo(3.2, 6);
    expect(riscoPorStopPct(AG, AG.alavancagemMaxima, 1.6)).toBeCloseTo(0.96, 6);
    expect(riscoPorStopPct(AG, AG.alavancagemMaxima, 1.6)).toBeLessThanOrEqual(1.5);
  });

  it("⚠️ nem o pior stop observado passa de 1,5% da banca", () => {
    // O stop mais largo que o piso de volatilidade produziu foi 2,02% (SOL).
    expect(riscoPorStopPct(AG, AG.alavancagemMaxima, 2.02)).toBeLessThanOrEqual(1.5);
  });

  /**
   * ⚠️⚠️ A ARITMÉTICA QUE DECIDIU O NÚMERO — e ela não é sobre lucro.
   *
   * O agente decide 3,86 operações por dia. As 100 decididas que esta casa exige
   * antes de confiar num número chegam em 26 dias. No tamanho antigo ele queimava
   * 38,70/dia e tinha 436,76 até o piso de ruína — 11 dias.
   *
   * Ele morria no dia 11 de uma pergunta respondida no dia 26.
   */
  it("⚠️⚠️ no tamanho antigo o experimento NÃO TERMINAVA; agora termina", () => {
    const DECIDE_POR_DIA = 3.86, MIN_SAMPLE = 100;
    const ateOVeredito = MIN_SAMPLE / DECIDE_POR_DIA;
    const folgaAteRuina = 736.76 - AG.capitalMinimoUsd;

    const vidaAntes = folgaAteRuina / 38.70;
    expect(vidaAntes).toBeLessThan(ateOVeredito);          // morria antes de saber

    // A queima escala com o nocional; o ritmo de decisão não.
    const escala = AG.alavancagemMaxima / 10;
    const vidaAgora = folgaAteRuina / (38.70 * escala);
    expect(vidaAgora).toBeGreaterThan(ateOVeredito);       // agora dá para descobrir
  });

  it("o nocional por posição deixa de ser 2× a banca inteira", () => {
    const t = tamanhoDaPosicao(AG, 0, 1000, AG.alavancagemMaxima);
    expect(t.usd).toBeLessThanOrEqual(1000);
    expect(t.cabe).toBe(true);
  });

  it("⚠️ e a exposição máxima em nocional cai de 6× para menos de 2× a banca", () => {
    // O teto de exposição conta MARGEM (0,6). O risco vive no nocional, e a
    // alavanca multiplica: 0,6 × 10 = 6× a banca inteira exposta ao mesmo tempo.
    expect(AG.tetoDeExposicao * 10).toBe(6);
    expect(AG.tetoDeExposicao * AG.alavancagemMaxima).toBeLessThan(2);
  });
});

describe("⚠️ I3 — o alvo acompanha o stop efetivo", () => {
  it("⚠️⚠️ o caso real do SOL: a v3 pediu stop 0,8% e executou 2,0% com alvo 1,0%", () => {
    // 58% das posições do agente eram SOL. A mutação em teste tinha como
    // hipótese escrita "reduzir o stop para abaixo do alvo"; o piso de
    // volatilidade entregou o DOBRO do alvo, e o veredito saiu mesmo assim.
    const st = stopPorVolatilidade(0.67, 0.8);
    expect(st.stopPct).toBeCloseTo(2.01, 2);

    const i3 = alvoAcompanhaOStop(1.0, st.stopPct);
    expect(i3.ajustado).toBe(true);
    expect(i3.alvoPct).toBeCloseTo(st.stopPct, 6);
    expect(i3.porque).toContain("acompanhar o stop");
  });

  it("⚠️ o alvo SOBE; o stop nunca desce", () => {
    // Apertar o stop de volta desfaria a I2, que nasceu de três posições mortas
    // no ruído do SOL — em exatamente −1,200%, todas, na mesma hora e meia.
    const i3 = alvoAcompanhaOStop(1.0, 2.0);
    expect(i3.alvoPct).toBeGreaterThan(1.0);
    expect(i3.alvoPct).toBe(2.0);
  });

  it("alvo que já cobre o stop fica onde está", () => {
    const i3 = alvoAcompanhaOStop(2.0, 1.2);
    expect(i3.ajustado).toBe(false);
    expect(i3.alvoPct).toBe(2.0);
  });

  it("empate não mexe — arriscar 1 para ganhar 1 já era o declarado", () => {
    expect(alvoAcompanhaOStop(1.5, 1.5).ajustado).toBe(false);
  });

  it("⚠️ a razão nunca fica abaixo de 1:1 depois da regra", () => {
    for (const [alvo, ruido, declarado] of [[1.0, 0.67, 0.8], [1.0, 0.72, 0.8], [2.0, 0.30, 1.2], [1.0, 0.32, 1.2]]) {
      const st = stopPorVolatilidade(ruido, declarado);
      const i3 = alvoAcompanhaOStop(alvo, st.stopPct);
      expect(i3.alvoPct / st.stopPct, `alvo ${alvo} ruído ${ruido}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("número inválido não vira geometria — devolve o que dá para defender", () => {
    expect(alvoAcompanhaOStop(Number.NaN, 2).alvoPct).toBe(2);
    expect(alvoAcompanhaOStop(1.5, Number.NaN).alvoPct).toBe(1.5);
  });
});

/**
 * ⚠️⚠️ ESTA SEÇÃO NASCEU DE UM FURO DESTE PRÓPRIO ARQUIVO (30/08).
 *
 * Quebrei os consertos em três direções antes de entrar. Duas foram pegas. A
 * TERCEIRA — o cron deixar de aplicar a I3 e voltar a ler `params.alvoPct`
 * direto — passou verde: a invariante estava testada isolada, e nada provava
 * que a produção a chamava.
 *
 * É a mesma família do defeito que a auditoria achou no A/B: uma peça correta,
 * escrita, testada, e **desligada do caminho que decide**. Um teste de unidade
 * sobre uma função pura não distingue "aplicada" de "existe".
 */
describe("⚠️ e o cron REALMENTE aplica a I3", () => {
  const fonte = readFileSync("src/app/api/celeiro/cron/route.ts", "utf8");

  it("o alvo usado na geometria vem da I3, não do genoma cru", () => {
    expect(fonte).toMatch(/const i3 = alvoAcompanhaOStop\(Number\(params\.alvoPct/);
    expect(fonte).toMatch(/const alvoPct = i3\.alvoPct;/);
  });

  it("⚠️ o stop é calculado ANTES — sem ele a I3 não tem com o que comparar", () => {
    expect(fonte.indexOf("const st = stopPorVolatilidade")).toBeLessThan(fonte.indexOf("const i3 = alvoAcompanhaOStop"));
  });

  it("⚠️ e o portão do pedágio julga o alvo FINAL, depois do ajuste", () => {
    // Julgar o alvo antes deixaria passar uma geometria que a I3 ainda mudaria.
    expect(fonte.indexOf("const i3 = alvoAcompanhaOStop")).toBeLessThan(fonte.indexOf("alvoLimpaOPedagio("));
  });

  it("o ajuste aparece no `porque` — decisão silenciosa não é auditável", () => {
    expect(fonte).toMatch(/i3\.ajustado \? ` · \$\{i3\.porque\}` : ""/);
  });
});
