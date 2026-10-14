/**
 * AUDITORIA EXTERNA (13/09) — A08, A09, A10, reproduzidos contra o tique ATUAL.
 *
 * A fonte original dos três foi recuperada em 14/10 do histórico local da sessão
 * do auditor (`ACHADOS-EM-VALIDACAO.md`, base `9638399`), junto com o teste de
 * reprodução que ele escreveu (`bancada-tique.test.ts`). Os casos abaixo são o
 * mesmo cenário, adaptados à forma atual do tique (lease, cursor, orçamento por
 * leitura). Ver `docs/AUDIT-RECONCILIATION.md` §4.1.
 *
 * Banco, tier e velas são falsos. Nenhuma chamada externa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const io = vi.hoisted(() => ({
  mesasLigadasParaOCron: vi.fn(), mesasDasPosicoesParaOCron: vi.fn(), posicoesAbertasParaOCron: vi.fn(),
  abrirPosicao: vi.fn(), fecharPosicao: vi.fn(), gravarUltimosTiques: vi.fn(), marcarTiqueAdiado: vi.fn(),
  arrendarTique: vi.fn(), liberarTique: vi.fn(),
}));
vi.mock("@/lib/bancada/store", () => io);
const tier = vi.hoisted(() => ({ getTiersForWallets: vi.fn() }));
vi.mock("@/lib/tier/check", () => tier);
const mercado = vi.hoisted(() => ({ velasDoIntervalo: vi.fn() }));
vi.mock("@/lib/mercado/store", () => mercado);

import { tiqueDoPapelAdiante, CHAVE_DO_CURSOR, SIMBOLOS_POR_MESA_NO_TIQUE } from "@/lib/bancada/tique";
import { CADENCIA_MS } from "@/lib/bancada/papel";

const agora = Date.parse("2026-09-13T12:00:00Z");

/** `admin_kv` em memória — só o cursor do tique passa por aqui. */
function bancoDoCursor() {
  const kv = new Map<string, string>();
  const db = {
    from() {
      return {
        select() {
          const q = {
            eq(_c: string, chave: string) { return { limit: async () => ({ data: kv.has(chave) ? [{ value: kv.get(chave) }] : [], error: null }) }; },
          };
          return q;
        },
        async upsert(linha: { key: string; value: string }) { kv.set(linha.key, linha.value); return { error: null }; },
      };
    },
  } as unknown as SupabaseClient;
  return { db, kv };
}

function mesa(id: string, dono: string, simbolos: string[], extra: Record<string, unknown> = {}) {
  return {
    id, dono, simbolos, intervalo: "1h", criadaEm: "2026-01-01T00:00:00Z", mesa: null, papelDesde: null,
    praca: "futuros_gate", papel: "maker", ultimaVelaAberta: null,
    params: { entrada: { tipo: "media", n: 2 }, direcao: "compra", alvoPct: 2, stopPct: 2, horasLimite: 24, praca: "futuros_gate", papel: "maker" },
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  io.arrendarTique.mockResolvedValue({ ok: true });
  io.liberarTique.mockResolvedValue({ ok: true });
  io.mesasLigadasParaOCron.mockResolvedValue([]);
  io.posicoesAbertasParaOCron.mockResolvedValue([]);
  io.mesasDasPosicoesParaOCron.mockResolvedValue([]);
  io.fecharPosicao.mockResolvedValue({ ok: true, valor: { fechou: true } });
  io.gravarUltimosTiques.mockResolvedValue({ falhas: [], viaLote: true });
  io.marcarTiqueAdiado.mockResolvedValue({ ok: true });
  tier.getTiersForWallets.mockImplementation(async (ws: Array<{ address: string }>) =>
    new Map(ws.map((w) => [w.address, { tier: "pilot" }])));
  mercado.velasDoIntervalo.mockResolvedValue({ velas: [], doCache: 0, daFonte: 0, erro: null });
});

describe("A08 · última mesa pausada deixa posições sem processamento de saída", () => {
  it("com ZERO mesas ligadas, a posição da mesa pausada é lida e fecha no alvo", async () => {
    const { db } = bancoDoCursor();
    io.posicoesAbertasParaOCron.mockResolvedValue([{
      id: "p", estrategiaId: "pausada", dono: "0xa", simbolo: "BTC", entrada: 100, tamanhoUsd: 1000, lado: "long",
      alvoPct: 2, stopPct: 2, horasLimite: 24, abertaEm: new Date(agora - 3_600_000).toISOString(), status: "aberta",
    }]);
    io.mesasDasPosicoesParaOCron.mockResolvedValue([mesa("pausada", "0xa", ["BTC"])]);
    mercado.velasDoIntervalo.mockResolvedValue({
      velas: [{ t: agora - 3_600_000, open: 100, high: 103, low: 100, close: 103, volume: 1 }], doCache: 1, daFonte: 0, erro: null,
    });
    const r = await tiqueDoPapelAdiante(db, agora);
    expect(io.posicoesAbertasParaOCron).toHaveBeenCalled();
    expect(r.fechadas).toBe(1);
    expect(io.fecharPosicao).toHaveBeenCalledTimes(1);
  });
});

