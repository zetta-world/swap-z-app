import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  pedagioSobreAlvo, stopContraRuido, amplitudeMediaPct, taxaDaPerna,
  PEDAGIO_ATENCAO, PEDAGIO_GRAVE, contraSegurar,
} from "@/lib/pro/custo-da-ideia";

/**
 * ⚠️⚠️ AS DUAS PERGUNTAS QUE NENHUM TERMINAL DO MERCADO RESPONDE.
 *
 * Não são contas novas: são duas medições desta casa, cada uma paga com
 * cicatriz, finalmente apontadas para a tela de quem vai clicar.
 *
 *   o pedágio  matou o `maker_de_faixa`, que acertava 70% e PERDIA dinheiro
 *   o ruído    nasceu de três entradas mortas no mesmo minuto, no mesmo −1,200%
 */

describe("⚠️⚠️ o pedágio sobre o alvo — o caso que matou o maker_de_faixa", () => {
  it("o número real: alvo de 0,6% com spot taker entrega 67% para a corretora", () => {
    // taxa 0,20%/perna × 2 = 0,40% sobre um alvo de 0,6%.
    const r = pedagioSobreAlvo(0.20, 0.6);
    expect(r.fracao).toBeCloseTo(0.667, 3);
    expect(r.severidade).toBe("grave");
    expect(r.texto).toContain("67% do alvo");
  });

  it("⚠️ o mesmo alvo em FUTUROS maker é outra coisa — 5%", () => {
    // 0,015%/perna. É a diferença que o Celeiro descobriu tarde: as pernas não
    // são todas da mesma praça, e cobrar tudo pela mesma taxa erra a decisão.
    const r = pedagioSobreAlvo(0.015, 0.6);
    expect(r.fracao).toBeCloseTo(0.05, 3);
    expect(r.severidade).toBe("ok");
  });

  it("os dois limiares vêm da varredura de 166 dias do regime.ts", () => {
    expect(PEDAGIO_ATENCAO).toBeCloseTo(1 / 3, 6);
    expect(PEDAGIO_GRAVE).toBeCloseTo(1 / 2, 6);
    expect(pedagioSobreAlvo(0.20, 1.2).severidade).toBe("atencao");   // 33%
    expect(pedagioSobreAlvo(0.05, 1.0).severidade).toBe("ok");        // 10%
  });

  it("⚠️ sem alvo não afirma nada — e não devolve zero", () => {
    for (const alvo of [null, 0, -1]) {
      const r = pedagioSobreAlvo(0.2, alvo);
      expect(r.severidade, String(alvo)).toBe("sem_dado");
      expect(r.fracao, String(alvo)).toBe(null);
    }
    expect(pedagioSobreAlvo(null, 1).severidade).toBe("sem_dado");
  });
});

describe("⚠️⚠️ o stop contra o ruído — as três mortas no mesmo minuto", () => {
  it("o caso real do SOL: 1,2% com amplitude de 0,98%/vela está DENTRO do ruído", () => {
    const r = stopContraRuido(1.2, 0.98);
    expect(r.severidade).toBe("grave");
    expect(r.texto).toContain("sem tendência nenhuma");
  });

  it("⚠️ o MESMO 1,2% no BTC é outra coisa — amplitude de 0,32%/vela", () => {
    // É exatamente esta assimetria que o stop fixo ignorava.
    const r = stopContraRuido(1.2, 0.32);
    expect(r.severidade).toBe("ok");
    expect(r.texto).toContain("fora do ruído");
  });

  it("a razão sai na frase, para a pessoa poder discordar do limiar", () => {
    expect(stopContraRuido(1.2, 0.32).texto).toContain("3.8×");
  });

  it("⚠️ sem amplitude medida, diz que não mediu — não chuta", () => {
    const r = stopContraRuido(1.2, null);
    expect(r.severidade).toBe("sem_dado");
    expect(r.texto).toContain("não medida");
  });

  it("sem stop definido, não inventa comparação", () => {
    expect(stopContraRuido(null, 0.5).severidade).toBe("sem_dado");
    expect(stopContraRuido(0, 0.5).severidade).toBe("sem_dado");
  });
});

