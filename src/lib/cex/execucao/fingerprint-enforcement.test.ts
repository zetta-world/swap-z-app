/**
 * ⚠️⚠️ A120-H (ROUND 5) — O FINGERPRINT DEIXA DE SER CONVENÇÃO.
 *
 * Até o round 4 o vínculo credencial ↔ intent (A120) era garantido só pelo
 * código da rota: quem chamasse o executor DIRETO com `origin: "manual"` e
 * sem fingerprint gravava uma ordem real irreconciliável por desenho (o
 * recovery fecha com `recovery_not_bound`). Este arquivo cobre o
 * endurecimento:
 *
 *   · executor FAIL-CLOSED: manual real sem fingerprint (ou malformado) é
 *     recusado ANTES do intent — zero insert, zero createOrder;
 *   · as ISENÇÕES de propósito: autopilot, DCA e simulado seguem sem
 *     fingerprint (credencial no cofre / recovery pela sessão / nenhum
 *     dinheiro se move);
 *   · a guarda estrutural da migration 0061 endurecida (as duas CHECKs
 *     NOT VALID, sobre o literal REAL de origin);
 *   · a imutabilidade por convenção verificada: nenhum `.update()` em src/
 *     toca `credential_fingerprint`, e o `Update` do types.ts não o expõe;
 *   · a guarda anti-body: nenhuma rota lê `body.credentialFingerprint`.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import { executarOrdemCex, type ContextoDeExecucao, type OrdemPedida }
  from "@/lib/cex/execucao/executor";
import type { RespostaDaVenue } from "@/lib/cex/execucao/venue-primitivo";
import type { CexCredentials, CexId } from "@/lib/cex/types";

const passaLivre = async () => ({ bloqueado: false as const, motivo: null });
type Enviar = (
  id: CexId, creds: CexCredentials,
  req: { symbol: string; side: "buy" | "sell"; type: "market" | "limit";
         amount: number; price?: number | null; clientOrderId: string },
) => Promise<RespostaDaVenue>;
const venue = (r: RespostaDaVenue) => vi.fn<Enviar>(async () => r);
const ACEITA: RespostaDaVenue = { tipo: "aceita",
  ordem: { id: "EXT-H", filled: 10, average: 100, cost: 1000 } as never };

/** Formato válido: 64 hex minúsculos (o HMAC de verdade nasce na rota). */
const FP_VALIDO = "0123456789abcdef".repeat(4);
const ORDEM: OrdemPedida = {
  exchangeId: "binance", symbol: "BTC/USDT", side: "buy", type: "limit",
  qty: 10, price: 100, notionalUsd: 1000,
};
const CREDS: CexCredentials = { apiKey: "k", apiSecret: "s" };
const MANUAL: ContextoDeExecucao = { origin: "manual", autonomous: false };

describe("A120-H — executor fail-closed: manual real sem vínculo NÃO nasce", () => {
  it("⚠️⚠️ manual real SEM fingerprint → recusa ANTES do intent: zero insert, zero createOrder", async () => {
    const b = bancoFalso();
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, MANUAL, ORDEM, CREDS);

    expect(r.desfecho).toBe("recusado");
    if (r.desfecho === "recusado") {
      expect(r.motivo).toBe("fingerprint_ausente");
      // ⚠️ A recusa é PRÉ-INTENT: não há nem rastro de tentativa — quem não
      // pode ser vinculado não existe para o livro.
      expect(r.intentId).toBeNull();
    }
    expect(b.intents).toHaveLength(0);
    expect(enviar).not.toHaveBeenCalled();
    expect(b.fills).toHaveLength(0);
  });

  it("⚠️⚠️ fingerprint MALFORMADO ('abc') → mesma recusa, mesmo zero", async () => {
    const b = bancoFalso();
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre },
      { ...MANUAL, credentialFingerprint: "abc" }, ORDEM, CREDS);

    expect(r.desfecho).toBe("recusado");
    if (r.desfecho === "recusado") {
      expect(r.motivo).toBe("fingerprint_ausente");
      expect(r.porque).toMatch(/malformado/);
      expect(r.intentId).toBeNull();
    }
    expect(b.intents).toHaveLength(0);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("⚠️ 64 hex MAIÚSCULO também é recusado — o formato é minúsculo, como o digest", async () => {
    const b = bancoFalso();
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre },
      { ...MANUAL, credentialFingerprint: FP_VALIDO.toUpperCase() }, ORDEM, CREDS);
    expect(r.desfecho).toBe("recusado");
    if (r.desfecho === "recusado") expect(r.motivo).toBe("fingerprint_ausente");
    expect(b.intents).toHaveLength(0);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("⚠️ o gêmeo positivo: manual real com fingerprint VÁLIDO segue o caminho inteiro", async () => {
    // Sem este, um executor que recusasse TUDO passaria nos testes acima.
    const b = bancoFalso();
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre },
      { ...MANUAL, credentialFingerprint: FP_VALIDO }, ORDEM, CREDS);

    expect(r.desfecho).toBe("submetido");
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(b.intents).toHaveLength(1);
    // E o vínculo gravado é EXATAMENTE o que veio do servidor.
    expect(b.intents[0].credential_fingerprint).toBe(FP_VALIDO);
  });
});

