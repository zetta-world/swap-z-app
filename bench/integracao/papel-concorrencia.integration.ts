/**
 * RM-01/RM-02/RM-03 — PROVA PONTA A PONTA da exclusão do tique e da abertura idempotente,
 * contra PostgREST 14 + Postgres descartáveis com a cadeia 0001→0076.
 *
 *   tiqueDoPapelAdiante (código real) → supabase-js → PostgREST (db-max-rows 1000) → Postgres
 *
 * Cada passagem concorrente usa o SEU cliente HTTP (como duas funções serverless). Tier e fonte de
 * velas são simulados (as velas estão todas no cache semeado; a fonte não deveria ser chamada).
 *
 * Cenário determinístico: estratégia própria "média 20, compra" em 1h. Velas planas em 100 e a última
 * vela fechada em 110 → cruzamento para cima NESSA vela (sinal). Depois: 90 e 120 → novo cruzamento.
 *
 * Rodar: NETWORK=rm-net-20261005 CE_REST_URL=http://rm-rest-20261005:3000 CE_JWT_SECRET=… \
 *        npx vitest run --config bench/vitest.integration.config.ts bench/integracao/papel-concorrencia
 */
import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const fonte = { n: 0 };
vi.mock("@/lib/tier/check", () => ({
  getTierForWallet: vi.fn(async () => ({ tier: "trader", source: "cache", expiresAt: Date.now() + 3_600_000 })),
  getTiersForWallets: vi.fn(async (cs: Array<{ address: string }>) =>
    new Map(cs.map((c) => [c.address, { tier: "trader", source: "cache", expiresAt: Date.now() + 3_600_000 }]))),
}));
vi.mock("@/lib/api/market-indicators", async (original) => ({
  ...(await original<typeof import("@/lib/api/market-indicators")>()),
  fetchTimedCandles: vi.fn(async () => { fonte.n++; return []; }),
}));

const { tiqueDoPapelAdiante } = await import("@/lib/bancada/tique");
const { abrirPosicao, fecharPosicao } = await import("@/lib/bancada/store");
const { donoDeLinhaDoBanco } = await import("@/lib/bancada/dono");

const URL = process.env.CE_REST_URL ?? "";
const SECRET = process.env.CE_JWT_SECRET ?? "";
const H = 3_600_000;
const T0 = 1_790_000_000_000 - (1_790_000_000_000 % 86_400_000);   // vela do SINAL abre em T0 − 1h
const VELA_SINAL = T0 - H;
const DONO = "0xrm00000000000000000000000000000000000001";
const PARAMS = { entrada: { tipo: "media", n: 20 }, direcao: "compra", alvoPct: 2, stopPct: 1, horasLimite: 48, praca: "spot_gate", papel: "taker" };

