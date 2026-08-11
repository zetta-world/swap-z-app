import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";

// The module reads env at import time, so re-import per config with vi.resetModules.
const ATTACKER = "0x000000000000000000000000000000000000dead";
const ROUTER_1 = "0x1111111111111111111111111111111111111111";
const SPENDER_1 = "0x2222222222222222222222222222222222222222";

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  const prev = { ...process.env };
  Object.assign(process.env, env);
  const mod = await import("@/lib/swap/trusted-targets");
  Object.keys(env).forEach((k) => { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; });
  return mod;
}

describe("trusted-targets — the aggregator-drain allow-list (pentest 28/07)", () => {
  it("DEFAULT (no env): no-op — never blocks a live swap", async () => {
    const { checkSwapTarget, checkSwapSpender } = await load({
      NEXT_PUBLIC_ALLOWED_SWAP_TARGETS: undefined,
      NEXT_PUBLIC_ALLOWED_SWAP_SPENDERS: undefined,
    });
    // configured:false → caller does not block. Even the attacker address is
    // "ok" here BECAUSE enforcement is off (the honest default, no breakage).
    expect(checkSwapTarget(1, ATTACKER)).toEqual({ ok: true, configured: false });
    expect(checkSwapSpender(1, ATTACKER)).toEqual({ ok: true, configured: false });
  });

  it("CONFIGURED: blocks an attacker target/spender, allows the pinned one", async () => {
    const { checkSwapTarget, checkSwapSpender } = await load({
      NEXT_PUBLIC_ALLOWED_SWAP_TARGETS: `1:${ROUTER_1}`,
      NEXT_PUBLIC_ALLOWED_SWAP_SPENDERS: `1:${SPENDER_1}`,
    });
    // attack side
    expect(checkSwapTarget(1, ATTACKER).ok).toBe(false);
    expect(checkSwapTarget(1, ATTACKER).configured).toBe(true);
    expect(checkSwapSpender(1, ATTACKER).ok).toBe(false);
    // legit side (case-insensitive)
    expect(checkSwapTarget(1, ROUTER_1.toUpperCase()).ok).toBe(true);
    expect(checkSwapSpender(1, SPENDER_1).ok).toBe(true);
  });

  it("enforcement is PER-CHAIN: a chain with no list stays no-op", async () => {
    const { checkSwapTarget } = await load({ NEXT_PUBLIC_ALLOWED_SWAP_TARGETS: `1:${ROUTER_1}` });
    expect(checkSwapTarget(1, ATTACKER).ok).toBe(false);      // chain 1 enforced
    expect(checkSwapTarget(137, ATTACKER)).toEqual({ ok: true, configured: false }); // chain 137 not
  });

  it("rejects a malformed address when the chain IS enforced", async () => {
    const { checkSwapTarget } = await load({ NEXT_PUBLIC_ALLOWED_SWAP_TARGETS: `1:${ROUTER_1}` });
    expect(checkSwapTarget(1, "0xnotanaddress").ok).toBe(false);
    expect(checkSwapTarget(1, null).ok).toBe(false);
  });
});

/**
 * ⚠️ A CICATRIZ DE 11/08, 01:54 — o dono clicou em trocar USDT por BNB na BSC
 * e a tela devolveu `untrusted swap target — target address malformed`. A
 * trava não estava errada sobre o alvo: **ninguém tinha pedido para conferir
 * alvo nenhum**.
 *
 * A etapa de aprovação de ERC-20 chama `assertTrusted(chain, undefined,
 * spender)` de propósito, para conferir só o gastador. O `spender` tinha
 * `if (spender != null)`; o `to` não tinha o par disso. Com a lista
 * configurada, `undefined` não caía no ramo "não enforçado" — caía no teste de
 * formato e falhava.
 *
 * Duas situações com a mesma cara: "não me pediram para checar o alvo" e "o
 * alvo veio vazio" chegavam as duas como `undefined`.
 *
 * ⚠️ E O DEFEITO ATINGIA METADE DAS TROCAS. Vender token NATIVO não precisa de
 * aprovação, então essa linha nunca rodava — por isso o primeiro swap
 * (BNB→USDT) passou e o segundo (USDT→BNB) morreu. Vender qualquer ERC-20
 * numa cadeia com lista configurada estava quebrado, e nenhum teste via,
 * porque a trava morava dentro do componente.
 */