describe("A120-H — as isenções de propósito NÃO são bloqueadas", () => {
  it("⚠️ AUTOPILOT real sem fingerprint segue (credencial no cofre, recovery pela sessão)", async () => {
    const b = bancoFalso();
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre },
      { origin: "autopilot_cron", autonomous: true, walletAddress: "0xdono" },
      { ...ORDEM, side: "sell" }, CREDS);
    expect(r.desfecho).toBe("submetido");
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(b.intents[0].credential_fingerprint).toBeNull();
  });

  it("⚠️ DCA real sem fingerprint segue", async () => {
    const b = bancoFalso();
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre },
      { origin: "dca_cron", autonomous: true, planId: "p1", cycleNumber: 3 },
      { ...ORDEM, side: "sell" }, CREDS);
    expect(r.desfecho).toBe("submetido");
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(b.intents[0].credential_fingerprint).toBeNull();
  });

  it("⚠️ manual SIMULADO sem fingerprint segue — nenhum dinheiro se move", async () => {
    const b = bancoFalso();
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre },
      MANUAL, { ...ORDEM, simulated: true }, null);
    expect(r.desfecho).toBe("submetido");
    expect(enviar).not.toHaveBeenCalled();   // simulado nunca fala com a venue
    expect(b.intents[0].credential_fingerprint).toBeNull();
  });
});

describe("A120-H — guarda estrutural da 0061 endurecida", () => {
  /**
   * ⚠️ LÊ O SQL, não a memória. Se alguém amolecer as CHECKs (tirar o NOT
   * VALID e quebrar o histórico, trocar o literal de origin, afrouxar o
   * formato), esta guarda quebra ANTES do banco.
   */
  const SQL = readFileSync(
    "supabase/migrations/0061_fingerprint_credential_intent.sql", "utf8");

  it("⚠️⚠️ manual real sem fingerprint é CHECK de banco — NOT VALID, com o literal REAL de origin", () => {
    // O literal é o que a rota grava: `origin: ehAutopilot ? "autopilot_browser" : "manual"`.
    expect(SQL.toLowerCase()).toMatch(
      /add constraint cex_intent_manual_real_tem_fingerprint\s+check \(not \(origin = 'manual' and simulated = false\)\s+or credential_fingerprint is not null\) not valid/);
  });

  it("⚠️⚠️ o formato é CHECK de banco — 64 hex minúsculos, NOT VALID", () => {
    expect(SQL.toLowerCase()).toMatch(
      /add constraint cex_intent_fingerprint_formato\s+check \(credential_fingerprint is null\s+or credential_fingerprint ~ '\^\[0-9a-f\]\{64\}\$'\) not valid/);
  });

  it("⚠️ a semântica do NOT VALID está documentada: histórico não revalidado, novos insert/update impostos", () => {
    // A decisão é parte do contrato: NOT VALID existe para NÃO revalidar os
    // intents históricos (fingerprint NULL por desenho) enquanto impõe a
    // regra em todo INSERT/UPDATE posterior. Sem a documentação, a próxima
    // leitura "corrige" para VALID e quebra a migration sobre dados legítimos.
    expect(SQL).toMatch(/NOT VALID/);
    expect(SQL.toLowerCase()).toMatch(/n(ã|a)o (é|e) revalidad|não são revalidadas|nao sao revalidadas/);
    expect(SQL.toLowerCase()).toMatch(/insert e todo update|insert\/update/);
  });
});

describe("A120-H — imutabilidade por convenção verificada, e a guarda anti-body", () => {
  const semComentarios = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");

  function* arquivosTs(dir: string): Generator<string> {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) yield* arquivosTs(p);
      else if (p.endsWith(".ts")) yield p;
    }
  }

  it("⚠️⚠️ NENHUM update aplicativo toca credential_fingerprint — ela nasce no insert e nunca mais é escrita", () => {
    /**
     * O banco NÃO impõe write-once (limitação declarada no cabeçalho da
     * 0061: um trigger seria excesso numa coluna que só a service_role
     * escreve). A imutabilidade é por convenção — e a convenção é esta
     * guarda: qualquer `.update({ ... credential_fingerprint ... })` em
     * src/ quebra este teste.
     */
    const infratores: string[] = [];
    for (const p of arquivosTs("src")) {
      const codigo = semComentarios(readFileSync(p, "utf8"));
      if (/\.update\s*\(\s*\{[^}]*\bcredential_fingerprint\b/.test(codigo)) infratores.push(p);
    }
    expect(infratores).toEqual([]);
  });

  it("⚠️ o Update do types.ts não expõe credential_fingerprint — o tipo já recusa a escrita", () => {
    const types = readFileSync("src/lib/supabase/types.ts", "utf8");
    const i = types.indexOf("cex_execution_intents: {");
    expect(i).toBeGreaterThanOrEqual(0);
    const bloco = types.slice(i, types.indexOf("};", i));
    const update = bloco.slice(bloco.indexOf("Update:"));
    expect(update).not.toContain("credential_fingerprint");
  });

  it("⚠️ nenhuma rota lê body.credentialFingerprint — fingerprint apresentado é autoautorização", () => {
    // Quem apresenta o próprio fingerprint está se autorizando; as rotas o
    // ignoram de propósito (A120). A impressão é calculada NO SERVIDOR.
    for (const rota of ["src/app/api/cex/order/route.ts",
                        "src/app/api/cex/order/status/route.ts"]) {
      expect(semComentarios(readFileSync(rota, "utf8")))
        .not.toMatch(/body\.credentialFingerprint/);
    }
  });
});
