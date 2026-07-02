"use client";

import { useEffect } from "react";

/**
 * Global browser-error reporter (R1.4). Hooks window.onerror and
 * unhandledrejection once and ships each crash to /api/telemetry/error, where
 * it lands in the existing platform_events → admin panel → watchdog pipeline.
 *
 * Guard rails so telemetry can never become its own incident:
 *   • at most 5 reports per page load;
 *   • the same message is never sent twice per page load;
 *   • sendBeacon-style fire-and-forget fetch, all failures swallowed;
 *   • renders nothing.
 */
const MAX_REPORTS = 5;

export default function ClientErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const seen = new Set<string>();

    const ship = (kind: "onerror" | "unhandledrejection", message: string, stack?: string) => {
      const msg = String(message ?? "").trim();
      if (!msg || sent >= MAX_REPORTS || seen.has(msg)) return;
      seen.add(msg);
      sent++;
      try {
        void fetch("/api/telemetry/error", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, message: msg, stack, url: window.location.pathname }),
          keepalive: true,
        }).catch(() => { /* telemetry never throws */ });
      } catch { /* ignore */ }
    };

    const onError = (e: ErrorEvent) => ship("onerror", e.message, e.error?.stack);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      ship("unhandledrejection", r?.message ?? String(r), r?.stack);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
