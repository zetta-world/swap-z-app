"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tierSatisfies, type Tier, type TierSource } from "./types";

/**
 * Client-side tier state. Wraps GET /api/tier in react-query so every gate on
 * a page shares ONE network request (deduped by key) and a 5-minute cache —
 * matching the server-side tier_cache TTL so the two layers don't fight.
 */

export interface TierState {
  authenticated: boolean;
  address:  string | null;
  chain:    "evm" | "solana" | null;
  tier:     Tier;
  source:   TierSource | "default";
  /** Whether gates are actively enforced (TIER_GATES_ENABLED on the server). */
  gatesEnabled: boolean;
}

const TIER_KEY = ["tier"] as const;
const STALE_MS = 5 * 60 * 1000;

async function fetchTier(): Promise<TierState> {
  const res = await fetch("/api/tier", { credentials: "include" });
  if (!res.ok) throw new Error(`tier ${res.status}`);
  const j = await res.json();
  return {
    authenticated: Boolean(j.authenticated),
    address: j.address ?? null,
    chain: j.chain ?? null,
    tier: (j.tier ?? "free") as Tier,
    source: (j.source ?? "default") as TierSource | "default",
    gatesEnabled: Boolean(j.gatesEnabled),
  };
}

export function useTier() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: TIER_KEY,
    queryFn: fetchTier,
    staleTime: STALE_MS,
    gcTime: STALE_MS,
    retry: 1,
  });

  const data = query.data;
  return {
    ...query,
    authenticated: data?.authenticated ?? false,
    tier: data?.tier ?? "free",
    source: data?.source ?? "default",
    gatesEnabled: data?.gatesEnabled ?? false,
    address: data?.address ?? null,
    /** Does the current wallet meet `required`? Open when gates are dormant. */
    satisfies: (required: Tier) =>
      !(data?.gatesEnabled ?? false) || tierSatisfies(data?.tier ?? "free", required),
    /** Force a re-fetch (call after sign-in / sign-out). */
    refresh: () => qc.invalidateQueries({ queryKey: TIER_KEY }),
  };
}

/** Imperatively drop the cached tier — used right after logout. */
export function useTierReset() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: TIER_KEY });
}
