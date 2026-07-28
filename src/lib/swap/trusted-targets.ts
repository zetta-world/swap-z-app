/**
 * Swap target / spender allow-list (pentest 28/07 — aggregator drain class).
 *
 * ExecuteSwap approves an ERC-20 spender and sends a transaction whose `to`
 * and `data` come VERBATIM from /api/quote → 0x/LiFi. If that proxy or the
 * upstream response is compromised/poisoned, it can return an ATTACKER spender
 * (→ the user signs an approval to the attacker) or an attacker `to` (→ funds
 * routed away). The canonical defense every serious aggregator adds is to pin
 * the known router/spender addresses per chain and refuse anything else.
 *
 * WHY THIS IS ENV-DRIVEN AND DEFAULTS TO NO-OP: the correct address list is
 * chain- and version-specific and MUST be verified against 0x/LiFi's current
 * deployments. Hardcoding a stale/wrong address would break every swap on that
 * chain (worse than the risk it closes). So enforcement is OFF until the owner
 * populates a VERIFIED list via env — then it becomes a hard block. Until then
 * this returns { configured:false }, and the caller does not block, so shipping
 * it changes nothing about live swaps.
 *
 * Owner action to enforce (verify each address against the official docs first):
 *   NEXT_PUBLIC_ALLOWED_SWAP_TARGETS='1:0xRouterA,0xRouterB;137:0xRouterC'
 *   NEXT_PUBLIC_ALLOWED_SWAP_SPENDERS='1:0xSpenderA;137:0xSpenderC'
 * (chainId:comma-separated-addresses, semicolon-separated per chain.)
 * Reference points to verify (do NOT trust blindly — confirm current):
 *   · Permit2 (same on all chains): 0x000000000022D473030F116dDEE9F6B43aC78BA3
 *   · 0x AllowanceHolder / Settler and the LiFi diamond: per-chain, from their
 *     official address pages.
 */

function parseChainMap(raw: string | undefined): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  if (!raw) return out;
  for (const chunk of raw.split(";")) {
    const [chainStr, addrs] = chunk.split(":");
    const chainId = Number((chainStr || "").trim());
    if (!Number.isInteger(chainId) || !addrs) continue;
    const set = new Set(
      addrs.split(",").map((a) => a.trim().toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a)),
    );
    if (set.size) out.set(chainId, set);
  }
  return out;
}

const TARGETS  = parseChainMap(process.env.NEXT_PUBLIC_ALLOWED_SWAP_TARGETS);
const SPENDERS = parseChainMap(process.env.NEXT_PUBLIC_ALLOWED_SWAP_SPENDERS);

export interface TrustCheck { ok: boolean; configured: boolean; reason?: string }

function check(map: Map<number, Set<string>>, chainId: number, addr: string | null | undefined, kind: string): TrustCheck {
  const set = map.get(chainId);
  if (!set || set.size === 0) return { ok: true, configured: false };   // not enforced on this chain
  const a = (addr || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) return { ok: false, configured: true, reason: `${kind} address malformed` };
  return set.has(a)
    ? { ok: true, configured: true }
    : { ok: false, configured: true, reason: `${kind} ${a} not in the allow-list for chain ${chainId}` };
}

/** Verify the router `to` of a swap transaction. */
export function checkSwapTarget(chainId: number, to: string | null | undefined): TrustCheck {
  return check(TARGETS, chainId, to, "target");
}

/** Verify the ERC-20 spender being approved. */
export function checkSwapSpender(chainId: number, spender: string | null | undefined): TrustCheck {
  return check(SPENDERS, chainId, spender, "spender");
}
