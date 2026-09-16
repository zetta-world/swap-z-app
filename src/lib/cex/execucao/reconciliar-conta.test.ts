/**
 * ⚠️⚠️ J1–J8 — A RECONCILIAÇÃO DE CONTA INDEPENDENTE DE INTENTS (A103).
 *
 * A reconciliação por intent só roda quando há ordem em dúvida. Um saque do
 * cliente ou uma venda manual no app da corretora não geram intent — e deixam
 * o bot decidindo sobre um inventário que já não existe. Estes testes exercem
 * `reconciliarConta` contra banco e venue falsos, e travam o hook no cron.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { reconciliarConta, type PosicaoInterna } from "@/lib/cex/execucao/reconciliar-conta";
import type { AutopilotSessionRow, Database } from "@/lib/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CexBalance, CexCredentials } from "@/lib/cex/types";

const CREDS: CexCredentials = { apiKey: "k12345678", apiSecret: "s12345678" };

/** Banco mínimo: só o que `reconciliarConta` toca — updates em autopilot_sessions. */
function dbFalso() {
  const updates: Array<{ patch: Record<string, unknown>; id: string }> = [];
  let falharUpdate = false;
  const db = {
    from: (tabela: string) => {
      if (tabela !== "autopilot_sessions") throw new Error(`tabela inesperada: ${tabela}`);
      return {
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: string) => {
            updates.push({ patch, id });
            return Promise.resolve({ error: falharUpdate ? { message: "db fora" } : null });
          },
        }),
      };
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, updates,
           falhe: () => { falharUpdate = true; } };
}

function sessao(extra: Partial<AutopilotSessionRow> = {}): AutopilotSessionRow {
  return { id: "sess-1", exchange_id: "binance", wallet_address: "0xabc",
           saldo_baseline: null, quarentena_em: null, quarentena_motivo: null,
           ...extra } as AutopilotSessionRow;
}

/** 1 ETH a US$ 3.000: tolerância = max($5, 2%) = $60 → 0,02 ETH. */
const POS_ETH: PosicaoInterna = { base: "ETH", baseAmount: 1, precoRef: 3_000 };
const SALDO_ETH = (free: number): CexBalance[] =>
  [{ asset: "ETH", free, used: 0, total: free, usdValue: free * 3_000 }];

