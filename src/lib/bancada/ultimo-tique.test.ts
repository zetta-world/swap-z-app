import { describe, it, expect } from "vitest";
import { lerUltimoTique, saudeDoTique, distanciaAte, motivoFechado } from "@/lib/bancada/ultimo-tique";

const M = 60_000;
const CADENCIA = 30 * M;

/**
 * ⚠️⚠️ ESTE ARQUIVO GUARDA UM PEDIDO LITERAL DO DONO (07/09): *"ao contratar o
 * agente deveria aparecer aí no próprio agente, as informações e resultados em
 * tempo real"*. O que se trava aqui é que a tela consiga separar "verificou e
 * ficou de fora" de "ainda não verificou" de "parou de verificar" — três
 * estados que desenhavam a mesma tela.
 */

describe("nunca verificado é um estado, não um vazio", () => {
  it("coluna nula devolve `null`, não um objeto vazio", () => {
    // ⚠️ Um objeto vazio faria a tela dizer "verificado, nada encontrado" sobre
    // algo que não foi verificado. Toda instância passa por aqui nos primeiros
    // 30 minutos de vida.
    expect(lerUltimoTique(null)).toBeNull();
    expect(lerUltimoTique(undefined)).toBeNull();
  });

  it("json corrompido ou sem carimbo também é `null`", () => {
    expect(lerUltimoTique("lixo")).toBeNull();
    expect(lerUltimoTique({ simbolos: { BTC: {} } })).toBeNull();
    expect(lerUltimoTique({ em: 0 })).toBeNull();
    expect(lerUltimoTique({ em: "ontem" })).toBeNull();
  });

  it("e a saúde diz `nunca_verificado`, que não é o mesmo que atrasado", () => {
    expect(saudeDoTique(null, CADENCIA, 1_000_000)).toBe("nunca_verificado");
  });
});

describe("a saúde do tique — o alarme que faltava", () => {
  const agora = 10_000_000;

  it("verificado agora: em dia", () => {
    expect(saudeDoTique({ em: agora, simbolos: {} }, CADENCIA, agora)).toBe("em_dia");
  });

  /**
   * ⚠️ TOLERÂNCIA DE DOIS CICLOS, não de um. Um tique pode atrasar por disputa
   * do teto de trabalho (`aVezDeQuem`) sem nada estar errado; gritar no
   * primeiro atraso ensinaria o investidor a ignorar o aviso.
   */
  it("um ciclo e meio de atraso ainda é em dia", () => {
    expect(saudeDoTique({ em: agora - 45 * M, simbolos: {} }, CADENCIA, agora)).toBe("em_dia");
  });

  it("passando de dois ciclos, ATRASADO — é isto que denuncia o cron morto", () => {
    expect(saudeDoTique({ em: agora - 61 * M, simbolos: {} }, CADENCIA, agora)).toBe("atrasado");
  });

  it("a fronteira é exatamente dois ciclos", () => {
    expect(saudeDoTique({ em: agora - 60 * M, simbolos: {} }, CADENCIA, agora)).toBe("em_dia");
    expect(saudeDoTique({ em: agora - 60 * M - 1, simbolos: {} }, CADENCIA, agora)).toBe("atrasado");
  });

  /**
   * ⚠️⚠️ O QUARTO ESTADO NASCEU DE UM DEFEITO MEU, achado em auditoria no mesmo
   * dia em que o código subiu.
   *
   * Com 10 agentes (o teto do plano `pilot`) e `AGENTES_POR_TICK = 8`, a janela
   * rolante de `aVezDeQuem` deixa cada instância de fora uma vez a cada cinco
   * ciclos — e o intervalo entre duas avaliações cai EXATAMENTE na fronteira
   * dos 60 minutos. O único alarme que o investidor tem passaria a disparar por
   * limitação NOSSA, culpando o agente DELE. Depois de duas ou três vezes ele
   * aprende a ignorar o aviso, que é o mesmo efeito de não ter aviso.
   */
  it("adiado pelo teto da casa NÃO é o agente parado", () => {
    const t = { em: agora - 90 * M, adiadaEm: agora - 5 * M, simbolos: {} };
    expect(saudeDoTique(t, CADENCIA, agora)).toBe("adiado");
  });

  it("mas um adiamento VELHO não desculpa o silêncio de hoje", () => {
    // Senão "a casa está sempre te deixando de fora" viraria `atrasado` com
    // outro nome — e sem o alarme.
    const t = { em: agora - 300 * M, adiadaEm: agora - 200 * M, simbolos: {} };
    expect(saudeDoTique(t, CADENCIA, agora)).toBe("atrasado");
  });

  it("quem foi avaliado agora está em dia, adiamento antigo ou não", () => {
    const t = { em: agora - 5 * M, adiadaEm: agora - 999 * M, simbolos: {} };
    expect(saudeDoTique(t, CADENCIA, agora)).toBe("em_dia");
  });
});

