/**
 * A127 Módulo C — recovery histórico usa intent.conexao_id, nunca a sessão atual.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bancoFalso, type BancoFalso } from "@/lib/cex/execucao/banco-falso";
import { guardarConexao, credenciaisDoIntentParaRecovery } from "@/lib/cex/conexoes";
import { reconciliarPendentes, type DependenciasDaReconciliacao } from "@/lib/cex/execucao/reconciliador";
import type { IntentRow } from "@/lib/cex/execucao/intents";
import type { CexCredentials } from "@/lib/cex/types";

const A: CexCredentials = { apiKey: "KEY-A-123456", apiSecret: "SECRET-A-123456" };
const B: CexCredentials = { apiKey: "KEY-B-123456", apiSecret: "SECRET-B-123456" };
let oldHmac: string | undefined;
let oldEnc: string | undefined;

beforeEach(() => {
  oldHmac = process.env.CEX_RECOVERY_HMAC_KEY;
  oldEnc = process.env.AUTOPILOT_ENC_KEY;
  process.env.CEX_RECOVERY_HMAC_KEY = "a127-recovery-hmac-test-key";
  process.env.AUTOPILOT_ENC_KEY = "1".repeat(64);
});
afterEach(() => {
  if (oldHmac === undefined) delete process.env.CEX_RECOVERY_HMAC_KEY;
  else process.env.CEX_RECOVERY_HMAC_KEY = oldHmac;
  if (oldEnc === undefined) delete process.env.AUTOPILOT_ENC_KEY;
  else process.env.AUTOPILOT_ENC_KEY = oldEnc;
});

async function versoes(b: BancoFalso) {
  const r1 = await guardarConexao({
    walletAddress: "0xA127", exchangeId: "binance", credentials: A,
  }, b.cliente);
  if (!r1.ok) throw new Error(r1.erro);
  const r2 = await guardarConexao({
    walletAddress: "0xA127", exchangeId: "binance", credentials: B,
  }, b.cliente);
  if (!r2.ok) throw new Error(r2.erro);
  return { c1: r1.id, c2: r2.id };
}

function plantar(b: BancoFalso, x: {
  id: string; client: string; session: string | null; conexao: string | null;
}) {
  b.intents.push({
    id: x.id, client_order_id: x.client, origin: "autopilot_browser", autonomous: true,
    exchange_id: "binance", symbol: "BTC/USDT", side: "sell", order_type: "market",
    requested_qty: 1, limit_price: null, requested_notional_usd: 100,
    simulated: false, state: "UNKNOWN", state_reason: null, external_order_id: null,
    filled_qty: 0, filled_quote: 0, canceled_qty: 0, fee_total: null, fee_currency: null,
    wallet_address: "0xA127", session_id: x.session, plan_id: null, cycle_number: null,
    conexao_id: x.conexao, strategy_id: null, strategy_version: null, strategy_hash: null,
    certificate_id: null, credential_fingerprint: null,
    created_at: new Date(Date.now() - 120_000).toISOString(), submitted_at: null,
    last_reconciled_at: null, reconcile_attempts: 0,
  });
}

/**
 * ⚠️ O `ler` CARREGA A ASSINATURA REAL. `ReturnType<typeof vi.fn>` é o mock
 * genérico, que o `tsc` recusa em `DependenciasDaReconciliacao` — e um mock
 * sem assinatura não prova nada sobre QUAL credencial a reconciliação usou.
 */
type LerNaVenue = NonNullable<DependenciasDaReconciliacao["ler"]>;
function deps(b: BancoFalso, ler: LerNaVenue) {
  return {
    db: b.cliente,
    elegivel: (intent: IntentRow) => Boolean(intent.conexao_id),
    credenciais: (intent: IntentRow) => credenciaisDoIntentParaRecovery(b.cliente, intent),
    ler,
  };
}

describe("A127.5/A127.10 — identidade histórica no recovery", () => {
  it("A127.5: I1→C1 retired usa credential A; session S1→C2 não injeta B", async () => {
    const b = bancoFalso();
    const { c1, c2 } = await versoes(b);
    b.sessoes.push({ id: "S1", conexao_id: c2 });
    plantar(b, { id: "I1", client: "client-I1", session: "S1", conexao: c1 });

    const vistas: Array<{ client: string; key: string }> = [];
    const ler = vi.fn(async (_ex: string, creds: CexCredentials, alvo: { clientOrderId: string }) => {
      vistas.push({ client: alvo.clientOrderId, key: creds.apiKey });
      return { tipo: "indeterminado" as const, consultados: ["spy"], porque: "teste" };
    });

    await reconciliarPendentes(deps(b, ler), 10);
    expect(vistas).toEqual([{ client: "client-I1", key: A.apiKey }]);
    expect(vistas.some((x) => x.key === B.apiKey)).toBe(false);
  });

  it("A127.10: mesma session S1, I1 fica C1/A e I2 nasce C2/B", async () => {
    const b = bancoFalso();
    const { c1, c2 } = await versoes(b);
    b.sessoes.push({ id: "S1", conexao_id: c2 }); // sessão já rearmada
    plantar(b, { id: "I1", client: "client-I1", session: "S1", conexao: c1 });
    plantar(b, { id: "I2", client: "client-I2", session: "S1", conexao: c2 });

    const vistas = new Map<string, string>();
    const ler = vi.fn(async (_ex: string, creds: CexCredentials, alvo: { clientOrderId: string }) => {
      vistas.set(alvo.clientOrderId, creds.apiKey);
      return { tipo: "indeterminado" as const, consultados: ["spy"], porque: "teste" };
    });
    await reconciliarPendentes(deps(b, ler), 10);

    expect(vistas.get("client-I1")).toBe(A.apiKey);
    expect(vistas.get("client-I2")).toBe(B.apiKey);
  });

  it("legacy session-only: não é elegível, não consulta venue e não herda C2", async () => {
    const b = bancoFalso();
    const { c2 } = await versoes(b);
    b.sessoes.push({ id: "S1", conexao_id: c2 });
    plantar(b, { id: "ILEG", client: "legacy", session: "S1", conexao: null });
    const ler = vi.fn();

    await reconciliarPendentes(deps(b, ler), 10);
    expect(ler).not.toHaveBeenCalled();
    expect(b.intents.find((x) => x.id === "ILEG")?.reconcile_attempts).toBe(0);
  });
});

describe("guarda da superfície global", () => {
  it("cron do autopilot exige conexao_id e usa credenciaisDoIntentParaRecovery", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("src/app/api/autopilot/cron/route.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    expect(fonte).toMatch(/elegivel:\s*\(intent\)\s*=>\s*Boolean\(intent\.conexao_id\)/);
    expect(fonte).toMatch(/credenciaisDoIntentParaRecovery\(dbRec,\s*intent\)/);
    expect(fonte).not.toMatch(/intent\.session_id\s*\?\s*todas\.find/);
  });
});
