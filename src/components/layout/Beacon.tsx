"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Fires a silent page-view beacon to /api/beacon on each route change, and a
 * "dwell" ping (time spent) when the visitor leaves a page — so MIDGARD can
 * answer "which page holds the visitor longest". Uses keepalive so the requests
 * survive route transitions / tab close. No PII from the client — the server
 * reads the session cookie + coarse geo itself.
 */
export default function Beacon() {
  const pathname   = usePathname();
  const lastSent   = useRef<string | null>(null);
  const enteredAt  = useRef<number>(0);
  const curPath    = useRef<string | null>(null);

  // Fire the dwell ping for whatever page we were on. Best-effort.
  function flushDwell() {
    const p = curPath.current;
    if (!p || !enteredAt.current) return;
    const dwellMs = Date.now() - enteredAt.current;
    enteredAt.current = 0;
    if (dwellMs < 1000) return; // ignore instant bounces / double fires
    try {
      const payload = JSON.stringify({ path: p, dwellMs });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/beacon", new Blob([payload], { type: "application/json" }));
      else fetch("/api/beacon", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true }).catch(() => undefined);
    } catch { /* never throw */ }
  }

  useEffect(() => {
    if (pathname === lastSent.current) return;
    flushDwell();                       // close out the previous page's time
    const isFirstView = lastSent.current === null;
    lastSent.current = pathname;
    curPath.current  = pathname;
    enteredAt.current = Date.now();

    try {
      fetch("/api/beacon", {
        method:    "POST",
        headers:   { "content-type": "application/json" },
        body:      JSON.stringify({ path: pathname, ref: isFirstView && document.referrer ? document.referrer : undefined }),
        keepalive: true,
      }).catch(() => undefined);
    } catch { /* never throw */ }
  }, [pathname]);

  // Flush dwell when the tab is hidden or the page is being unloaded.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flushDwell(); };
    window.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushDwell);
    return () => {
      window.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushDwell);
    };
  }, []);

  return null;
}
