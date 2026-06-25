"use client";

import { useEffect, useState } from "react";

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
  | { status: "ok"; data: StatsData }
  | { status: "error"; message: string };

export function useAdminStats(refreshMs = 60_000): State {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await fetch("/admin/api/stats");
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        if (mounted) setState({ status: "ok", data });
      } catch (e) {
        if (mounted) setState({ status: "error", message: String(e) });
      }
    }

    load();
    const timer = setInterval(load, refreshMs);
    return () => { mounted = false; clearInterval(timer); };
  }, [refreshMs]);

  return state;
}