describe("A103 — reconciliarConta", () => {
  it("J1 ⚠️⚠️ saldo livre abaixo do inventário (além da tolerância) → DERIVA + quarentena gravada", async () => {
    const b = dbFalso();
    // O bot acha que tem 1 ETH; a corretora diz que há 0,5 livre. Alguém mexeu.
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH], lerSaldos: async () => SALDO_ETH(0.5),
    }, sessao(), CREDS);
    if (r.resultado !== "deriva") throw new Error(`esperava deriva, veio ${r.resultado}`);
    expect(r.achados[0]).toContain("ACCOUNT_DRIFT");
    expect(r.achados[0]).toContain("ETH");
    expect(r.quarentenaGravada).toBe(true);
    const q = b.updates.find((u) => u.patch.quarentena_em);
    expect(q, "a quarentena tem de ser gravada na sessão").toBeTruthy();
    expect(String(q!.patch.quarentena_motivo)).toContain("ACCOUNT_DRIFT");
  });

  it("J2 depósito a mais NUNCA é deriva — saldo acima do inventário passa", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH], lerSaldos: async () => SALDO_ETH(5),
    }, sessao(), CREDS);
    expect(r.resultado).toBe("sem_drift");
    expect(b.updates.some((u) => u.patch.quarentena_em)).toBe(false);
  });

  it("J3 dentro da tolerância (max $5, 2%) NÃO é deriva", async () => {
    const b = dbFalso();
    // 0,99 ETH livre vs 1,0 interno: diferença $30 < $60 de tolerância.
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH], lerSaldos: async () => SALDO_ETH(0.99),
    }, sessao(), CREDS);
    expect(r.resultado).toBe("sem_drift");
    // E 0,95 ETH (diferença $150 > $60) DERIVA — tolerância não cobre saque.
    const b2 = dbFalso();
    const r2 = await reconciliarConta({
      db: b2.db, lerPosicoes: async () => [POS_ETH], lerSaldos: async () => SALDO_ETH(0.95),
    }, sessao(), CREDS);
    expect(r2.resultado).toBe("deriva");
  });

  it("J4 ⚠️⚠️ falha ao ler o saldo NÃO conclui 'sem drift' — fail-closed, sem quarentena", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH], lerSaldos: async () => undefined,
    }, sessao(), CREDS);
    if (r.resultado !== "leitura_falhou") throw new Error(`veio ${r.resultado}`);
    expect(r.etapa).toBe("saldos");
    // ⚠️ Nem quarentena (não há evidência) nem "sem drift" (não há leitura).
    expect(b.updates.some((u) => u.patch.quarentena_em)).toBe(false);
  });

  it("J5 falha ao ler as posições internas também é leitura_falhou", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => undefined, lerSaldos: async () => SALDO_ETH(1),
    }, sessao(), CREDS);
    if (r.resultado !== "leitura_falhou") throw new Error(`veio ${r.resultado}`);
    expect(r.etapa).toBe("posicoes");
  });

  it("J6 a PRIMEIRA reconciliação grava o baseline; a segunda não sobrescreve", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [], lerSaldos: async () => SALDO_ETH(2),
    }, sessao(), CREDS);
    if (r.resultado !== "sem_drift") throw new Error(`veio ${r.resultado}`);
    expect(r.baselineGravada).toBe(true);
    const base = b.updates.find((u) => u.patch.saldo_baseline);
    expect(base, "snapshot da primeira reconciliação").toBeTruthy();

    const b2 = dbFalso();
    const r2 = await reconciliarConta({
      db: b2.db, lerPosicoes: async () => [], lerSaldos: async () => SALDO_ETH(2),
    }, sessao({ saldo_baseline: { lido_em: "2025-01-01", saldos: [] } }), CREDS);
    if (r2.resultado !== "sem_drift") throw new Error(`veio ${r2.resultado}`);
    expect(r2.baselineGravada).toBe(false);
    expect(b2.updates.some((u) => u.patch.saldo_baseline)).toBe(false);
  });

  it("J8 sem posições abertas não há o que derivar — e nada é acusado", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [], lerSaldos: async () => [],
    }, sessao({ saldo_baseline: { ok: true } }), CREDS);
    expect(r.resultado).toBe("sem_drift");
    if (r.resultado === "sem_drift") expect(r.conferidos).toBe(0);
    expect(b.updates.some((u) => u.patch.quarentena_em)).toBe(false);
  });

  it("quarentena que não grava é dita como não gravada — nunca 'preso' de mentira", async () => {
    const b = dbFalso();
    b.falhe();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH], lerSaldos: async () => SALDO_ETH(0.1),
    }, sessao(), CREDS);
    if (r.resultado !== "deriva") throw new Error(`veio ${r.resultado}`);
    expect(r.quarentenaGravada).toBe(false);
  });
});

describe("J7 — o hook no cron do autopilot", () => {
  const semComentarios = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");
  const CRON = semComentarios(readFileSync("src/app/api/autopilot/cron/route.ts", "utf8"));

  it("⚠️⚠️ `reconciliarConta` roda por sessão, ANTES de abrir novas entradas", () => {
    const iRec = CRON.indexOf("reconciliarConta(");
    expect(iRec).toBeGreaterThan(-1);
    // Antes do scan e de qualquer disparo.
    expect(iRec).toBeLessThan(CRON.indexOf("runAutopilotCexScan("));
    expect(iRec).toBeLessThan(CRON.indexOf("executarOrdemCex("));
  });

  it("⚠️⚠️ sessão já em quarentena nem reconcilia — entradas presas direto", () => {
    expect(CRON).toMatch(/if \(s\.quarentena_em\) \{\s*entradasLiberadas = false/);
  });

  it("⚠️⚠️ deriva e leitura falha prendem as ENTRADAS, e a deriva vira evento account_drift", () => {
    expect(CRON).toMatch(/rc\.resultado === "deriva"/);
    expect(CRON).toMatch(/recordEvent\("account_drift"/);
    expect(CRON).toMatch(/rc\.resultado === "leitura_falhou"/);
  });

  it("⚠️⚠️⚠️ o gate prende BUY e NUNCA prende SELL", () => {
    // O ramo de venda (`if (vendaDe)`) vem ANTES do gate e termina em
    // `continue` — saída nunca passa por `!entradasLiberadas`.
    const iVenda = CRON.indexOf("if (vendaDe) {");
    const iGate = CRON.indexOf("if (!entradasLiberadas) {");
    const iCompra = CRON.indexOf('symbol: intent.symbol, side: "buy"');
    expect(iVenda).toBeGreaterThan(-1);
    expect(iGate).toBeGreaterThan(iVenda);
    expect(iGate).toBeLessThan(iCompra);
  });
});