describe("⚠️ a amplitude mede o CHACOALHO, não o corpo da vela", () => {
  it("vela que abre e fecha no mesmo lugar depois de oscilar 2% NÃO tem ruído zero", () => {
    // Corpo zero, amplitude 2%. É o chacoalho que arranca stop, não o corpo.
    const v = [{ high: 101, low: 99, close: 100 }];
    expect(amplitudeMediaPct(v)).toBeCloseTo(2, 6);
  });

  it("média das últimas N velas, e a janela é respeitada", () => {
    const calmas = Array.from({ length: 60 }, () => ({ high: 100.1, low: 99.9, close: 100 }));
    const agitadas = Array.from({ length: 5 }, () => ({ high: 105, low: 95, close: 100 }));
    // Com janela 5, só as agitadas contam.
    expect(amplitudeMediaPct([...calmas, ...agitadas], 5)).toBeCloseTo(10, 6);
  });

  it("⚠️ lista vazia devolve `null`, nunca 0 — zero diria 'ativo sem ruído'", () => {
    expect(amplitudeMediaPct([])).toBe(null);
    expect(amplitudeMediaPct([{ high: 1, low: 1, close: 0 }])).toBe(null);
  });
});

describe("a taxa sai do rótulo do par", () => {
  it("lê o formato do registro", () => {
    expect(taxaDaPerna("0.05%")).toBe(0.05);
    expect(taxaDaPerna("0.30%")).toBe(0.3);
    expect(taxaDaPerna(" 0.01% ")).toBe(0.01);
  });

  it("⚠️ rótulo ausente ou ilegível devolve `null`, e a tela cala", () => {
    expect(taxaDaPerna(undefined)).toBe(null);
    expect(taxaDaPerna("")).toBe(null);
    expect(taxaDaPerna("grátis")).toBe(null);
  });
});

/**
 * ⚠️⚠️ A ÚLTIMA MILHA, DE NOVO — e ela é a que este projeto mais erra.
 *
 * Uma conta certa, testada, e desligada do caminho que decide já apareceu HOJE
 * quatro vezes: o A/B com um braço só, a I3 quase entrando desconectada, o
 * filtro do controle olhando uma flag de duas, e o preço da trade consertado na
 * fonte sem ninguém passar o lado. Esta seção existe para não ser a quinta.
 */
describe("as duas leituras chegam à tela", () => {
  const semComentario = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const PAINEL = semComentario(readFileSync("src/components/pro/ProOrderPanel.tsx", "utf8"));
  const TERM   = semComentario(readFileSync("src/components/pro/ProTerminal.tsx", "utf8"));
  const CHART  = semComentario(readFileSync("src/components/pro/ProChart.tsx", "utf8"));

  it("⚠️ o painel de ordem chama as TRÊS", () => {
    expect(PAINEL).toMatch(/pedagioSobreAlvo\(feeTierPct \?\? null, alvoPct\)/);
    expect(PAINEL).toMatch(/stopContraRuido\(stopPct, amplitudeVelaPct \?\? null\)/);
    expect(PAINEL).toMatch(/contraSegurar\(alvoPct, \(fechamentos \?\? \[\]\)/);
  });

  it("⚠️⚠️ e os fechamentos vêm do MESMO gráfico, não de outra busca", () => {
    // Outra fonte falaria de uma janela que não é a que a pessoa está vendo.
    expect(CHART).toMatch(/onFechamentos\?\.\(rows\.map\(\(c\) => c\.close\)\)/);
    expect(TERM).toMatch(/onFechamentos=\{setFechamentos\}/);
    expect(TERM).toMatch(/rotuloJanela=\{tf\}/);
  });

  it("⚠️ trocar de par zera os fechamentos junto com o resto", () => {
    expect(TERM).toMatch(/setFechamentos\(\[\]\); \}, \[pair\.id, tf\]/);
  });

  it("⚠️ o terminal passa a taxa da pool e a amplitude", () => {
    expect(TERM).toMatch(/feeTierPct=\{taxaDaPerna\(pair\.feeTier\)\}/);
    expect(TERM).toMatch(/amplitudeVelaPct=\{amplitudeVela\}/);
  });

  it("⚠️⚠️ e a amplitude vem do MESMO conjunto que o gráfico desenha", () => {
    // De outra fonte, a conta falaria de um timeframe que não é o da tela.
    expect(CHART).toMatch(/onAmplitude\?\.\(amplitudeMediaPct\(rows\)\)/);
    expect(TERM).toMatch(/onAmplitude=\{setAmplitudeVela\}/);
  });

  it("⚠️ trocar de par ou timeframe zera os insumos", () => {
    /**
     * A amplitude do par anterior não fala do par novo — uma leitura de ruído
     * com o número errado é pior que nenhuma.
     *
     * ⚠️ ESTA ASSERÇÃO JÁ FOI LITERAL E QUEBROU DUAS VEZES: a linha cresceu
     * quando o mesmo efeito passou a zerar a amplitude, e de novo quando passou
     * a zerar os fechamentos — as duas mudanças CORRETAS. Agora ela exige que
     * cada `set…(null|[])` esteja num efeito disparado por [pair.id, tf], sem
     * transcrever a linha.
     */
    // ⚠️ `[\s\S]*?` e não `[^}]*`: desde 08/09 o reset da vivacidade passa um
    // OBJETO (`{ buscaEmMs: null, … }`), e a versão antiga da regex parava na
    // primeira chave — quebrando por causa da forma do argumento, não da
    // intenção. Terceira vez que esta asserção aprende a mesma lição.
    const efeito = TERM.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[pair\.id, tf\]\)/);
    expect(efeito, "não achei um efeito de reset disparado por [pair.id, tf]").not.toBe(null);
    for (const alvo of ["setLeituraDoGrafico", "setAmplitudeVela", "setFechamentos"]) {
      expect(efeito![1], alvo).toContain(alvo);
    }
  });

  it("⚠️ o bloco NÃO aparece quando NENHUMA leitura tem dado", () => {
    /**
     * Cinza-neutro ao lado de "custo da ideia" seria lido como "custo ok".
     *
     * ⚠️ Também já foi literal e quebrou quando a condição passou de duas
     * leituras para três. A asserção olha a FORMA — alguma leitura com dado —,
     * não a lista.
     */
    expect(PAINEL).toMatch(/\.some\(\(l\) => l\.severidade !== "sem_dado" && l\.texto\)/);
  });

  it("⚠️ ele INFORMA, nunca bloqueia o botão", () => {
    // O terminal não mexe na ordem de ninguém. A diferença entre um aviso e um
    // portão é a diferença entre respeitar e tutelar.
    expect(PAINEL).not.toMatch(/disabled=\{[^}]*leitura/);
  });
});