/**
 * ⚠️⚠️ O VOCABULÁRIO DO MOTIVO É FECHADO — e a razão é a tela de um cliente
 * pagante. A primeira versão guardava a string crua, inclusive
 * `tentativas[0].reason`, que vem do SELETOR e não é controlado por este
 * arquivo. Renderizar isso põe `ja_tem_posicao` na tela de um cliente chinês, e
 * deixa o texto do admin vazar para a Bancada na primeira entrega que o
 * reescrever, sem ninguém notar.
 */
describe("o motivo é fechado na borda, nunca cru", () => {
  it.each([
    ["ja_tem_posicao", "ja_tem_posicao"],
    ["aquecendo", "aquecendo"],
    ["vela_ja_avaliada", "sem_vela_nova"],
    ["sem_velas", "sem_dado"],
    ["sem_sinal", "sem_setup"],
    ["bracket degenerado", "outro"],
  ])("%s vira %s", (cru, esperado) => {
    expect(motivoFechado(cru)).toBe(esperado);
  });

  /**
   * ⚠️ O DESCONHECIDO VIRA `sem_setup`, NÃO `outro`. O seletor devolve prosa
   * livre exatamente no caso NORMAL ("EMA50 acima do preço"), e mandá-lo para
   * `outro` faria o estado mais comum da tela ser o rótulo genérico.
   */
  it("prosa livre do seletor cai em `sem_setup`, o caso normal", () => {
    expect(motivoFechado("EMA50 acima do preço")).toBe("sem_setup");
    expect(motivoFechado("suporte não testado")).toBe("sem_setup");
  });

  it("abriu (sem motivo) continua sem motivo", () => {
    expect(motivoFechado(null)).toBeNull();
    expect(motivoFechado("")).toBeNull();
  });
});

