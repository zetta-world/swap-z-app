/**
 * Smart-money flow (E4) — server-side equivalent of the ProSmartMoney panel,
 * so ZION's analysis isn't blind to what whales are doing on-chain. Reads
 * recent pool trades and reports whether large players are ACCUMULATING or
 * DISTRIBUTING. Pure: takes trades, returns a prompt line (or null).
 */

import type { Trade } from "@/lib/api/geckoterminal";

/**
 * Verdict thresholds mirror ProSmartMoney (>62% buy = ACCUMULATING, <38% =
 * DISTRIBUTING) so the on-chain read is consistent across the app.
 */
export function analyzeSmartMoney(trades: Trade[], whaleAt = 10_000): string | null {
  const withSize = (trades ?? []).filter((t) => t.sizeUsd > 0);
  if (withSize.length < 8) return null;

  // Whales = trades ≥ $whaleAt. On thinner tokens that catches nothing, so
  // fall back to the largest quartile and label it "large-trade" flow.
  let large = withSize.filter((t) => t.sizeUsd >= whaleAt);
  let label = "whale";
  if (large.length < 3) {
    const sorted = [...withSize].sort((a, b) => b.sizeUsd - a.sizeUsd);
    large = sorted.slice(0, Math.max(3, Math.ceil(sorted.length * 0.25)));
    label = "large-trade";
  }

  const buyVol  = large.filter((t) => t.kind === "buy").reduce((s, t) => s + t.sizeUsd, 0);
  const sellVol = large.filter((t) => t.kind === "sell").reduce((s, t) => s + t.sizeUsd, 0);
  const total = buyVol + sellVol;
  if (total <= 0) return null;

  const bias = buyVol / total;
  const verdict = bias > 0.62 ? "ACCUMULATING" : bias < 0.38 ? "DISTRIBUTING" : "NEUTRAL";
  const wallets = new Set(large.map((t) => t.trader).filter(Boolean)).size;
  const largest = large.reduce<Trade | null>((m, t) => (t.sizeUsd > (m?.sizeUsd ?? 0) ? t : m), null);

  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  return `SMART MONEY (${label} flow, last ${withSize.length} trades): ${verdict}`
    + ` — buy ${usd(buyVol)} vs sell ${usd(sellVol)} (${(bias * 100).toFixed(0)}% buy)`
    + ` | ${wallets} wallet${wallets === 1 ? "" : "s"}`
    + (largest ? ` | largest: ${largest.kind} ${usd(largest.sizeUsd)}` : "");
}
