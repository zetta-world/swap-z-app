/**
 * RM-05 — MATRIZ DE COMPATIBILIDADE de schema × código deste branch, contra PostgREST + Postgres reais.
 *
 * O mesmo arquivo roda em cada estado do banco (o script `scripts/cost/matriz-migrations.sh` sobe o
 * banco até a migration indicada e avança uma por vez). `CE_ESTADO` diz em qual estado estamos:
 *
 *   A = cadeia até 0072 (nada deste round)      D = 0073 + 0074 + 0075
 *   B = 0073                                     E = 0073 + 0074 + 0075 + 0076 (alvo de release)
 *   C = 0073 + 0074
 *
 * Classificação esperada (a mesma do relatório §11):
 *   A → FAIL-CLOSED: bancada 503 (reserva indisponível), tique NÃO roda (lease indisponível).
 *   B, C → bancada SUPPORTED-DEGRADED (fecha sem métricas, declarado); tique FAIL-CLOSED.
 *   D → bancada SUPPORTED; tique FAIL-CLOSED.
 *   E → SUPPORTED.
 *   0076 sem 0073–0075 → UNSUPPORTED, e a própria migration RECUSA aplicar (pré-condição).
 */
import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/tier/check", () => ({
  getTierForWallet: vi.fn(async () => ({ tier: "trader", source: "cache", expiresAt: Date.now() + 3_600_000 })),
  getTiersForWallets: vi.fn(async (cs: Array<{ address: string }>) =>
    new Map(cs.map((c) => [c.address, { tier: "trader", source: "cache", expiresAt: Date.now() + 3_600_000 }]))),
}));

const { reservarRodada, fecharRodada, gravarUltimosTiques } = await import("@/lib/bancada/store");
const { tiqueDoPapelAdiante } = await import("@/lib/bancada/tique");
const { donoDeLinhaDoBanco } = await import("@/lib/bancada/dono");

const URL = process.env.CE_REST_URL ?? "";
const SECRET = process.env.CE_JWT_SECRET ?? "";
const ESTADO = (process.env.CE_ESTADO ?? "") as "A" | "B" | "C" | "D" | "E" | "";
const DONO = "0xcompat0000000000000000000000000000000001";

function jwt(role: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const corpo = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, iat: 1_700_000_000, exp: 4_000_000_000 })}`;
  return `${corpo}.${createHmac("sha256", SECRET).update(corpo).digest("base64url")}`;
}
function db(): SupabaseClient {
  const semPrefixo: typeof fetch = (entrada, init) => fetch(String(entrada).replace("/rest/v1/", "/"), init);
  return createClient(URL, jwt("service_role"), { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: semPrefixo } });
}
const NOVA = {
  estrategiaId: null, origem: "propria" as const, capitalUsd: 100, simbolos: ["BTC"], intervalo: "1d",
  janelaDe: 1, janelaAte: 2, praca: "spot_gate" as const, papel: "taker" as const, params: {}, custoVelas: 365, custoUnidades: 365,
};
const METRICAS = { duracaoMs: 12, velasDaFonte: 0, velasDoCache: 365 };
const dono = () => donoDeLinhaDoBanco(DONO)!;

describe.skipIf(!URL || !SECRET || !ESTADO)(`RM-05 · estado ${ESTADO} do schema`, () => {
  const temReserva = ESTADO !== "A";
  const temLote = ESTADO === "C" || ESTADO === "D" || ESTADO === "E";
  const temMetricas = ESTADO === "D" || ESTADO === "E";
  const temLease = ESTADO === "E";

  it(`bancada · reserva: ${temReserva ? "aceita" : "desconhecido → a rota responde 503 (FAIL-CLOSED)"}`, async () => {
    const r = await reservarRodada(dono(), "evm", db(), NOVA, { rodadas: 10, unidades: 1_000_000 });
    if (!temReserva) {
      expect(r).toMatchObject({ ok: false, motivo: "desconhecido" });
      return;
    }
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // ⚠️ O ACHADO DO ROUND ANTERIOR (PF-04): com 0073 e sem 0075, a rodada ficava `rodando` para sempre.
    const f = await fecharRodada(dono(), db(), r.id, "concluida", undefined, METRICAS);
    expect(f.ok).toBe(true);
    if (f.ok) expect(f.valor).toMatchObject({ fechou: true, metricasGravadas: temMetricas });
    const linha = await db().from("bancada_rodada").select("status, terminada_em").eq("id", r.id).single();
    expect(linha.error).toBeNull();
    expect((linha.data as { status: string }).status).toBe("concluida");
    expect((linha.data as { terminada_em: string | null }).terminada_em).not.toBeNull();
    // replay do fechamento: idempotente
    const de2 = await fecharRodada(dono(), db(), r.id, "concluida", undefined, METRICAS);
    expect(de2.ok && de2.valor.fechou === false).toBe(true);
  });

  it(`tique · ${temLease ? "roda (lease tomado)" : "NÃO roda — exclusão indisponível (FAIL-CLOSED)"}`, async () => {
    const r = await tiqueDoPapelAdiante(db(), Date.now());
    expect(r.exclusividade).toBe(temLease ? "tomada" : "indisponivel");
    if (!temLease) expect(r.mesas + r.abertas + r.fechadas).toBe(0);
  });

  it(`último tique · ${temLote ? "em lote (0074)" : "fallback por mesa, contando só o que o banco confirmou"}`, async () => {
    const ins = await db().from("bancada_estrategia").insert([
      { dono: DONO, chain: "evm", nome: "compat-1", praca: "spot_gate", papel: "taker" },
      { dono: DONO, chain: "evm", nome: "compat-2", praca: "spot_gate", papel: "taker" },
    ]).select("id");
    expect(ins.error).toBeNull();
    const ids = (ins.data as Array<{ id: string }>).map((x) => x.id);
    const r = await gravarUltimosTiques(db(), [
      ...ids.map((id) => ({ id, dono: dono(), visto: { BTC: { motivo: null } } })),
      { id: "00000000-0000-0000-0000-000000000000", dono: dono(), visto: {} },   // sem linha: NÃO pode contar
    ], 1_790_000_000_000);
    expect(r.viaLote).toBe(temLote);
    expect(r.gravados).toBe(2);
    expect(r.falhas).toHaveLength(1);
    await db().from("bancada_estrategia").delete().eq("dono", DONO);
  });
});
