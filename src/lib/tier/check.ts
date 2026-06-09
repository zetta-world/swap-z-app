import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { WalletChain } from "@/lib/supabase/types";
import { isTier, type Tier, type TierResult, type TierSource } from "./types";

/**
 * Server-side tier resolution for a wallet. The flow is:
 *
 *   1. tier_cache (Supabase) — if a fresh row exists, return it. This absorbs
 *      the bulk of traffic so we don't hit Helius on every page load.
 *   2. On-chain check (Helius getAssetsByOwner) — does the wallet hold an NFT
 *      from ZSWAP_COLLECTION_ADDRESS? Derive the tier from the pass, cache it.
 *   3. Fallback — "free". Returned whenever Supabase or Helius is unconfigured,
 *      or the wallet holds no membership pass. NEVER throws: a missing backend
 *      degrades to free, it does not crash the request.
 *
 * Admin rows (source='admin') seeded directly in tier_cache short-circuit the
 * on-chain check — that's how we exercise gated surfaces before 5.4 ships.
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function freeResult(): TierResult {
  return { tier: "free", source: "default", expiresAt: Date.now() + CACHE_TTL_MS };
}

export async function getTierForWallet(address: string, chain: WalletChain): Promise<TierResult> {
  const db = getSupabaseAdmin();
  if (!db) return freeResult();

  // ── 1. Cache hit ────────────────────────────────────────────────────────
  try {
    const { data } = await db
      .from("tier_cache")
      .select("tier, source, expires_at")
      .eq("wallet_address", address)
      .maybeSingle();
    if (data && isTier(data.tier) && new Date(data.expires_at).getTime() > Date.now()) {
      return {
        tier: data.tier,
        source: data.source as TierSource,
        expiresAt: new Date(data.expires_at).getTime(),
      };
    }
  } catch (err) {
    console.warn("[tier] cache read failed:", err instanceof Error ? err.message : err);
  }

  // ── 2. On-chain check (Solana only — passes live on Solana) ──────────────
  if (chain === "solana") {
    const onchain = await checkSolanaNftTier(address).catch((err) => {
      console.warn("[tier] helius check failed:", err instanceof Error ? err.message : err);
      return null;
    });
    if (onchain) {
      const result: TierResult = {
        tier: onchain,
        source: "nft",
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
      await writeCache(address, result).catch(() => {});
      return result;
    }
  }

  // ── 3. Fallback ──────────────────────────────────────────────────────────
  // Cache the "free" verdict too, so a wallet with no pass doesn't re-hit
  // Helius on every request for the next 5 minutes.
  const free = freeResult();
  await writeCache(address, { ...free, source: "nft" }).catch(() => {});
  return free;
}

async function writeCache(address: string, result: TierResult): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("tier_cache").upsert(
    {
      wallet_address: address,
      tier: result.tier,
      // "default" isn't a valid DB source; store the free fallback as an nft check.
      source: result.source === "default" ? "nft" : result.source,
      checked_at: new Date().toISOString(),
      expires_at: new Date(result.expiresAt).toISOString(),
    },
    { onConflict: "wallet_address" },
  );
}

/**
 * Queries Helius DAS `getAssetsByOwner` and maps a held membership pass to its
 * tier. Returns null when the wallet holds no pass, or when Helius / the
 * collection address are unconfigured (the latter is the normal state until
 * 5.4 mints the collection).
 */
async function checkSolanaNftTier(owner: string): Promise<Tier | null> {
  const rpc = process.env.HELIUS_RPC_URL;
  const collection = process.env.ZSWAP_COLLECTION_ADDRESS;
  if (!rpc || !collection) return null;

  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "zswap-tier",
      method: "getAssetsByOwner",
      params: { ownerAddress: owner, page: 1, limit: 1000 },
    }),
    // Helius is the slowest hop; cap it so a stalled RPC can't hang the gate.
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`helius ${res.status}`);

  const json = await res.json();
  const items: unknown[] = json?.result?.items ?? [];

  let best: Tier | null = null;
  for (const item of items) {
    const tier = passToTier(item, collection);
    if (tier && (!best || rankOf(tier) > rankOf(best))) best = tier;
  }
  return best;
}

function rankOf(t: Tier): number {
  return t === "pilot" ? 3 : t === "trader" ? 2 : t === "pro" ? 1 : 0;
}

/**
 * Maps a single DAS asset to a tier IF it belongs to our collection. The tier
 * is read from a "tier" attribute on the NFT's metadata; absent that, holding
 * any pass in the collection grants at least "pro".
 */
function passToTier(asset: unknown, collection: string): Tier | null {
  if (!asset || typeof asset !== "object") return null;
  const a = asset as Record<string, any>;

  const grouping: any[] = a.grouping ?? [];
  const inCollection = grouping.some(
    (g) => g?.group_key === "collection" && g?.group_value === collection,
  );
  if (!inCollection) return null;

  const attrs: any[] = a.content?.metadata?.attributes ?? [];
  const tierAttr = attrs.find(
    (x) => String(x?.trait_type ?? "").toLowerCase() === "tier",
  );
  const raw = String(tierAttr?.value ?? "").toLowerCase();
  if (isTier(raw) && raw !== "free") return raw;

  // In-collection pass with no recognizable tier trait → baseline membership.
  return "pro";
}