describe("assertTrusted — `undefined` é pergunta não feita, não resposta vazia", () => {
  const CFG = {
    NEXT_PUBLIC_ALLOWED_SWAP_TARGETS:  `56:${ROUTER_1}`,
    NEXT_PUBLIC_ALLOWED_SWAP_SPENDERS: `56:${SPENDER_1}`,
  };

  it("a etapa de aprovação passa sem alvo, e isso NÃO é alvo malformado", async () => {
    const { assertTrusted } = await load(CFG);
    expect(() => assertTrusted(56, undefined, SPENDER_1)).not.toThrow();
    expect(() => assertTrusted(56, null, SPENDER_1)).not.toThrow();
  });

  it("e continua barrando o gastador errado na MESMA chamada sem alvo", async () => {
    const { assertTrusted } = await load(CFG);
    expect(() => assertTrusted(56, undefined, ATTACKER)).toThrow(/untrusted approval spender/);
  });

  /** ⚠️ A trava não afrouxou: alvo PRESENTE e fora da lista continua barrado. */
  it("alvo presente e fora da lista continua barrado", async () => {
    const { assertTrusted } = await load(CFG);
    expect(() => assertTrusted(56, ATTACKER, undefined)).toThrow(/untrusted swap target/);
    expect(() => assertTrusted(56, ROUTER_1, undefined)).not.toThrow();
  });

  /**
   * ⚠️ ALVO PRESENTE E VAZIO É OUTRA COISA — string vazia é alguém dizendo "o
   * alvo é isto", e isto não é endereço. Continua barrado, senão a correção
   * teria trocado um defeito por um buraco.
   */
  it("string vazia NÃO é `não confere` — é alvo malformado, e barra", async () => {
    const { assertTrusted } = await load(CFG);
    expect(() => assertTrusted(56, "", undefined)).toThrow(/target address malformed/);
    expect(() => assertTrusted(56, "0xabc", undefined)).toThrow(/target address malformed/);
  });

  it("sem lista configurada, nada barra — o padrão continua no-op", async () => {
    const { assertTrusted } = await load({
      NEXT_PUBLIC_ALLOWED_SWAP_TARGETS: undefined,
      NEXT_PUBLIC_ALLOWED_SWAP_SPENDERS: undefined,
    });
    expect(() => assertTrusted(56, ATTACKER, ATTACKER)).not.toThrow();
  });

  /** A cadeia sem lista não herda a lista de outra cadeia. */
  it("cadeia sem lista própria não é enforçada", async () => {
    const { assertTrusted } = await load(CFG);
    expect(() => assertTrusted(1, ATTACKER, ATTACKER)).not.toThrow();
  });
});

/**
 * ⚠️ ORDEM É DINHEIRO: conferir DEPOIS de aprovar queima gás à toa.
 *
 * A aprovação de ERC-20 é uma transação de verdade e custa. A conferência do
 * alvo ficava DEPOIS dela nos dois caminhos — 0x e LI.FI — então um alvo fora
 * da lista deixava o usuário pagar o `approve` e só então ser barrado. Gás
 * gasto por uma troca que nunca ia acontecer.
 *
 * O dono deste projeto pediu explicitamente para não perder centavo de gás.
 * Isto é a trava disso.
 */
describe("o alvo é conferido ANTES de a aprovação queimar gás", () => {
  const exec = readFileSync("src/components/swap/ExecuteSwap.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  it("no caminho do 0x, a conferência do alvo precede o approve", () => {
    const iCheck   = exec.indexOf("assertTrusted(targetChainId, q.transaction?.to");
    const iApprove = exec.indexOf("functionName: \"approve\"");
    expect(iCheck, "a conferência adiantada sumiu").toBeGreaterThan(-1);
    expect(iApprove).toBeGreaterThan(-1);
    expect(iCheck).toBeLessThan(iApprove);
  });

  it("no caminho da LI.FI também", () => {
    const iCheck   = exec.indexOf("assertTrusted(targetChainId, tx.to");
    const iApprove = exec.indexOf("args:         [lfQuote.estimate.approvalAddress");
    expect(iCheck).toBeGreaterThan(-1);
    expect(iApprove).toBeGreaterThan(-1);
    expect(iCheck).toBeLessThan(iApprove);
  });

  /**
   * ⚠️ E A CONFERÊNCIA TARDIA NÃO PODE SUMIR. No 0x a cotação é REFEITA depois
   * da aprovação (calldata nova), então o alvo pode mudar — a adiantada é
   * economia, a tardia é a que decide. Trocar uma pela outra trocaria uma
   * trava de segurança por uma de custo.
   */
  it("e a conferência autoritativa, depois da cotação nova, continua lá", () => {
    expect(exec).toContain("assertTrusted(targetChainId, q.transaction.to, undefined)");
  });
});