describe("A09 · orçamento adia continuamente mesas válidas", () => {
  it("12 donos × 2 mesas, orçamento que cabe metade: em poucos tiques TODAS as 24 são avaliadas", async () => {
    const { db } = bancoDoCursor();
    // Símbolos distintos por mesa: o custo é por série lida, então o orçamento morde de verdade.
    const mesas = Array.from({ length: 12 }, (_, i) => [
      mesa(`m${String(i).padStart(2, "0")}a`, `0x${i}`, Array.from({ length: 10 }, (_, k) => `A${i}S${k}`)),
      mesa(`m${String(i).padStart(2, "0")}b`, `0x${i}`, Array.from({ length: 10 }, (_, k) => `B${i}S${k}`)),
    ]).flat();
    io.mesasLigadasParaOCron.mockResolvedValue(mesas);
    const avaliadas = new Set<string>();
    for (let t = 0; t < 4; t++) {
      io.gravarUltimosTiques.mockClear();
      const r = await tiqueDoPapelAdiante(db, agora + t * CADENCIA_MS, { leiturasMax: 120 });
      expect(r.mesas).toBe(12);
      for (const [, lote] of io.gravarUltimosTiques.mock.calls) for (const x of lote as Array<{ id: string }>) avaliadas.add(x.id);
    }
    expect(avaliadas.size).toBe(24);
    expect([...avaliadas].filter((id) => id.endsWith("b"))).toHaveLength(12);
  });

  it("o cursor anda: a passagem seguinte começa depois da última mesa avaliada", async () => {
    const { db, kv } = bancoDoCursor();
    io.mesasLigadasParaOCron.mockResolvedValue([
      mesa("m1", "0x1", ["X1"]), mesa("m2", "0x2", ["X2"]), mesa("m3", "0x3", ["X3"]),
    ]);
    await tiqueDoPapelAdiante(db, agora, { leiturasMax: 1 });
    expect(kv.get(CHAVE_DO_CURSOR)).toBe("m1");
    await tiqueDoPapelAdiante(db, agora + CADENCIA_MS, { leiturasMax: 1 });
    expect(kv.get(CHAVE_DO_CURSOR)).toBe("m2");
  });
});

describe("A10 · o teto de trabalho limita os símbolos de uma linha legada", () => {
  const legada = () => mesa("legada", "0xa", Array.from({ length: 1000 }, (_, i) => `SYM${i}`));

  it("uma mesa legada com 1.000 símbolos NÃO passa do orçamento de leituras do tique (era 1.000 com teto 400)", async () => {
    const { db } = bancoDoCursor();
    io.mesasLigadasParaOCron.mockResolvedValue([legada()]);
    const r = await tiqueDoPapelAdiante(db, agora, { leiturasMax: 400 });
    expect(mercado.velasDoIntervalo.mock.calls.length).toBeLessThanOrEqual(400);
    expect(r.leituras).toBe(SIMBOLOS_POR_MESA_NO_TIQUE);
    // ⚠️ O excesso é DITO.
    expect(r.problemas.some((p) => /legada: linha com 1000 símbolos, acima do teto/.test(p))).toBe(true);
  });

  it("⚠️ o corte não abandona ninguém: em 1000/teto tiques TODO símbolo foi lido", async () => {
    const { db } = bancoDoCursor();
    io.mesasLigadasParaOCron.mockResolvedValue([legada()]);
    const lidos = new Set<string>();
    const tiques = Math.ceil(1000 / SIMBOLOS_POR_MESA_NO_TIQUE);
    for (let t = 0; t < tiques; t++) {
      mercado.velasDoIntervalo.mockClear();
      await tiqueDoPapelAdiante(db, agora + t * CADENCIA_MS);
      for (const c of mercado.velasDoIntervalo.mock.calls) lidos.add(c[1] as string);
    }
    expect(lidos.size).toBe(1000);
  });

  it("gêmea positiva: mesa dentro do teto lê TODOS os seus símbolos, todo tique, sem problema", async () => {
    const { db } = bancoDoCursor();
    const simbolos = Array.from({ length: SIMBOLOS_POR_MESA_NO_TIQUE }, (_, i) => `OK${i}`);
    io.mesasLigadasParaOCron.mockResolvedValue([mesa("normal", "0xa", simbolos)]);
    for (let t = 0; t < 3; t++) {
      mercado.velasDoIntervalo.mockClear();
      const r = await tiqueDoPapelAdiante(db, agora + t * CADENCIA_MS);
      expect(new Set(mercado.velasDoIntervalo.mock.calls.map((c) => c[1]))).toEqual(new Set(simbolos));
      expect(r.problemas).toEqual([]);
    }
  });

  it("o teto é o maior limite de símbolos que algum plano permite", () => {
    expect(SIMBOLOS_POR_MESA_NO_TIQUE).toBe(10);
  });
});
