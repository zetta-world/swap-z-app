"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Fires a silent page-view beacon to /api/beacon on each route change.
 * Uses keepalive so the request survives route transitions.
 * No PII is sent from the client — the server reads the session cookie itself.
 */
export default function Beacon() {
  const pathname  = usePathname();
  const lastSent  = useRef<string | null>(null);

  useEffect(() => {
    if (pathname === lastSent.current) return;
    // document.referrer only carries the EXTERNAL origin on the first view of
    // the session — later SPA navigations are internal noise, so send it once.
    const isFirstView = lastSent.current === null;
    lastSent.current = pathname;

    try {
      fetch("/api/beacon", {
        method:    "POST",
        headers:   { "content-type": "application/json" },
        body:      JSON.stringify({ path: pathname, ref: isFirstView && document.referrer ? document.referrer : undefined }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // never throw
    }
  }, [pathname]);

  return null;
}
