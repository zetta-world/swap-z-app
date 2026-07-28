import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
