"use client";

import dynamic from "next/dynamic";
import { useSwap } from "@/lib/store/swap";

// Heavy chunk — the entire ExecuteSwap modal + useQuotes + Jupiter / LiFi /
// 0x deserializers. Only fetched the first time the user actually tries
// to execute. After that the chunk stays cached for the session.
const ExecuteSwapPortal = dynamic(() => import("./ExecuteSwapPortal"), {
  ssr:     false,
  loading: () => null,
});

/**
 * Mounts <ExecuteSwapPortal /> only after `executeOpen` flips to true the
 * first time. Keeps the swap stack out of the initial page bundle for
 * /portfolio, /pools, /governance, /settings, etc. where the user never
 * touches the swap.
 */
export default function ExecuteSwapGuard() {
  const executeOpen = useSwap((s) => s.executeOpen);
  if (!executeOpen) return null;
  return <ExecuteSwapPortal />;
}
