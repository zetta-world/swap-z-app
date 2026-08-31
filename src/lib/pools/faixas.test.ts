import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { faixaDoTier, creditosPorDia, cacheControlDa } from "@/lib/pools/faixas";
import { ALL_TIERS } from "@/lib/tier/types";

/**
 * ⚠️ O QUE ESTE ARQUIVO SEGURA.
 *
 * As faixas existem porque crédito é gasto por ATUALIZAÇÃO, não por usuário —
 * cem visitantes na mesma tabela custam uma chamada. Isso torna dois erros
 * possíveis e invisíveis: dar frescor pago a quem não pagou (a plataforma
 * distribui de graça o que cobra) e deixar a faixa cara ligada por engano (a
 * conta aparece só na fatura). Os dois estão travados abaixo.
 */

describe("cada tier na sua faixa", () => {
  it("pilot é o mais rápido, free é o mais lento, e a Hird no meio", () => {
    expect(faixaDoTier("pilot").ttlSegundos).toBe(30);
    expect(faixaDoTier("trader").ttlSegundos).toBe(180);
    expect(faixaDoTier("pro").ttlSegundos).toBe(180);
    expect(faixaDoTier("free").ttlSegundos).toBe(900);
  });

  it("⚠️ tier desconhecido cai na faixa MAIS BARATA, nunca na mais cara", () => {
    // O caso real: cliente antigo, tier novo que ninguém mapeou aqui, string
    // corrompida. Se o `default` fosse a faixa rápida, um bug de leitura
    // colocaria a plataforma inteira em 30 s sem ninguém pedir.
    for (const v of ["", "einherjar", "PILOT", "admin", null, undefined, "0", "pilot "]) {
      expect(faixaDoTier(v as never).id, JSON.stringify(v)).toBe("aberta");
    }
  });

  it("todo tier declarado tem faixa — nenhum cai no default por esquecimento", () => {
    // ⚠️ Se alguém acrescentar um tier em ALL_TIERS e esquecer deste arquivo,
    // ele silenciosamente vira "aberta". Isso é seguro para o custo, mas se for
    // um tier PAGO o cliente paga e recebe a faixa gratuita. Este teste obriga
    // a decisão a ser escrita.
    const mapeados = new Set(["free", "pro", "trader", "pilot"]);
    for (const t of ALL_TIERS) {
      expect(mapeados.has(t), `tier "${t}" nao foi mapeado em faixas.ts`).toBe(true);
    }
  });

  it("⚠️ nenhuma faixa é mais rápida que a do pilot", () => {
    // Inverter dois números aqui daria frescor de pagante ao visitante e
    // ninguém perceberia — a tela fica igual, só a fatura muda.
    const pilot = faixaDoTier("pilot").ttlSegundos;
    for (const t of ALL_TIERS) {
      expect(faixaDoTier(t).ttlSegundos).toBeGreaterThanOrEqual(pilot);
    }
  });
});

describe("a aritmética que decide o plano a contratar", () => {
  it("uma rota a 30 s custa 2.880 créditos/dia; a 15 min, 96", () => {
    expect(creditosPorDia(faixaDoTier("pilot"), 1)).toBe(2880);
    expect(creditosPorDia(faixaDoTier("free"), 1)).toBe(96);
  });

  it("⚠️ 9 rotas a 30 s para TODO MUNDO estouraria o plano gratuito em horas", () => {
    // 10.000 créditos/mês = 333/dia. Este é o número que motivou as faixas.
    const tudoRapido = creditosPorDia(faixaDoTier("pilot"), 9);
    expect(tudoRapido).toBe(25_920);
    expect(tudoRapido).toBeGreaterThan(333);

    // A faixa aberta com as mesmas 9 rotas cabe num plano pago modesto.
    expect(creditosPorDia(faixaDoTier("free"), 9)).toBe(864);
  });

  it("entrada inválida devolve 0 em vez de Infinity ou NaN", () => {
    expect(creditosPorDia(faixaDoTier("free"), 0)).toBe(0);
    expect(creditosPorDia(faixaDoTier("free"), -3)).toBe(0);
    expect(creditosPorDia(faixaDoTier("free"), NaN)).toBe(0);
    expect(creditosPorDia({ id: "aberta", ttlSegundos: 0 }, 9)).toBe(0);
  });
});

describe("⚠️⚠️ a resposta NUNCA pode ser cacheada por uma CDN", () => {
  it("toda faixa responde `private`", () => {
    for (const t of ALL_TIERS) {
      const cc = cacheControlDa(faixaDoTier(t));
      expect(cc, t).toContain("private");
      expect(cc, t).not.toContain("public");
      // `s-maxage` é a diretiva que fala com o cache COMPARTILHADO. Se ela
      // aparecer aqui, a CDN guarda uma resposta e serve a todos: o dado de
      // 30 s do Einherjar vai para o visitante, ou o de 15 min do visitante
      // prende o Einherjar. As duas direções são erradas.
      expect(cc, t).not.toContain("s-maxage");
    }
  });

  it("o max-age acompanha o TTL da faixa", () => {
    expect(cacheControlDa(faixaDoTier("pilot"))).toBe("private, max-age=30");
    expect(cacheControlDa(faixaDoTier("free"))).toBe("private, max-age=900");
  });
});

/**
 * ⚠️ ESTES DOIS LEEM O CÓDIGO-FONTE, e é deliberado: o defeito que eles
 * impedem não tem valor de retorno para conferir. `export const revalidate` é
 * uma diretiva do Next, não uma chamada — e foi exatamente ela que fazia a
 * resposta ser compartilhada entre tiers.
 */
describe("a rota não pode voltar a cachear resposta entre usuários", () => {
  const fonte = readFileSync(join(process.cwd(), "src/app/api/pools/route.ts"), "utf8");

  it("⚠️ NUNCA `export const revalidate` — isso guarda a RESPOSTA para todos", () => {
    expect(fonte).not.toMatch(/export\s+const\s+revalidate/);
  });

  it("declara `force-dynamic` em vez de depender da leitura do cookie", () => {
    expect(fonte).toMatch(/export\s+const\s+dynamic\s*=\s*"force-dynamic"/);
  });
});
