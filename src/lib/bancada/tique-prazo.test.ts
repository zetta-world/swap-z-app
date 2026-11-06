import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const io = vi.hoisted(() => ({
  mesasLigadasParaOCron: vi.fn(), mesasDasPosicoesParaOCron: vi.fn(), posicoesAbertasParaOCron: vi.fn(),
  abrirPosicao: vi.fn(), fecharPosicao: vi.fn(), gravarUltimosTiques: vi.fn(), marcarTiqueAdiado: vi.fn(),
  arrendarTique: vi.fn(), liberarTique: vi.fn(),
}));
vi.mock("@/lib/bancada/store", () => io);
const fonte = vi.hoisted(() => ({ velasDoIntervalo: vi.fn(), getTiersForWallets: vi.fn() }));
vi.mock("@/lib/mercado/store", () => ({ velasDoIntervalo: fonte.velasDoIntervalo }));
vi.mock("@/lib/tier/check", () => ({ getTiersForWallets: fonte.getTiersForWallets }));
const decisoes = vi.hoisted(() => ({ propria: vi.fn(), agente: vi.fn(), preparar: vi.fn() }));
vi.mock("./papel", async (original) => ({
  ...await original<typeof import("./papel")>(), decidirAbertura: decisoes.propria,
}));
vi.mock("./agente", async (original) => ({
  ...await original<typeof import("./agente")>(),
  decidirAberturaDoAgente: decisoes.agente, prepararAgente: decisoes.preparar,
}));
import { tiqueDoPapelAdiante } from "./tique";

const H = 3_600_000;
const agora = Date.parse("2026-11-05T12:30:00Z");
const dono = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const banco = () => ({
  from: () => ({
    select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    upsert: async () => ({ error: null }),
  }),
}) as unknown as SupabaseClient;

beforeEach(() => {
  vi.clearAllMocks();
  io.arrendarTique.mockResolvedValue({ ok: true });
  io.liberarTique.mockResolvedValue({ ok: true });
  io.posicoesAbertasParaOCron.mockResolvedValue([]);
  io.mesasDasPosicoesParaOCron.mockResolvedValue([]);
  io.abrirPosicao.mockResolvedValue({ ok: true, criada: true, id: "posicao-nova" });
  io.gravarUltimosTiques.mockResolvedValue({ falhas: [], viaLote: true });
  io.marcarTiqueAdiado.mockResolvedValue({ ok: true });
  fonte.getTiersForWallets.mockResolvedValue(new Map([[dono, { tier: "pilot" }]]));
  fonte.velasDoIntervalo.mockResolvedValue({ velas: [], doCache: 0, daFonte: 0, erro: null });
  decisoes.preparar.mockReturnValue({ pronto: false, decisao: { abre: false, porque: "sem_velas", regime: null } });
});

describe("prazo solicitado pelo tique não começa antes de observar o sinal", () => {
  it.each([
    { tipo: "própria 1h", mesa: null, intervalo: "1h", idadeDaAberturaH: 1.5 },
    { tipo: "própria 4h", mesa: null, intervalo: "4h", idadeDaAberturaH: 4.5 },
    { tipo: "agente 1h", mesa: "strat_day", intervalo: "1h", idadeDaAberturaH: 1.5 },
    { tipo: "agente com dado atrasado", mesa: "strat_day", intervalo: "1h", idadeDaAberturaH: 5.5 },
  ])("$tipo: prazo contado do tique e identidade da vela preservada", async (caso) => {
    const velaMs = agora - caso.idadeDaAberturaH * H;
    io.mesasLigadasParaOCron.mockResolvedValue([{
      id: "mesa-1", dono, simbolos: ["BTC"], intervalo: caso.intervalo,
      criadaEm: "2026-01-01T00:00:00Z", mesa: caso.mesa, papelDesde: null,
      praca: "futuros_gate", papel: "maker", ultimaVelaAberta: null,
      params: caso.mesa ? null : {
        entrada: { tipo: "media", n: 2 }, direcao: "compra", alvoPct: 2, stopPct: 2,
        horasLimite: 24, praca: "futuros_gate", papel: "maker",
      },
    }]);
    // Testa a costura decisão -> abertura. Elegibilidade e frescor da fonte
    // não são provados pelo sinal controlado deste teste.
    decisoes.propria.mockReturnValue({ abre: true, velaMs, preco: 100 });
    decisoes.agente.mockReturnValue({
      abre: true, velaMs, entrada: 100, alvoPct: 2, stopPct: 2,
      horasLimite: 24, playbook: "fixture", regime: "fixture",
    });
    const r = await tiqueDoPapelAdiante(banco(), agora);
    expect(r.abertas).toBe(1);
    expect(io.abrirPosicao).toHaveBeenCalledExactlyOnceWith(dono, expect.anything(), expect.objectContaining({
      velaEm: velaMs, expiraEm: new Date(agora + 24 * H).toISOString(), horasLimite: 24,
    }));
  });
});
