"use client";

import { useEffect, useRef, useState } from "react";
import type { ChainId } from "@/lib/chains";
import type { NormalizedQuote } from "@/lib/api/quote-types";

interface Args {
  fromChain:    ChainId;
  toChain:      ChainId;
  sellToken:    string;
  buyToken:     string;
  sellAmount:   string;     // base units
  taker?:       string;
  slippageBps?: number;
  enabled?:     boolean;
  debounceMs?:  number;
}

export interface QuotesState {
  quotes:      NormalizedQuote[];
  loading:     boolean;
  error:       string | null;
  isCrossChain: boolean;
}

/**
 * Debounced multi-aggregator quote fetcher. Returns all available routes
 * (0x for same-chain + LiFi for any chain pair), ranked by best output.
 */
export function useQuotes(args: Args): QuotesState {
  const [state, setState] = useState<QuotesState>({
    quotes: [], loading: false, error: null, isCrossChain: false,
  });
  const ctrlRef     = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef     = useRef(0);

  const {
    fromChain, toChain, sellToken, buyToken, sellAmount,
    taker, slippageBps, enabled = true, debounceMs = 500,
  } = args;

  useEffect(() => {
    if (!enabled || !sellAmount || sellAmount === "0") {
      setState((s) => ({ ...s, quotes: [], loading: false, error: null }));
      return;
    }
    if (fromChain === toChain && sellToken === buyToken) {
      setState((s) => ({ ...s, quotes: [], loading: false, error: null }));
      return;
    }

    const tick = ++tickRef.current;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      setState((s) => ({ ...s, loading: true, error: null }));

      try {
        const params = new URLSearchParams({
          mode:      "list",
          fromChain, toChain, sellToken, buyToken, sellAmount,
        });
        if (taker)       params.set("taker", taker);
        if (slippageBps) params.set("slippageBps", String(slippageBps));

        const res  = await fetch(`/api/quote?${params.toString()}`, { signal: ctrl.signal });
        const body = await res.json();
        if (tick !== tickRef.current) return;

        if (!res.ok || !body.ok) {
          const err = body.error || body.message || `HTTP ${res.status}`;
          setState({ quotes: [], loading: false, error: err, isCrossChain: fromChain !== toChain });
          return;
        }
        setState({
          quotes:       body.quotes ?? [],
          loading:      false,
          error:        null,
          isCrossChain: body.isCrossChain ?? (fromChain !== toChain),
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
  }, [fromChain, toChain, sellToken, buyToken, sellAmount, taker, slippageBps, enabled, debounceMs]);

  return state;
}
