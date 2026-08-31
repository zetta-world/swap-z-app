import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getTopPools, getTrendingPools, getPoolsPage,
  GeckoIndisponivel, ehIndisponivel,
} from "@/lib/api/geckoterminal";

/**
 * ⚠️⚠️ VAZIO-POR-FALHA NÃO PODE TER A CARA DE VAZIO-POR-AUSÊNCIA.
 *
 * Este arquivo existe por um defeito MEDIDO EM PRODUÇÃO em 30/08:
 *
 *     /api/pools?chain=polygon                     ->  0 pools, HTTP 200
 *     api.geckoterminal.com/.../polygon_pos/pools  ->  20 pools
 *     api.geckoterminal.com/.../optimism/pools     ->  429 "exceeded the Rate Limit"
 *
 * O cliente fazia `if (!res.ok) return []` em vinte lugares, a rota devolvia
 * 200 com lista vazia, e a tela dizia "nenhuma pool encontrada". Quem
 * selecionasse Polygon concluiria que Polygon não tem liquidez.
 *
 * O mais desconfortável: a mensagem de erro CERTA já existia no i18n
 * ("GeckoTerminal is unreachable — their upstream is rate-limited or offline"),
 * e era código morto, porque nada nunca chegava ao estado de erro.
 *
 * ⚠️ E O 429 É O CASO NORMAL, não o excepcional: sem chave de API o limite da
 * GeckoTerminal é por IP, e os IPs de saída da Vercel são compartilhados. Com
 * tráfego, a página degrada em silêncio — que é o pior modo de degradar.
 */

const respostaOk = (pools: unknown[]) => ({
  ok: true, status: 200,
  json: async () => ({ data: pools }),
}) as unknown as Response;

const respostaRuim = (status: number) => ({
  ok: false, status,
  json: async () => ({}),
}) as unknown as Response;

afterEach(() => { vi.unstubAllGlobals(); });

describe("429 da fonte vira erro tipado, nunca lista vazia", () => {
  it("getTopPools LANÇA GeckoIndisponivel com motivo 'limite'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaRuim(429)));
    await expect(getTopPools("ethereum")).rejects.toThrow(GeckoIndisponivel);
    await expect(getTopPools("ethereum")).rejects.toMatchObject({ status: 429, motivo: "limite" });
  });

  it("getTrendingPools e getPoolsPage fazem o mesmo — é o caminho todo de /pools", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaRuim(429)));
    await expect(getTrendingPools()).rejects.toThrow(GeckoIndisponivel);
    await expect(getPoolsPage("solana", 1)).rejects.toThrow(GeckoIndisponivel);
  });

  it("outros status viram 'erro', e falha de rede vira 'rede'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaRuim(503)));
    await expect(getTopPools("ethereum")).rejects.toMatchObject({ status: 503, motivo: "erro" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    await expect(getTopPools("ethereum")).rejects.toMatchObject({ status: 0, motivo: "rede" });
  });
});

describe("⚠️ vazio DE VERDADE continua sendo vazio", () => {
  it("200 com zero pools devolve [] e NÃO lança", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaOk([])));
    // É a metade que dá sentido à outra: se tudo lançasse, a distinção
    // continuaria não existindo — só teria trocado de lado.
    await expect(getTopPools("ethereum")).resolves.toEqual([]);
    await expect(getTrendingPools()).resolves.toEqual([]);
  });

  it("rede que o app não mapeia devolve [] sem tocar na rede", async () => {
    const f = vi.fn(async () => respostaOk([]));
    vi.stubGlobal("fetch", f);
    await expect(getTopPools("naoexiste")).resolves.toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("ehIndisponivel separa a falha da fonte de um defeito nosso", () => {
  it("só reconhece o erro tipado", () => {
    expect(ehIndisponivel(new GeckoIndisponivel(429, "limite"))).toBe(true);
    expect(ehIndisponivel(new Error("TypeError: x is not a function"))).toBe(false);
    expect(ehIndisponivel(null)).toBe(false);
    expect(ehIndisponivel("429")).toBe(false);
  });

  it("⚠️ a rota usa isto para escolher 503 (fonte) ou 500 (nosso)", () => {
    // A distinção não é cosmética: 503 diz "o pedido está certo, a dependência
    // caiu" e convida a repetir; 500 diz "temos um defeito" e não deve ser
    // repetido em loop. Trocar os dois faz o cliente martelar um bug nosso.
    const daFonte = new GeckoIndisponivel(429, "limite");
    const nosso   = new TypeError("cannot read properties of undefined");
    expect(ehIndisponivel(daFonte)).toBe(true);
    expect(ehIndisponivel(nosso)).toBe(false);
  });
});
