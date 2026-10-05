/**
 * ⚠️⚠️ A JANELA QUE ENCOLHE EM SILÊNCIO — o defeito mais grave achado em 06/09,
 * e ele só apareceu quando o dono clicou de verdade.
 *
 * O cliente pediu **365 dias**. O cache devolveu **66,6 dias** de velas de 1h, a
 * mesa caminhou sobre esses 66 dias, e o veredito saiu apresentado como se
 * fosse a janela inteira. Duas rodadas idênticas a 30 segundos de distância
 * deram números diferentes — porque a segunda buscou mais 800 velas e mediu
 * outro período.
 *
 * ⚠️ Nenhum dos 2.569 testes pegou: o `porqueIncompleta` não olhava para a
 * COBERTURA. Este arquivo existe para que ele olhe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const H = 3_600_000;

/** O que a FONTE devolve — controlado por teste. */
let daFonte: Array<{ t: number; high: number; low: number; close: number; volume: number }> = [];

vi.mock("@/lib/api/market-indicators", () => ({
  fetchTimedCandles: vi.fn(async (_s: string, _i: string, limite: number) => daFonte.slice(-limite)),
}));

const { velasDoIntervalo } = await import("@/lib/mercado/store");

/**
 * Banco falso: guarda as velas gravadas e devolve as da faixa pedida.
 *
 * ⚠️ CE-11: ele CORTA a resposta em `maxRows` (1000, o `db-max-rows` do
 * PostgREST hospedado e do laboratório), ordena e respeita `gt`/`limit`. O falso
 * antigo devolvia tudo de uma vez — e foi por isso que nenhum teste viu a
 * leitura de um ano chegar com 1.000 velas.
 */
