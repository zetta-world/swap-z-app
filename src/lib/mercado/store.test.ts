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

/** Banco falso: guarda as velas gravadas e devolve as da faixa pedida. */
function bancoFalso() {
  const velas: Array<Record<string, unknown>> = [];
  let cobertura: Record<string, unknown> | null = null;

  function consulta(tabela: string) {
    const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
    let um = false;
    const api = {
      eq(c: string, v: unknown) { filtros.push((r) => r[c] === v); return api; },
      gte(c: string, v: unknown) { filtros.push((r) => Number(r[c]) >= Number(v)); return api; },
      lte(c: string, v: unknown) { filtros.push((r) => Number(r[c]) <= Number(v)); return api; },
      order() { return api; },
      maybeSingle() { um = true; return api; },
      then<R>(ok: (x: { data: unknown; error: null }) => R) {
        const fonte = tabela === "mercado_vela" ? velas : (cobertura ? [cobertura] : []);
        const rs = fonte.filter((r) => filtros.every((f) => f(r)));
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

  return { db, velas };
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