/**
 * ⚠️⚠️ A TERCEIRA PERGUNTA: E SE EU NÃO FIZESSE NADA? (item 8)
 *
 * `comprar-e-segurar.ts` nasceu porque o painel sabia dizer "está lucrando" e
 * não sabia dizer "está lucrando MENOS que parado". Em 29/08 ela mediu que
 * CINCO DE SEIS mesas perderam para não fazer nada.
 *
 * ⚠️ MAS AQUI OS DOIS LADOS NÃO SÃO DA MESMA NATUREZA, e é isso que estes
 * testes seguram: segurar é REALIZADO, o alvo é INTENÇÃO. Chamar de "bateu
 * segurar" um alvo que ainda não aconteceu seria afirmar sobre o não medido.
 */
describe("⚠️ contra não fazer nada — e sem fingir veredito", () => {
  const sobe = (de: number, ate: number) => [{ close: de }, { close: (de + ate) / 2 }, { close: ate }];

  it("põe os dois números lado a lado, sem dizer quem ganhou", () => {
    const r = contraSegurar(2, sobe(100, 120), "7d");
    expect(r.texto).toContain("segurar rendeu 20.0% em 7d");
    expect(r.texto).toContain("seu alvo é 2.0%");
    // ⚠️ Nenhum veredito: o alvo não aconteceu.
    expect(r.texto).not.toMatch(/bateu|perdeu de|ganhou/);
  });

  it("⚠️ alvo menor que segurar vira ATENÇÃO, com a fração explícita", () => {
    const r = contraSegurar(2, sobe(100, 120), "7d");
    expect(r.severidade).toBe("atencao");
    expect(r.texto).toContain("10% do que não fazer nada já daria");
  });

  it("alvo maior que segurar não acusa nada", () => {
    expect(contraSegurar(30, sobe(100, 120), "7d").severidade).toBe("ok");
  });

  it("⚠️⚠️ segurar CAINDO inverte o sinal — não há o que bater", () => {
    const r = contraSegurar(3, sobe(120, 100), "7d");
    expect(r.severidade).toBe("ok");
    expect(r.texto).toContain("segurar perdeu dinheiro");
  });

  it("⚠️ mercado de lado: a pergunta não se aplica, e ela diz isso", () => {
    // Reusa MARE_MINIMA_PCT. Sem a guarda, um denominador minúsculo produziria
    // "capturou 4.000% da maré" — façanha aparente num mercado parado.
    const r = contraSegurar(2, sobe(100, 100.5), "7d");
    expect(r.severidade).toBe("sem_dado");
    expect(r.texto).toContain("de lado demais");
  });

  it("⚠️ janela curta demais não vira número", () => {
    expect(contraSegurar(2, [{ close: 100 }], "1h").severidade).toBe("sem_dado");
    expect(contraSegurar(2, [], "1h").severidade).toBe("sem_dado");
  });

  it("sem alvo, cala inteiramente", () => {
    expect(contraSegurar(null, sobe(100, 120), "7d").texto).toBe("");
  });
});
