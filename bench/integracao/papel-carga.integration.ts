/**
 * CE-10 — TESTE DE CARGA dos desks de papel, contra PostgREST + Postgres reais.
 *
 * Roda o `tiqueDoPapelAdiante` DE VERDADE, tick após tick, sobre N desks
 * semeados por `semear-papel.sql` (mistura do direito contratado: Trader 3,
 * Pilot 10 por dono). Mede, por tick: tempo, requisições HTTP ao PostgREST
 * (por tabela/RPC), o resumo do tique e — no banco — quantos desks foram
 * AVALIADOS, quantos ADIADOS e quantos nem foram VISTOS.
 *
 * Externos simulados (contados): o tier (`tier_cache`/Helius) e a fonte de
 * velas (Binance) — a semeadura cobre todas as velas, então a fonte não
 * deveria ser chamada; se for, aparece no relatório.
 *
 * Rodar (depois de semear): CE_DESKS=3250 CE_TICKS=8 CE_REST_URL=… CE_JWT_SECRET=… \
 *   npx vitest run --config bench/vitest.integration.config.ts bench/integracao/papel-carga
 */
import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const chamadasTier = { n: 0 };
const chamadasFonte = { n: 0 };

const tierDe = (dono: string) =>
  ({ tier: dono.startsWith("0xb") ? "pilot" : "trader", source: "cache", expiresAt: Date.now() + 3_600_000 });
vi.mock("@/lib/tier/check", () => ({
  // Código da base: uma leitura de `tier_cache` por dono.
  getTierForWallet: vi.fn(async (dono: string) => { chamadasTier.n++; return tierDe(dono); }),
  // Código do round: `tier_cache` em lotes de 100 — conta uma leitura por lote.
  getTiersForWallets: vi.fn(async (cs: Array<{ address: string }>) => {
    chamadasTier.n += Math.ceil(cs.length / 100);
    return new Map(cs.map((c) => [c.address, tierDe(c.address)]));
  }),
}));
vi.mock("@/lib/api/market-indicators", async (original) => ({
  ...(await original<typeof import("@/lib/api/market-indicators")>()),
  fetchTimedCandles: vi.fn(async () => { chamadasFonte.n++; return []; }),
}));

const { tiqueDoPapelAdiante } = await import("@/lib/bancada/tique");

const URL = process.env.CE_REST_URL ?? "";
const SECRET = process.env.CE_JWT_SECRET ?? "";
const DESKS = Number(process.env.CE_DESKS ?? 200);
const TICKS = Number(process.env.CE_TICKS ?? 8);
const ROTULO = process.env.CE_ROTULO ?? "atual";
const H = 3_600_000;
const T_FIM = 1_790_000_000_000 - (1_790_000_000_000 % 86_400_000);

