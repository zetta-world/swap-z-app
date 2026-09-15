/**
 * ⚠️⚠️ O PAGINADOR TRUNCAVA EM SILÊNCIO NO PRÓPRIO CAMINHO DE ERRO.
 * Achado A30 da auditoria externa — o defeito que este módulo existe para
 * impedir, entrando pela porta que ele mesmo construiu.
 *
 * A versão anterior desestruturava só `{ data }`:
 *
 *     if (!data || data.length === 0) break;
 *
 * Um erro na página 3 de 7 devolve `data: null` — indistinguível do fim dos
 * dados. A função retornava as duas primeiras páginas COMO SE FOSSEM A TABELA
 * INTEIRA, e quem chamou agregou um livro parcial acreditando estar completo.
 *
 * ⚠️ E O TRUNCAMENTO NÃO É NEUTRO: as consultas ordenam por `created_at`
 * ascendente, então sobra o mais ANTIGO — todo agregado regride ao
 * comportamento inicial das mesas. São 32 pontos de uso, entre eles o `cull`
 * que MATA mesas com veredito permanente.
 */
import { describe, it, expect } from "vitest";
import { selectAllRows } from "./paginate";

type Linha = { i: number };
const pagina = (todas: Linha[], falharEm?: number) =>
  (from: number, to: number) => {
    if (falharEm != null && from === falharEm) {
      return Promise.resolve({ data: null, error: { message: "boom" } });
    }
    return Promise.resolve({ data: todas.slice(from, to + 1), error: null });
  };

const muitas = (n: number): Linha[] => Array.from({ length: n }, (_, i) => ({ i }));

describe("① o caminho feliz continua igual", () => {
  it("junta várias páginas inteiras", async () => {
    const r = await selectAllRows<Linha>(pagina(muitas(2500)), 1000);
    expect(r).toHaveLength(2500);
    expect(r[0].i).toBe(0);
    expect(r[2499].i).toBe(2499);
  });

  it("para quando a página vem incompleta — é o fim dos dados", async () => {
    const r = await selectAllRows<Linha>(pagina(muitas(1500)), 1000);
    expect(r).toHaveLength(1500);
  });

  it("tabela vazia devolve vazio, sem erro", async () => {
    expect(await selectAllRows<Linha>(pagina([]), 1000)).toEqual([]);
  });

  it("respeita o teto de linhas", async () => {
    const r = await selectAllRows<Linha>(pagina(muitas(5000)), 1000, 2000);
    expect(r).toHaveLength(2000);
  });
});

describe("② erro de página LANÇA — não devolve o pedaço", () => {
  it("⚠️⚠️ falha na PRIMEIRA página não vira 'tabela vazia'", async () => {
    // Era o pior dos dois: zero linhas lidas como "não há nada", e o agregado
    // saía vazio sem ninguém saber que a consulta falhou.
    await expect(selectAllRows<Linha>(pagina(muitas(3000), 0), 1000)).rejects.toThrow(/selectAllRows/);
  });

  it("⚠️⚠️ falha no MEIO não devolve as páginas anteriores", async () => {
    // O defeito exato: 2 de 3 páginas apresentadas como a tabela inteira.
    await expect(selectAllRows<Linha>(pagina(muitas(3000), 2000), 1000)).rejects.toThrow(/selectAllRows/);
  });

  it("⚠️ a mensagem diz QUAL página e quantas linhas já tinham vindo", async () => {
    // Sem isso, quem investiga não sabe se perdeu 10 linhas ou 10.000.
    await expect(selectAllRows<Linha>(pagina(muitas(3000), 2000), 1000))
      .rejects.toThrow(/2000-2999[\s\S]*2000 linha/);
  });

  it("⚠️ e carrega a causa do banco junto", async () => {
    await expect(selectAllRows<Linha>(pagina(muitas(3000), 0), 1000)).rejects.toThrow(/boom/);
  });

  it("⚠️⚠️ o erro é lido ANTES do `break` de dados vazios", async () => {
    // `{ data: null, error }` casaria `!data` e sairia calado — foi assim que
    // o defeito viveu. O erro tem de ganhar da condição de parada.
    const so_erro = () => Promise.resolve({ data: null, error: { message: "x" } });
    await expect(selectAllRows<Linha>(so_erro, 1000)).rejects.toThrow();
  });
});

describe("③ e um `error` ausente no tipo não quebra quem não o manda", () => {
  it("página sem campo `error` continua funcionando", async () => {
    // O cliente `cru()` do DCA tem tipo estreito; o PostgREST sempre manda.
    const semCampo = (from: number, to: number) =>
      Promise.resolve({ data: muitas(500).slice(from, to + 1) });
    expect(await selectAllRows<Linha>(semCampo, 1000)).toHaveLength(500);
  });
});