function bancoFalso(opts: { maxRows?: number } = {}) {
  const maxRows = opts.maxRows ?? 1000;
  const velas: Array<Record<string, unknown>> = [];
  let cobertura: Record<string, unknown> | null = null;
  let leiturasDeVela = 0;

  function consulta(tabela: string) {
    const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
    let um = false;
    let ordem: { col: string; asc: boolean } | null = null;
    let limite = Infinity;
    const api = {
      eq(c: string, v: unknown) { filtros.push((r) => r[c] === v); return api; },
      gt(c: string, v: unknown) { filtros.push((r) => Number(r[c]) > Number(v)); return api; },
      gte(c: string, v: unknown) { filtros.push((r) => Number(r[c]) >= Number(v)); return api; },
      lte(c: string, v: unknown) { filtros.push((r) => Number(r[c]) <= Number(v)); return api; },
      order(col: string, o?: { ascending?: boolean }) { ordem = { col, asc: o?.ascending !== false }; return api; },
      limit(n: number) { limite = n; return api; },
      maybeSingle() { um = true; return api; },
      then<R>(ok: (x: { data: unknown; error: null }) => R) {
        if (tabela === "mercado_vela") leiturasDeVela++;
        const fonte = tabela === "mercado_vela" ? velas : (cobertura ? [cobertura] : []);
        let rs = fonte.filter((r) => filtros.every((f) => f(r)));
        if (ordem) {
          const { col, asc } = ordem;
          rs = [...rs].sort((a, b) => (Number(a[col]) - Number(b[col])) * (asc ? 1 : -1));
        }
        rs = rs.slice(0, Math.min(limite, maxRows));
        return Promise.resolve(ok({ data: um ? (rs[0] ?? null) : rs, error: null }));
      },
    };
    return api;
  }

  const db = {
    from(t: string) {
      return {
        select: () => consulta(t),
        upsert: (v: Record<string, unknown> | Array<Record<string, unknown>>) => {
          if (t === "mercado_vela") {
            for (const r of Array.isArray(v) ? v : [v]) {
              const i = velas.findIndex((x) => x.abriu_em === r.abriu_em);
              if (i >= 0) velas[i] = r; else velas.push(r);
            }
          } else cobertura = Array.isArray(v) ? v[0] : v;
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as SupabaseClient;

  return { db, velas, leituras: () => leiturasDeVela };
}

beforeEach(() => { daFonte = []; });

/** Uma série horária de `n` velas terminando em `fimMs`. */
function serie(n: number, fimMs: number) {
  return Array.from({ length: n }, (_, i) => {
    const t = fimMs - (n - 1 - i) * H;
    return { t, high: 101, low: 99, close: 100, volume: 1 };
  });
}

describe("⚠️⚠️ a cobertura real é comparada com a pedida", () => {
  const agora = 1_000 * H;

  it("janela de 365 dias atendida com 66 dias DENUNCIA a diferença", () => {
    // É exatamente o caso de 06/09, com os números da produção.
    const dias = 365;
    const desde = agora - dias * 24 * H;
    daFonte = serie(1600, agora - H);          // ~66 dias de 1h

    const { db } = bancoFalso();
    return velasDoIntervalo(db, "BTC", "1h", desde, agora - H, agora).then((r) => {
      expect(r.velas.length).toBe(1600);
      expect(r.porqueIncompleta, "a janela curta tem de ser reportada").not.toBeNull();
      // ⚠️ Com os NÚMEROS: "365 dias pedidos, 66 chegaram" — um aviso genérico
      // deixaria o cliente sem saber de que período o veredito fala.
      expect(r.porqueIncompleta!).toMatch(/365 dias/);
      // 1.599 horas = 66,6 dias, que o texto arredonda para 67.
      expect(r.porqueIncompleta!).toMatch(/6[67] dias/);
      expect(r.porqueIncompleta!).toMatch(/1600 de/);
    });
  });

  it("janela atendida por inteiro NÃO reclama", () => {
    // A metade positiva: um aviso que aparece sempre é ruído, e ruído se ignora.
    const desde = agora - 30 * 24 * H;
    daFonte = serie(30 * 24, agora - H);
    const { db } = bancoFalso();
    return velasDoIntervalo(db, "BTC", "1h", desde, agora - H, agora).then((r) => {
      expect(r.velas.length).toBeGreaterThan(700);
      expect(r.porqueIncompleta).toBeNull();
    });
  });

  it("⚠️ diferença pequena não vira alarme — o limiar é 90%", () => {
    // Feriado, par recém-listado, hora sem negócio: faltar 5% das velas não é
    // "outra janela". Alarmar aí ensinaria a ignorar o aviso.
    const horas = 30 * 24;
    const desde = agora - horas * H;
    daFonte = serie(Math.floor(horas * 0.95), agora - H);
    const { db } = bancoFalso();
    return velasDoIntervalo(db, "BTC", "1h", desde, agora - H, agora)
      .then((r) => expect(r.porqueIncompleta).toBeNull());
  });

  it("intervalo desconhecido responde, e não finge janela vazia", () => {
    const { db } = bancoFalso();
    return velasDoIntervalo(db, "BTC", "3d", agora - 10 * H, agora, agora).then((r) => {
      expect(r.velas).toEqual([]);
      expect(r.porqueIncompleta).toMatch(/intervalo desconhecido/);
    });
  });
});

describe("⚠️⚠️ CE-11 — a leitura atravessa o max_rows do PostgREST", () => {
  const agora = 20_000 * H;

  it("um ano de 1h (8.760 velas) volta INTEIRO com max_rows 1000 — e em ordem", async () => {
    // Antes: UMA leitura, cortada nas 1.000 primeiras. O backtest rodava sobre
    // ~11% da janela que dizia ter medido.
    const horas = 365 * 24;
    const desde = agora - horas * H;
    daFonte = serie(horas + 1, agora);
    const { db, leituras } = bancoFalso({ maxRows: 1000 });
    const r = await velasDoIntervalo(db, "BTC", "1h", desde, agora, agora + H);
    expect(r.velas).toHaveLength(horas + 1);
    expect(r.porqueIncompleta).toBeNull();
    for (let i = 1; i < r.velas.length; i++) expect(r.velas[i].t).toBeGreaterThan(r.velas[i - 1].t);
    // 9 páginas cheias + a vazia que encerra.
    expect(leituras()).toBe(Math.ceil((horas + 1) / 1000) + 1);
  });

  it("⚠️ max_rows MENOR que a página (300) não encerra a leitura cedo", async () => {
    // Parar quando a página vem curta pareceria economizar uma ida — e cortaria
    // a série em silêncio num servidor configurado com limite menor.
    const desde = agora - 2500 * H;
    daFonte = serie(2501, agora);
    const { db } = bancoFalso({ maxRows: 300 });
    const r = await velasDoIntervalo(db, "BTC", "1h", desde, agora, agora + H);
    expect(r.velas).toHaveLength(2501);
  });

  it("janela pequena custa uma página e a vazia — sem leitura a mais por causa da paginação", async () => {
    const desde = agora - 100 * H;
    daFonte = serie(101, agora);
    const { db, leituras } = bancoFalso({ maxRows: 1000 });
    const r = await velasDoIntervalo(db, "BTC", "1h", desde, agora, agora + H);
    expect(r.velas).toHaveLength(101);
    expect(leituras()).toBe(2);
  });
});

describe("⚠️ CE-06 — série FECHADA servida da memória para a mesma janela", () => {
  const agora = 30_000 * H;

  it("a 2ª rodada com a mesma janela não vai ao banco — e recebe as mesmas velas", async () => {
    const { velasFechadasDoIntervalo, _esvaziarCacheDeSeries, metricasDoCacheDeSeries } = await import("@/lib/mercado/store");
    _esvaziarCacheDeSeries();
    const desde = agora - 2000 * H, ate = agora - 2 * H;
    daFonte = serie(2001, ate);
    const { db, leituras } = bancoFalso();
    const a = await velasFechadasDoIntervalo(db, "BTC", "1h", desde, ate, agora);
    const lidasNa1a = leituras();
    const b = await velasFechadasDoIntervalo(db, "BTC", "1h", desde, ate, agora);
    expect(leituras()).toBe(lidasNa1a);                 // nenhuma leitura nova
    expect(b.velas).toEqual(a.velas);
    expect(metricasDoCacheDeSeries).toEqual({ acertos: 1, faltas: 1 });
    // A cópia é nova: mexer numa não contamina a outra.
    b.velas[0].close = -1;
    const c = await velasFechadasDoIntervalo(db, "BTC", "1h", desde, ate, agora);
    expect(c.velas[0].close).not.toBe(-1);
  });

  it("leitura INCOMPLETA não entra no cache — a próxima vai ao banco de novo", async () => {
    const { velasFechadasDoIntervalo, _esvaziarCacheDeSeries } = await import("@/lib/mercado/store");
    _esvaziarCacheDeSeries();
    const desde = agora - 365 * 24 * H, ate = agora - 2 * H;
    daFonte = serie(100, ate);                        // a fonte só tem 100 velas de um ano
    const { db, leituras } = bancoFalso();
    const a = await velasFechadasDoIntervalo(db, "ETH", "1h", desde, ate, agora);
    expect(a.porqueIncompleta).not.toBeNull();
    const antes = leituras();
    await velasFechadasDoIntervalo(db, "ETH", "1h", desde, ate, agora);
    expect(leituras()).toBeGreaterThan(antes);
  });

  it("janela que ainda não fechou (`ate` no futuro) não entra", async () => {
    const { velasFechadasDoIntervalo, _esvaziarCacheDeSeries, metricasDoCacheDeSeries } = await import("@/lib/mercado/store");
    _esvaziarCacheDeSeries();
    const desde = agora - 100 * H, ate = agora + 5 * H;
    daFonte = serie(101, agora - H);
    const { db } = bancoFalso();
    await velasFechadasDoIntervalo(db, "SOL", "1h", desde, ate, agora);
    await velasFechadasDoIntervalo(db, "SOL", "1h", desde, ate, agora);
    expect(metricasDoCacheDeSeries.acertos).toBe(0);
  });
});
