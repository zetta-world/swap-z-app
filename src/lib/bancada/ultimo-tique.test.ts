import { describe, it, expect } from "vitest";
import { lerUltimoTique, saudeDoTique, distanciaAte } from "@/lib/bancada/ultimo-tique";

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
});

describe("o que o tique viu, por símbolo", () => {
  it("lê preço, motivo e se abriu", () => {
    const t = lerUltimoTique({
      em: 1000,
      simbolos: {
        BTC: { preco: 121750.76, motivo: "EMA50 acima do preço", abriu: false },
        ETH: { preco: 4200, motivo: null, abriu: true },
      },
    });
    expect(t?.simbolos.BTC).toEqual({ preco: 121750.76, motivo: "EMA50 acima do preço", abriu: false });
    expect(t?.simbolos.ETH).toEqual({ preco: 4200, motivo: null, abriu: true });
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
