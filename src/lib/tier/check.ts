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

/**
 * O fallback gratuito, com a origem HONESTA.
 *
 * ⚠️ `porque` distingue os dois motivos de alguém acabar no Free, que antes
 * eram a mesma linha no banco: a checagem rodou e não achou passe
 * (`sem_pass`), ou a checagem nem rodou (`nao_checado`).
 */
function freeResult(porque: "sem_pass" | "nao_checado"): TierResult {
  return { tier: "free", source: porque, expiresAt: Date.now() + CACHE_TTL_MS };
}

export async function getTierForWallet(address: string, chain: WalletChain): Promise<TierResult> {
  const db = getSupabaseAdmin();
  // Sem banco não há como checar nada — isso é ausência de medição.
  if (!db) return freeResult("nao_checado");

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

  /**
   * ── 3. Fallback ────────────────────────────────────────────────────────
   *
   * ⚠️ AQUI ESTAVA A MENTIRA. Antes: `writeCache(address, { ...free, source:
   * "nft" })`, com o comentário admitindo que `"default"` não passava no
   * CHECK do banco. Resultado: carteira EVM — que nem chega no bloco 2, porque
   * os passes vivem na Solana — ficava gravada como "checamos e não tem".
   *
   * Agora a origem diz qual dos dois foi:
   *   · Solana que chegou até aqui  → a checagem RODOU e não achou: `sem_pass`
   *   · qualquer outra cadeia       → a checagem NEM RODOU: `nao_checado`
   *
   * O cache continua sendo gravado (evita bater no Helius a cada request),
   * mas agora ele guarda a verdade.
   */
  const porque = chain === "solana" ? "sem_pass" : "nao_checado";
  const free = freeResult(porque);
  await writeCache(address, free).catch(() => {});
  return free;
}

/**
 * ⚠️⚠️ O TIER DE MUITAS CARTEIRAS DE UMA VEZ (CE-09) — para o tique do papel.
 *
 * O tique relia o tier de cada dono a cada passagem: 1 leitura do `tier_cache`
 * e, como o cache vale 5 minutos e o tique roda a cada 30, quase sempre o
 * caminho inteiro (Helius para Solana, e uma escrita do resultado). Com a fila
 * consertada para incluir TODOS os donos, isso seria 850 leituras + 850
 * escritas (+ Helius) por tique no direito contratado.
 *
 * Aqui o `tier_cache` é lido em LOTES de 100 carteiras. Linha fresca — dentro
 * de `toleranciaMs` além do `expires_at` — vale. O resto passa pelo caminho de
 * sempre (`getTierForWallet`), com a mesma regra, a mesma Helius e a mesma
 * escrita: nada muda para quem não está no cache.
 *
 * ⚠️ `toleranciaMs` > 0 É UMA ESCOLHA DE QUEM CHAMA, declarada: o tique usa 55
 * minutos — um rebaixamento de plano corta a mesa de papel em até ~60 min, em
 * vez de no tique seguinte. Papel não move dinheiro; o custo evitado é uma
 * chamada à Helius por dono por tique. Rotas de usuário NÃO usam isto.
 */
export async function getTiersForWallets(
  carteiras: ReadonlyArray<{ address: string; chain: WalletChain }>,
  toleranciaMs = 0,
): Promise<Map<string, TierResult>> {
  const out = new Map<string, TierResult>();
  const db = getSupabaseAdmin();
  const unicas = [...new Map(carteiras.map((c) => [c.address, c])).values()];
  if (db) {
    const LOTE = 100;
    const agora = Date.now();
    for (let i = 0; i < unicas.length; i += LOTE) {
      const fatia = unicas.slice(i, i + LOTE);
      try {
        const { data } = await db.from("tier_cache")
          .select("wallet_address, tier, source, expires_at")
          .in("wallet_address", fatia.map((c) => c.address));
        for (const r of (data ?? []) as Array<{ wallet_address: string; tier: string; source: string; expires_at: string }>) {
          const expira = new Date(r.expires_at).getTime();
          if (isTier(r.tier) && expira + toleranciaMs > agora) {
            out.set(r.wallet_address, { tier: r.tier, source: r.source as TierSource, expiresAt: expira });
          }
        }
      } catch {
        // Lote que falha cai para o caminho individual, abaixo — nunca vira "free" calado.
      }
    }
  }
  for (const c of unicas) {
    if (!out.has(c.address)) out.set(c.address, await getTierForWallet(c.address, c.chain));
  }
  return out;
}

async function writeCache(address: string, result: TierResult): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("tier_cache").upsert(
    {
      wallet_address: address,
      tier: result.tier,
      /**
       * ⚠️ A ORIGEM VAI DIRETO, sem tradução. Aqui existia
       * `result.source === "default" ? "nft" : result.source` — a segunda
       * metade da mentira de 11/08: mesmo que quem chamasse dissesse a verdade,
       * esta linha a reescrevia para `"nft"` na hora de gravar.
       *
       * O banco agora aceita `sem_pass` e `nao_checado` (migração 0022), então
       * não há mais nada a traduzir. Se um valor novo aparecer, o CHECK do
       * banco RECUSA — que é o comportamento certo: falha visível em vez de
       * rótulo trocado em silêncio.
       */
      source: result.source,
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
