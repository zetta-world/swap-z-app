"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Options = {
  intervalMs?: number;
  onRefresh:   () => Promise<void> | void;
};

type Result = {
  secondsAgo:   number;
  refreshing:   boolean;
  forceRefresh: () => void;
};

/**
 * Calls `onRefresh` on mount and every `intervalMs`. Returns time elapsed
 * since the last successful refresh (for the "last updated Xs ago" label)
 * and a `forceRefresh()` function for manual triggers.
 */
export function useAutoRefresh({ intervalMs = 60_000, onRefresh }: Options): Result {
  const [lastAt,     setLastAt]     = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  const run = useCallback(async () => {
    setRefreshing(true);
    try { await cbRef.current(); } catch { /* swallow */ }
    setRefreshing(false);
    setLastAt(Date.now());
  }, []);

  // Initial load + interval
  useEffect(() => {
    run();
    const t = setInterval(run, intervalMs);
    return () => clearInterval(t);
  }, [run, intervalMs]);

  // Live "seconds ago" ticker
  useEffect(() => {
    if (!lastAt) return;
    const tick = () => setSecondsAgo(Math.round((Date.now() - lastAt) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [lastAt]);

  return { secondsAgo, refreshing, forceRefresh: run };
}
