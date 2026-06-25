"use client";

import { useCallback, useState } from "react";
import { useAutoRefresh } from "./useAutoRefresh";

type StatsData = {
  wallets: {
    total:    number;
    active7d: number;
    active30d: number;
    chainSplit: Record<string, number>;
  };
  tiers: { distribution: Record<string, number> };
  autopilot: {
    sessions:       number;
    sessionsActive: number;
    totalRuns:      number;
    pnlToday:       number;
    volumeTotal:    number;
  };
  cex: { byExchange: Record<string, { total: number; active: number }> };
  fetchedAt: string;
};

type State =
  | { status: "loading" }
  | { status: "ok"; data: StatsData; secondsAgo: number; refreshing: boolean; refresh: () => void }
  | { status: "error"; message: string; refresh: () => void };

export function useAdminStats(): State {
  const [data,  setData]  = useState<StatsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/stats");
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const { secondsAgo, refreshing, forceRefresh } = useAutoRefresh({
    intervalMs: 60_000,
    onRefresh: load,
  });

  if (!data && !error) return { status: "loading" };
  if (error)           return { status: "error", message: error, refresh: forceRefresh };
  return { status: "ok", data: data!, secondsAgo, refreshing, refresh: forceRefresh };
}