function jwt(role: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const corpo = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, iat: 1_700_000_000, exp: 4_000_000_000 })}`;
  return `${corpo}.${createHmac("sha256", SECRET).update(corpo).digest("base64url")}`;
}
/** Um cliente NOVO por chamada — como instâncias serverless diferentes. */
function cliente(): SupabaseClient {
  const semPrefixo: typeof fetch = (entrada, init) => fetch(String(entrada).replace("/rest/v1/", "/"), init);
  return createClient(URL, jwt("service_role"), {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: semPrefixo },
  });
}
const db = () => cliente();
const semErro = <T extends { error: unknown }>(r: T): T => { expect(r.error).toBeNull(); return r; };

async function limpar(simbolos: string[]) {
  semErro(await db().from("bancada_estrategia").delete().like("dono", "0xrm%"));   // cascata apaga as posições
  semErro(await db().from("mercado_vela").delete().in("simbolo", simbolos));
  semErro(await db().from("mercado_cobertura").delete().in("simbolo", simbolos));
  semErro(await db().from("bancada_arrendamento").delete().eq("escopo", "bancada_tique"));
  semErro(await db().from("admin_kv").delete().like("key", "bancada:tique:%"));
}

/** 420 velas de 1h até `ultimaAbre` (inclusive), todas 100, exceto as de `especiais`. */
async function semearVelas(simbolo: string, ultimaAbre: number, especiais: Record<number, number>) {
  const linhas = [];
  for (let g = 0; g < 420; g++) {
    const t = ultimaAbre - g * H;
    const c = especiais[t] ?? 100;
    linhas.push({ simbolo, intervalo: "1h", abriu_em: t, high: c * 1.001, low: c * 0.999, close: c, volume: 1000 });
  }
  semErro(await db().from("mercado_vela").upsert(linhas, { onConflict: "simbolo,intervalo,abriu_em" }));
  semErro(await db().from("mercado_cobertura").upsert({
    simbolo, intervalo: "1h", coberto_de: ultimaAbre - 419 * H, coberto_ate: ultimaAbre, fonte_esgotou: true,
  }, { onConflict: "simbolo,intervalo" }));
}

async function novaMesa(simbolos: string[]): Promise<string> {
  const r = semErro(await db().from("bancada_estrategia").insert({
    dono: DONO, chain: "evm", nome: "rm-concorrencia", params: PARAMS, praca: "spot_gate", papel: "taker",
    papel_adiante: true, simbolos, intervalo: "1h", papel_desde: new Date().toISOString(),
  }).select("id").single());
  return (r.data as { id: string }).id;
}

async function posicoes(mesa: string) {
  const r = semErro(await db().from("bancada_posicao").select("id, simbolo, vela_em, status, chave_entrada").eq("estrategia_id", mesa));
  return r.data as Array<{ id: string; simbolo: string; vela_em: number; status: string; chave_entrada: string | null }>;
}

describe.skipIf(!URL || !SECRET)("RM-01/02/03 · tique exclusivo e abertura idempotente (PostgREST real)", () => {
  it("sanidade: a cena produz UM sinal na vela T0−1h (senão as provas abaixo seriam vazias)", { timeout: 120_000 }, async () => {
    await limpar(["RMA1"]);
    await semearVelas("RMA1", VELA_SINAL, { [VELA_SINAL]: 110 });
    const mesa = await novaMesa(["RMA1"]);
    const r = await tiqueDoPapelAdiante(db(), T0 + 30 * 60_000);
    expect(r.exclusividade).toBe("tomada");
    expect(r.abertas).toBe(1);
    const ps = await posicoes(mesa);
    expect(ps).toHaveLength(1);
    expect(Number(ps[0].vela_em)).toBe(VELA_SINAL);
    expect(ps[0].chave_entrada).toBe(`v1:${mesa}:1h:${VELA_SINAL}`);
    expect(fonte.n).toBe(0);
  });

  for (const N of [2, 10, 30]) {
    it(`⚠️⚠️ ${N} tiques SIMULTÂNEOS (clientes diferentes): 1 roda, ${N - 1} recusam, 1 posição`, { timeout: 300_000 }, async () => {
      await limpar(["RMA1"]);
      await semearVelas("RMA1", VELA_SINAL, { [VELA_SINAL]: 110 });
      const mesa = await novaMesa(["RMA1"]);
      const rs = await Promise.all(Array.from({ length: N }, () => tiqueDoPapelAdiante(cliente(), T0 + 30 * 60_000)));
      const tomadas = rs.filter((r) => r.exclusividade === "tomada").length;
      const ocupadas = rs.filter((r) => r.exclusividade === "ocupado").length;
      console.log(`[RM-01] N=${N} tomada=${tomadas} ocupado=${ocupadas} indisponivel=${N - tomadas - ocupadas} abertas=${rs.reduce((s, r) => s + r.abertas, 0)}`);
      expect(tomadas).toBe(1);
      expect(ocupadas).toBe(N - 1);
      expect(rs.reduce((s, r) => s + r.abertas, 0)).toBe(1);
      expect(await posicoes(mesa)).toHaveLength(1);
    });

    it(`⚠️⚠️ ${N} aberturas SIMULTÂNEAS da mesma oportunidade, por fora do lease: 1 criada, ${N - 1} já registradas`, { timeout: 300_000 }, async () => {
      // O lease é a primeira barreira; esta prova a SEGUNDA (o banco), como se o lease tivesse vencido
      // no meio de uma passagem lenta e outra tivesse entrado — o caso que o TTL não cobre sozinho.
      await limpar(["RMA1"]);
      const mesa = await novaMesa(["RMA1", "RMA2"]);
      const dono = donoDeLinhaDoBanco(DONO)!;
      const rs = await Promise.all(Array.from({ length: N }, (_, i) => abrirPosicao(dono, cliente(), {
        estrategiaId: mesa, simbolo: i % 2 ? "RMA1" : "RMA2", lado: "long", entrada: 110, tamanhoUsd: 1000,
        alvoPct: 2, stopPct: 1, expiraEm: new Date(VELA_SINAL + 48 * H).toISOString(), velaEm: VELA_SINAL, intervalo: "1h",
        playbook: null, horasLimite: 48,
      })));
      const criadas = rs.filter((r) => r.ok && r.criada).length;
      const jaRegistradas = rs.filter((r) => r.ok && !r.criada).length;
      console.log(`[RM-02] N=${N} criadas=${criadas} ja_registradas=${jaRegistradas} erros=${rs.filter((r) => !r.ok).length}`);
      expect(criadas).toBe(1);
      expect(jaRegistradas).toBe(N - 1);
      expect(await posicoes(mesa)).toHaveLength(1);
    });
  }

  it("replay / retry da MESMA passagem (sequencial): nada novo", { timeout: 120_000 }, async () => {
    await limpar(["RMA1"]);
    await semearVelas("RMA1", VELA_SINAL, { [VELA_SINAL]: 110 });
    const mesa = await novaMesa(["RMA1"]);
    expect((await tiqueDoPapelAdiante(db(), T0 + 30 * 60_000)).abertas).toBe(1);
    const r2 = await tiqueDoPapelAdiante(db(), T0 + 30 * 60_000);
    const r3 = await tiqueDoPapelAdiante(db(), T0 + 50 * 60_000);
    expect(r2.exclusividade).toBe("tomada");
    expect(r2.abertas + r3.abertas).toBe(0);
    expect(await posicoes(mesa)).toHaveLength(1);
  });

  it("⚠️⚠️ RM-03 · a posição FECHA e o tique seguinte cai na MESMA vela → NÃO reabre; a vela seguinte → abre", { timeout: 180_000 }, async () => {
    await limpar(["RMA1"]);
    await semearVelas("RMA1", VELA_SINAL, { [VELA_SINAL]: 110 });
    const mesa = await novaMesa(["RMA1"]);
    expect((await tiqueDoPapelAdiante(db(), T0 + 10 * 60_000)).abertas).toBe(1);
    const [p] = await posicoes(mesa);
    const fechou = await fecharPosicao(donoDeLinhaDoBanco(DONO)!, db(), p.id, "ganhou", 112.2, 1.6);
    expect(fechou).toEqual({ ok: true, valor: { fechou: true } });

    // Mesma vela fechada (a de T0−1h): o defeito antigo reabria aqui, porque a posição não está mais aberta.
    const mesma = await tiqueDoPapelAdiante(db(), T0 + 40 * 60_000);
    expect(mesma.abertas).toBe(0);
    expect(await posicoes(mesa)).toHaveLength(1);
    const est = semErro(await db().from("bancada_estrategia").select("ultima_vela_aberta").eq("id", mesa).single());
    expect(Number((est.data as { ultima_vela_aberta: number }).ultima_vela_aberta)).toBe(VELA_SINAL);

    // Vela seguinte com NOVO cruzamento (T0: 90 abaixo; T0+1h: 120 acima) → abre.
    await semearVelas("RMA1", T0 + H, { [VELA_SINAL]: 110, [T0]: 90, [T0 + H]: 120 });
    const seguinte = await tiqueDoPapelAdiante(db(), T0 + 2 * H + 10 * 60_000);
    expect(seguinte.abertas).toBe(1);
    const ps = await posicoes(mesa);
    expect(ps).toHaveLength(2);
    expect(ps.map((x) => Number(x.vela_em)).sort()).toEqual([VELA_SINAL, T0 + H]);
  });

  it("estratégias DIFERENTES, mesma vela: cada uma abre a sua", { timeout: 120_000 }, async () => {
    await limpar(["RMA1"]);
    await semearVelas("RMA1", VELA_SINAL, { [VELA_SINAL]: 110 });
    const m1 = await novaMesa(["RMA1"]);
    const m2 = await novaMesa(["RMA1"]);
    const r = await tiqueDoPapelAdiante(db(), T0 + 30 * 60_000);
    expect(r.abertas).toBe(2);
    expect(await posicoes(m1)).toHaveLength(1);
    expect(await posicoes(m2)).toHaveLength(1);
  });

  it("crash: lease de uma passagem que morreu — válido segura, vencido é retomado", { timeout: 120_000 }, async () => {
    await limpar(["RMA1"]);
    await semearVelas("RMA1", VELA_SINAL, { [VELA_SINAL]: 110 });
    const mesa = await novaMesa(["RMA1"]);
    semErro(await db().from("bancada_arrendamento").insert({
      escopo: "bancada_tique", dono: "tique-morto-0001", ate: new Date(Date.now() + 60_000).toISOString(),
    }));
    const preso = await tiqueDoPapelAdiante(db(), T0 + 30 * 60_000);
    expect(preso.exclusividade).toBe("ocupado");
    expect(await posicoes(mesa)).toHaveLength(0);
    semErro(await db().from("bancada_arrendamento").update({ ate: new Date(Date.now() - 1000).toISOString() }).eq("escopo", "bancada_tique"));
    const retomado = await tiqueDoPapelAdiante(db(), T0 + 30 * 60_000);
    expect(retomado.exclusividade).toBe("tomada");
    expect(retomado.abertas).toBe(1);
    // e a passagem que tomou liberou ao terminar
    const resto = semErro(await db().from("bancada_arrendamento").select("dono").eq("escopo", "bancada_tique"));
    expect(resto.data).toHaveLength(0);
    await limpar(["RMA1"]);
  });
});
