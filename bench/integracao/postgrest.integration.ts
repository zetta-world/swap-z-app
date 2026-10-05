/**
 * CE-04 / CE-11 — PROVA PONTA A PONTA contra um PostgREST DE VERDADE.
 *
 *   código da aplicação (supabase-js) → PostgREST v14 (db-max-rows = 1000)
 *   → Postgres descartável com a cadeia 0001→0073.
 *
 * Nada aqui toca o laboratório nem o hospedado: `ce-rest-20261005` e
 * `ce-pg-20261005` são containers da campanha, numa rede `--internal`.
 * Semeadura: `bench/integracao/semear.sql` (rodado antes, via psql).
 *
 * Cada prova mostra o ANTES (a consulta exata do código da base, crua) e o
 * DEPOIS (a função do round), no mesmo banco, no mesmo servidor.
 *
 * Rodar: NETWORK=ce-net-20261005 CE_REST_URL=http://ce-rest-20261005:3000 \
 *        CE_JWT_SECRET=… npx vitest run --config bench/vitest.integration.config.ts
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { velasDoIntervalo } from "@/lib/mercado/store";
import { consumoDaJanela, reservarRodada } from "@/lib/bancada/store";
import type { Dono } from "@/lib/bancada/dono";

const URL = process.env.CE_REST_URL ?? "";
const SECRET = process.env.CE_JWT_SECRET ?? "";
const H = 3_600_000;
const T0 = 1_700_000_000_000 - (1_700_000_000_000 % H);   // mesmo T0 da semeadura

function jwt(role: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const corpo = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, iat: 1_700_000_000, exp: 4_000_000_000 })}`;
  return `${corpo}.${createHmac("sha256", SECRET).update(corpo).digest("base64url")}`;
}

function cliente(role: string): SupabaseClient {
  // ⚠️ `supabase-js` fala com o GATEWAY do Supabase (`/rest/v1/...`); aqui o
  // PostgREST é servido direto na raiz. O fetch só tira esse prefixo — a
  // consulta, os cabeçalhos e o corpo seguem intactos.
  const semPrefixo: typeof fetch = (entrada, init) =>
    fetch(String(entrada).replace("/rest/v1/", "/"), init);
  return createClient(URL, jwt(role), {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
    global: { fetch: semPrefixo },
  });
}

describe.skipIf(!URL || !SECRET)("PostgREST real (max_rows 1000)", () => {
  const db = () => cliente("service_role");

  it("CE-11 · velas: a consulta antiga recebe 1.000 de 8.761; velasDoIntervalo recebe todas", async () => {
    const antes = await db().from("mercado_vela")
      .select("abriu_em, high, low, close, volume")
      .eq("simbolo", "CE1").eq("intervalo", "1h")
      .gte("abriu_em", T0).lte("abriu_em", T0 + 8760 * H)
      .order("abriu_em", { ascending: true });
    expect(antes.error).toBeNull();
    expect(antes.data).toHaveLength(1000);                         // ← o defeito, medido

    const depois = await velasDoIntervalo(db(), "CE1", "1h", T0, T0 + 8760 * H, T0 + 8762 * H);
    expect(depois.daFonte).toBe(0);                               // veio do cache, não da rede
    expect(depois.velas).toHaveLength(8761);
    expect(depois.velas[0].t).toBe(T0);
    expect(depois.velas[8760].t).toBe(T0 + 8760 * H);
    expect(depois.porqueIncompleta).toBeNull();
    console.log(`CE-11 antes=${antes.data?.length} depois=${depois.velas.length}`);
  });

  it("CE-04 · cota: a contagem antiga vê 1.000 de 5.000 rodadas; consumoDaJanela vê 5.000", async () => {
    const dono = "ce-pilot" as Dono;
    const desde = new Date(Date.now() - 86_400_000).toISOString();
    const antes = await db().from("bancada_rodada").select("custo_velas, status").eq("dono", dono).gte("criada_em", desde);
    expect(antes.error).toBeNull();
    const contagemAntiga = (antes.data ?? []).filter((l) => l.status !== "recusada").length;
    expect(contagemAntiga).toBe(1000);                             // ← Pilot sem teto, medido

    const depois = await consumoDaJanela(dono, db());
    expect(depois).toEqual({ rodadas: 5000, velas: 5000 });
    console.log(`CE-04 contagem antes=${contagemAntiga} depois=${depois?.rodadas}`);
  });

  const NOVA = {
    estrategiaId: null, origem: "propria" as const, capitalUsd: 100, simbolos: ["BTC"], intervalo: "1d",
    janelaDe: 1000, janelaAte: 2000, praca: "spot_gate" as const, papel: "taker" as const, params: {},
    custoVelas: 1, custoUnidades: 1,
  };

  it("CE-04 · a 5.001ª rodada do Pilot é RECUSADA pela reserva atômica", async () => {
    const r = await reservarRodada("ce-pilot" as Dono, "evm", db(), NOVA, { rodadas: 5000, unidades: 1e12 });
    expect(r).toMatchObject({ ok: false, motivo: "cota_esgotada", rodadas: 5000 });
  });

  it("CE-04 · 30 requisições HTTP simultâneas, limite 10 → exatamente 10 abrem", async () => {
    const dono = `ce-conc-${Date.now()}` as Dono;
    const rs = await Promise.all(Array.from({ length: 30 }, () =>
      reservarRodada(dono, "evm", cliente("service_role"), NOVA, { rodadas: 10, unidades: 1e12 })));
    const ok = rs.filter((r) => r.ok).length;
    const esgotada = rs.filter((r) => !r.ok && r.motivo === "cota_esgotada").length;
    expect({ ok, esgotada }).toEqual({ ok: 10, esgotada: 20 });
    const { count } = await db().from("bancada_rodada").select("id", { count: "exact", head: true }).eq("dono", dono);
    expect(count).toBe(10);
    console.log(`CE-04 concorrência ok=${ok} recusadas=${esgotada} linhas=${count}`);
  });

  it("CE-04 · ACL: anon e authenticated NÃO chamam a RPC; service_role chama", async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await cliente(role).rpc("bancada_reservar_rodada", {
        p_dono: "intruso", p_chain: "evm", p_estrategia_id: null, p_origem: "propria", p_capital_usd: 1,
        p_simbolos: ["BTC"], p_intervalo: "1d", p_janela_de: 1, p_janela_ate: 2, p_praca: "spot_gate",
        p_papel: "taker", p_params: {}, p_custo_velas: 1, p_custo_unidades: 1, p_limite_rodadas: 99,
        p_orcamento_unidades: 99, p_janela_ms: 86_400_000,
      });
      expect(r.error, role).not.toBeNull();
      expect(r.data, role).toBeNull();
    }
    const { count } = await db().from("bancada_rodada").select("id", { count: "exact", head: true }).eq("dono", "intruso");
    expect(count).toBe(0);
  });
});
