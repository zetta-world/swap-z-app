"use client";

import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type RealtimeStatus = "connecting" | "live" | "off";
export type RefreshScope = "stats" | "tier" | "killswitch" | "events" | "audit";

type PingHandler = (scope: RefreshScope) => void;

type RealtimeContextValue = {
  status: RealtimeStatus;
  /** Register a handler called on each realtime refresh ping. Returns an unsubscribe fn. */
  subscribe: (handler: PingHandler) => () => void;
};

const Ctx = createContext<RealtimeContextValue | null>(null);

export type AdminRealtimeConfig = {
  url:     string | null;
  anonKey: string | null;
};

const TOPIC = "admin:refresh";

export function AdminRealtimeProvider({
  config,
  children,
}: {
  config:   AdminRealtimeConfig;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<RealtimeStatus>(
    config.url && config.anonKey ? "connecting" : "off",
  );
  const handlersRef = useRef<Set<PingHandler>>(new Set());

  // Stable subscribe API — panels register/unregister their refetch callbacks.
  const subscribe = useMemo(() => {
    return (handler: PingHandler) => {
      handlersRef.current.add(handler);
      return () => { handlersRef.current.delete(handler); };
    };
  }, []);

  useEffect(() => {
    if (!config.url || !config.anonKey) {
      setStatus("off");
      return;
    }

    let client: SupabaseClient | null = null;
    try {
      client = createClient(config.url, config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 5 } },
      });
    } catch {
      setStatus("off");
      return;
    }

    const channel = client
      .channel(TOPIC)
      .on("broadcast", { event: "refresh" }, (msg) => {
        const scope = (msg?.payload?.scope ?? "stats") as RefreshScope;
        handlersRef.current.forEach((h) => {
          try { h(scope); } catch { /* swallow */ }
        });
      })
      .subscribe((s) => {
        if (s === "SUBSCRIBED")        setStatus("live");
        else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") setStatus("off");
      });

    return () => {
      try { client?.removeChannel(channel); } catch { /* ignore */ }
    };
  }, [config.url, config.anonKey]);

  const value = useMemo<RealtimeContextValue>(() => ({ status, subscribe }), [status, subscribe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Returns the realtime context, or null if used outside the provider. */
export function useAdminRealtime(): RealtimeContextValue | null {
  return useContext(Ctx);
}
