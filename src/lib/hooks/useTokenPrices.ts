"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Token } from "@/lib/tokens";

interface PricesResponse {
  ok:     boolean;
  prices: Record<string, number | null>;
  ts:     number;
}

interface UseTokenPricesResult {
  prices:  Record<string, number | null>;
  loading: boolean;
  error:   string | null;
}

const REFRESH_MS = 60_000;

function tokenKey(t: Token): string {
  return `${t.chain}:${t.address.toLowerCase()}`;
}

/**
 * Batch-fetch live USD prices for a set of tokens.
 *
 *   const { prices } = useTokenPrices([fromToken, toToken]);
 *   const ethUsd = prices["ethereum:native"];
 *
 * Internals:
 *   - One /api/prices call per unique token-set, refreshed every 60 s.
 *   - AbortController cancels stale in-flight requests when the token
 *     list changes (typing in the swap card switches the pair fast and
 *     we don't want late responses overwriting a newer one).
 *   - Returned map is keyed by "<chain>:<address>" — use `tokenPriceKey`
 *     to look up a specific token. Missing entries come back as `null`,
 *     never as a fabricated fallback. Callers should hide USD when the
 *     value is null, not invent a number.
 */
export function useTokenPrices(tokens: Array<Token | undefined>): UseTokenPricesResult {
  // Stable cache key — only triggers refetch when the actual set changes.
  const queryKey = useMemo(() => {
    const present = tokens.filter((t): t is Token => !!t);
    return [...new Set(present.map(tokenKey))].sort().join(",");
  }, [tokens]);

  const [prices,  setPrices]  = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!queryKey) {
      setPrices({});
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const fetchOnce = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/prices?tokens=${encodeURIComponent(queryKey)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as PricesResponse;
        if (cancelled || ctrl.signal.aborted) return;
        setPrices(body.prices ?? {});
        setError(null);
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled && !ctrl.signal.aborted) setLoading(false);
      }
    };

    void fetchOnce();
    const id = setInterval(fetchOnce, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      ctrl.abort();
    };
  }, [queryKey]);

  return { prices, loading, error };
}

/**
 * Convenience wrapper for a single token. Same fetch + cache strategy
 * as useTokenPrices; useful in components that only care about one
 * price (e.g. an action card showing "$3,420 per ETH").
 */
export function useTokenPrice(token: Token | undefined): {
  priceUsd: number | null;
  loading:  boolean;
  error:    string | null;
} {
  const { prices, loading, error } = useTokenPrices(token ? [token] : []);
  const priceUsd = token ? prices[tokenKey(token)] ?? null : null;
  return { priceUsd, loading, error };
}

/** Public helper for looking up a price in the map returned above. */
export function tokenPriceKey(token: Token): string {
  return tokenKey(token);
}
