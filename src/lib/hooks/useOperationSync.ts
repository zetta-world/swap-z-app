"use client";

import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useTxHistory } from "@/lib/store/txHistory";
import { useRealizedPnl, effectiveRealizedUsd } from "@/lib/store/costBasis";

/**
 * Operation sync — mirrors every CONFIRMED tx-history entry to the server
 * `operations` ledger (idempotent on the entry id). One place that captures
 * all client actions — swaps, CEX trades, autopilot fills — with the wallet,
 * pair, volume and realized P&L (from the cost-basis engine). This is the
 * dataset that feeds ZION learning + the admin operations view.
 *
 * Pure capture: it never places or moves anything. Best-effort; an entry that
 * fails to post is simply retried on the next change.
 */

const STABLES = new Set(["USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USDP", "USD", "USDE", "PYUSD"]);
// v2 → forces a one-time re-sync of the backlog now that we send the REAL
// trade timestamp (entry.ts) as created_at. Without the bump, already-synced
// rows would keep their wrong insert-time created_at and 24h volume stays off.
const KEY = "zswap_ops_synced_v2";

function loadSynced(): Set<string> {
  try { const r = localStorage.getItem(KEY); return new Set(r ? JSON.parse(r) as string[] : []); }
  catch { return new Set(); }
}
function saveSynced(s: Set<string>): void {
  try { localStorage.setItem(KEY, JSON.stringify([...s].slice(-3000))); } catch { /* quota */ }
}
function sideOf(from: string, to: string): string | undefined {
  if (STABLES.has(from.toUpperCase())) return "buy";
  if (STABLES.has(to.toUpperCase()))   return "sell";
  return undefined;
}

export function useOperationSync(): void {
  const entries  = useTxHistory((s) => s.entries);
  const realized = useRealizedPnl();
  const { address: evm } = useAccount();
  const sol = useWallet();
  const wallet = sol.publicKey?.toBase58() ?? evm ?? null;

  const syncedRef = useRef<Set<string> | null>(null);
  const busyRef   = useRef(false);

  useEffect(() => {
    if (!wallet || busyRef.current) return;
    if (!syncedRef.current) syncedRef.current = loadSynced();
    const synced = syncedRef.current;

    const pending = entries.filter((e) => e.status === "confirmed" && e.id && !synced.has(e.id));
    if (pending.length === 0) return;

    busyRef.current = true;
    (async () => {
      for (const e of pending) {
        const ok = await post({
          ref:       e.id,
          wallet,
          kind:      e.type,
          status:    e.status,
          chain:     e.exchange ?? e.toChain ?? e.fromChain ?? undefined,
          pair:      `${e.fromSymbol}/${e.toSymbol}`,
          side:      sideOf(e.fromSymbol, e.toSymbol),
          volumeUsd: e.valueUsd,
          pnlUsd:    effectiveRealizedUsd(e, realized),
          route:     e.route,
          ts:        e.ts,
        });
        if (ok) synced.add(e.id);
      }
      saveSynced(synced);
      busyRef.current = false;
    })();
  }, [entries, realized, wallet]);
}

async function post(body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch("/api/operations/record", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}