function jwt(role: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const corpo = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, iat: 1_700_000_000, exp: 4_000_000_000 })}`;
  return `${corpo}.${createHmac("sha256", SECRET).update(corpo).digest("base64url")}`;
}

const contagem = new Map<string, number>();
function cliente(): SupabaseClient {
  const contando: typeof fetch = (entrada, init) => {
    const u = String(entrada).replace("/rest/v1/", "/");
    const caminho = new globalThis.URL(u).pathname.replace(/^\//, "");
    const chave = `${(init?.method ?? "GET").toUpperCase()} ${caminho}`;
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
    return fetch(u, init);
  };
  return createClient(URL, jwt("service_role"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: contando },
  });
}

interface MedidaDoTick {
  tick: number; agoraMs: number; ms: number; requisicoes: number;
  porRecurso: Record<string, number>; tier: number; fonte: number;
  resumo: { mesas: number; abertas: number; fechadas: number; adiadas: number; cortadasPorPlano: number; problemas: number };
  avaliadas: number; adiadasNoBanco: number; naoVistas: number;
}

describe.skipIf(!URL || !SECRET)(`CE-10 · carga dos desks de papel (${DESKS} desks, ${TICKS} ticks)`, () => {
  it("mede", { timeout: 3_600_000 }, async () => {
    const db = cliente();
    const medidas: MedidaDoTick[] = [];
    const jaAvaliadas = new Set<string>();

    for (let k = 1; k <= TICKS; k++) {
      const agoraMs = T_FIM + k * 30 * 60_000 + 60_000;
      contagem.clear(); chamadasTier.n = 0; chamadasFonte.n = 0;
      const t0 = performance.now();
      const r = await tiqueDoPapelAdiante(db, agoraMs);
      const ms = performance.now() - t0;
      const porRecurso = Object.fromEntries(contagem);
      const requisicoes = [...contagem.values()].reduce((s, x) => s + x, 0);

      // Fora da medição: quem foi avaliado/adiado NESTE tick, no banco.
      const todas: Array<{ id: string; ultimo_tique: { em?: number; adiadaEm?: number } | null }> = [];
      for (let de = 0; ; de += 1000) {
        const { data, error } = await db.from("bancada_estrategia").select("id, ultimo_tique")
          .or("dono.like.0xa%,dono.like.0xb%").order("id").range(de, de + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        todas.push(...(data as typeof todas));
      }
      const avaliadas = todas.filter((m) => Number(m.ultimo_tique?.em) === agoraMs);
      for (const m of avaliadas) jaAvaliadas.add(m.id);
      const adiadasNoBanco = todas.filter((m) => Number(m.ultimo_tique?.adiadaEm) === agoraMs && Number(m.ultimo_tique?.em) !== agoraMs).length;

      const m: MedidaDoTick = {
        tick: k, agoraMs, ms, requisicoes, porRecurso, tier: chamadasTier.n, fonte: chamadasFonte.n,
        resumo: { mesas: r.mesas, abertas: r.abertas, fechadas: r.fechadas, adiadas: r.adiadas,
          cortadasPorPlano: r.cortadasPorPlano, problemas: r.problemas.length },
        avaliadas: avaliadas.length, adiadasNoBanco, naoVistas: todas.length - avaliadas.length - adiadasNoBanco,
      };
      medidas.push(m);
      console.log(`[${ROTULO}] N=${DESKS} tick ${k}: ${ms.toFixed(0)} ms, ${requisicoes} req (+${m.tier} tier), `
        + `avaliadas=${m.avaliadas} adiadas=${m.adiadasNoBanco} naoVistas=${m.naoVistas} `
        + `abertas=${r.abertas} fechadas=${r.fechadas} problemas=${r.problemas.length}`
        // RM-01: sem o lease o tique não roda — uma passagem 'ocupado'/'indisponivel' mediria nada.
        + (r.exclusividade !== undefined ? ` excl=${r.exclusividade}` : ""));
    }

    const total = DESKS;
    const resumo = {
      rotulo: ROTULO, desks: total, ticks: TICKS,
      avaliadasPorTickMediana: [...medidas.map((m) => m.avaliadas)].sort((a, b) => a - b)[Math.floor(TICKS / 2)],
      distintasAvaliadas: jaAvaliadas.size,
      nuncaAvaliadas: total - jaAvaliadas.size,
      msPorTickMediana: [...medidas.map((m) => m.ms)].sort((a, b) => a - b)[Math.floor(TICKS / 2)],
      reqPorTickMediana: [...medidas.map((m) => m.requisicoes)].sort((a, b) => a - b)[Math.floor(TICKS / 2)],
      fonteChamadas: medidas.reduce((s, m) => s + m.fonte, 0),
    };
    console.log(`[${ROTULO}] RESUMO ${JSON.stringify(resumo)}`);
    const out = process.env.BENCH_OUT;
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(`${out}/papel-carga-${ROTULO}-${DESKS}.json`, JSON.stringify({ resumo, medidas }, null, 2));
    }
    expect(medidas).toHaveLength(TICKS);
  });
});