describe("o que o tique viu, por símbolo", () => {
  it("lê preço, carimbo da vela, motivo fechado e se abriu", () => {
    const t = lerUltimoTique({
      em: 1000,
      simbolos: {
        BTC: { preco: 121750.76, velaEm: 900, motivo: "sem_setup", detalhe: "EMA50 acima do preço", abriu: false },
        ETH: { preco: 4200, velaEm: 900, motivo: null, detalhe: null, abriu: true },
      },
    });
    expect(t?.simbolos.BTC).toEqual({
      preco: 121750.76, velaEm: 900, motivo: "sem_setup", detalhe: "EMA50 acima do preço", abriu: false,
    });
    expect(t?.simbolos.ETH.abriu).toBe(true);
  });

  /**
   * ⚠️⚠️ O CARIMBO É DA VELA, NÃO DO CRON. O cron pode passar às 14:30 e servir
   * um fechamento de 11:00 — o cache responde com o que tem quando a fonte
   * recusa. Uma idade ERRADA declarada é pior que idade nenhuma.
   */
  it("o carimbo da vela é independente do carimbo do cron", () => {
    const t = lerUltimoTique({ em: 50_000, simbolos: { BTC: { preco: 1, velaEm: 11_000, abriu: false } } });
    expect(t?.em).toBe(50_000);
    expect(t?.simbolos.BTC.velaEm).toBe(11_000);
  });

  it("motivo desconhecido no banco não vira chave de tradução inexistente", () => {
    // Uma linha gravada por outra versão do código desenharia um marcador
    // vazio — pior que ausente, porque parece medido.
    const t = lerUltimoTique({ em: 1, simbolos: { BTC: { motivo: "inventado", abriu: false } } });
    expect(t?.simbolos.BTC.motivo).toBeNull();
  });

  /**
   * ⚠️ `Number(null)` É 0 E PASSA EM `isFinite` — a cicatriz mais barata de
   * repetir nesta base. Um preço zero na tela do investidor é pior que um
   * traço: ele parece medido.
   */
  it("preço ausente continua ausente, nunca vira zero", () => {
    const t = lerUltimoTique({ em: 1000, simbolos: { BTC: { preco: null, abriu: false } } });
    expect(t?.simbolos.BTC.preco).toBeNull();
  });

  it("motivo vazio é ausência de motivo, não uma string vazia na tela", () => {
    const t = lerUltimoTique({ em: 1000, simbolos: { BTC: { motivo: "", abriu: false } } });
    expect(t?.simbolos.BTC.motivo).toBeNull();
  });

  it("o detalhe cru é truncado — ele é diagnóstico, não conteúdo de tela", () => {
    const t = lerUltimoTique({ em: 1, simbolos: { BTC: { detalhe: "x".repeat(500), abriu: false } } });
    expect(t?.simbolos.BTC.detalhe).toHaveLength(200);
  });

  it("`abriu` só é verdade quando é literalmente `true`", () => {
    const t = lerUltimoTique({ em: 1000, simbolos: { A: { abriu: "sim" }, B: { abriu: 1 }, C: { abriu: true } } });
    expect([t?.simbolos.A.abriu, t?.simbolos.B.abriu, t?.simbolos.C.abriu]).toEqual([false, false, true]);
  });
});

describe("quanto falta para o alvo — a conta que o dono quer ler pronta", () => {
  const compra = { lado: "long" as const, entrada: 100, alvoPct: 5, stopPct: 3 };

  it("no preço de entrada, falta o alvo inteiro", () => {
    expect(distanciaAte(compra, 100)).toEqual({ alvoPct: 5, stopPct: 3, abertoPct: 0 });
  });

  it("subindo 2%, faltam 3 para o alvo e sobram 5 até o stop", () => {
    const d = distanciaAte(compra, 102);
    expect(d.abertoPct).toBeCloseTo(2, 10);
    expect(d.alvoPct).toBeCloseTo(3, 10);
    expect(d.stopPct).toBeCloseTo(5, 10);
  });

  /**
   * ⚠️ O SINAL É RELATIVO AO LADO. Numa VENDA o alvo está ABAIXO da entrada;
   * uma conta que assuma compra mostraria a distância invertida, e o investidor
   * leria "faltam 2%" para um alvo que já passou.
   */
  it("numa venda, o preço caindo APROXIMA do alvo", () => {
    const venda = { lado: "short" as const, entrada: 100, alvoPct: 5, stopPct: 3 };
    const d = distanciaAte(venda, 98);
    expect(d.abertoPct).toBeCloseTo(2, 10);
    expect(d.alvoPct).toBeCloseTo(3, 10);
  });

  it("passado o alvo, a distância é 0 — nunca negativa", () => {
    // Acontece entre o toque e o próximo tique. "faltam −0,3%" seria ruído;
    // zero é a verdade legível: está no alvo, fecha no próximo tique.
    expect(distanciaAte(compra, 110).alvoPct).toBe(0);
  });

  it("sem preço, tudo é `null` — nunca 0, que diria 'chegou no alvo'", () => {
    expect(distanciaAte(compra, null)).toEqual({ alvoPct: null, stopPct: null, abertoPct: null });
    expect(distanciaAte(compra, 0)).toEqual({ alvoPct: null, stopPct: null, abertoPct: null });
  });

  it("bracket ausente não vira distância zero", () => {
    const semAlvo = { lado: "long" as const, entrada: 100, alvoPct: null, stopPct: null };
    const d = distanciaAte(semAlvo, 102);
    expect(d.alvoPct).toBeNull();
    expect(d.stopPct).toBeNull();
    expect(d.abertoPct).toBeCloseTo(2, 10);
  });
});
