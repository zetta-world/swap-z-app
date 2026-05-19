"use client";

import { useEffect, useRef, useState } from "react";
import type { ChainId } from "@/lib/chains";
import type { ZxPriceResponse } from "@/lib/api/zerox";
import { isZeroXSupported } from "@/lib/api/zerox";

interface Args {
  chain:       ChainId;
  sellToken:   string;     // "native" | address
  buyToken:    string;
  sellAmount:  string;     // BASE UNITS (already shifted by decimals)
  taker?:      string;
  slippageBps?: number;
  enabled?:    boolean;
  debounceMs?: number;
}

export interface PriceState {
  data:        ZxPriceResponse | null;
  loading:     boolean;
  error:       string | null;
  supported:   boolean;
  refetch:     () => void;
}

/**
 * Debounced indicative-quote fetcher. Calls /api/quote?mode=price with the
 * current sellAmount; cancels in-flight requests when args change.
 *
 * Returns `supported: false` for chains 0x doesn't cover (e.g. Solana) —
 * callers should fall back to mock pricing in that case.
 */
export function useZeroXPrice(args: Args): PriceState {
  const [state, setState] = useState<PriceState>({
    data: null, loading: false, error: null, supported: isZeroXSupported(args.chain),
    refetch: () => {},
  });
  const ctrlRef    = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef    = useRef(0);

  const {
    chain, sellToken, buyToken, sellAmount, taker, slippageBps,
    enabled = true, debounceMs = 400,
  } = args;

  const supported = isZeroXSupported(chain);

  useEffect(() => {
    setState((s) => ({ ...s, supported }));
  }, [supported]);

  useEffect(() => {
    if (!enabled || !supported || !sellAmount || sellAmount === "0" || sellToken === buyToken) {
      setState((s) => ({ ...s, data: null, loading: false, error: null }));
      return;
    }

    // Bump tick so a stale request doesn't overwrite a newer one
    const tick = ++tickRef.current;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      setState((s) => ({ ...s, loading: true, error: null }));

      try {
        const params = new URLSearchParams({
          mode:       "price",
          chain,
          sellToken,
          buyToken,
          sellAmount,
        });
        if (taker)        params.set("taker", taker);
        if (slippageBps)  params.set("slippageBps", String(slippageBps));

        const res = await fetch(`/api/quote?${params.toString()}`, { signal: ctrl.signal });
        const body = await res.json();
        if (tick !== tickRef.current) return;  // stale
        if (!res.ok || !body.ok) {
          const err = body.error || body.message || `HTTP ${res.status}`;
          setState((s) => ({ ...s, data: null, loading: false, error: err }));
          return;
        }
        setState({
          data:      body.result as ZxPriceResponse,
          loading:   false,
          error:     null,
          supported: true,
          refetch:   () => { tickRef.current++; /* triggered by deps */ },
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (tick !== tickRef.current) return;
        setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
      }
    }, debounceMs);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      ctrlRef.current?.abort();
    };
  }, [chain, sellToken, buyToken, sellAmount, taker, slippageBps, enabled, supported, debounceMs]);

  return state;
}
