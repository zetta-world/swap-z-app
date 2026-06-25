"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminRealtime, type RefreshScope } from "./AdminRealtimeProvider";

type Options = {
  intervalMs?: number;
  onRefresh:   () => Promise<void> | void;
  /** Realtime scopes that should trigger an instant refresh for this panel. */
  scopes?:     RefreshScope[];
};

type Result = {
  secondsAgo:   number;
  refreshing:   boolean;
  forceRefresh: () => void;
};

/**
 * Calls `onRefresh` on mount and every `intervalMs`, AND instantly whenever a
 * matching realtime ping arrives. Realtime is the fast path; the interval is a
 * safety net for missed pings / dropped connections. When realtime is live we
 * back the interval off to a slower heartbeat.
 */
export function useAutoRefresh({ intervalMs = 60_000, onRefresh, scopes }: Options): Result {
  const [lastAt,     setLastAt]     = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  const realtime = useAdminRealtime();
  const live = realtime?.status === "live";

  const run = useCallback(async () => {
    setRefreshing(true);
    try { await cbRef.current(); } catch { /* swallow */ }
    setRefreshing(false);
    setLastAt(Date.now());
  }, []);

  // Initial load + heartbeat interval. When realtime is live, slow the poll to
  // a 5-minute heartbeat since pings cover real changes.
  useEffect(() => {
    run();
    const beat = live ? 300_000 : intervalMs;
    const t = setInterval(run, beat);
    return () => clearInterval(t);
  }, [run, intervalMs, live]);

  // Realtime ping → instant refresh (filtered by scope when provided).
  useEffect(() => {
    if (!realtime) return;
    return realtime.subscribe((scope) => {
      if (!scopes || scopes.includes(scope)) run();
    });
  }, [realtime, run, scopes]);

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
