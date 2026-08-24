/**
 * Shared market-context inputs (positioning + sentiment), public and free.
 * Born in the Oráculo desk; promoted to a neutral module on 25/07 so the
 * relit scanners (Agent A/B + tournament) read the same context a human
 * trader keeps on the side monitor. Best-effort: "" on any failure.
 */

/** Crowded-positioning read from Bybit's public linear tickers: the funding
 *  extremes among USDT perps. Persistent positive funding = longs pay to
 *  stay = crowded long (squeeze fuel), and vice versa. */
export async function fetchFundingContext(): Promise<string> {
  try {
    const res = await fetch("https://api.bybit.com/v5/market/tickers?category=linear", { next: { revalidate: 300 } });
    if (!res.ok) return "";
    const body = await res.json() as { result?: { list?: Array<{ symbol?: string; fundingRate?: string }> } };
    const rows = (body.result?.list ?? [])
      .filter((r) => (r.symbol ?? "").endsWith("USDT"))
      .map((r) => ({ sym: (r.symbol ?? "").replace(/USDT$/, ""), f: parseFloat(r.fundingRate ?? "") }))
      .filter((r) => Number.isFinite(r.f) && r.sym.length <= 6)
      .sort((a, b) => Math.abs(b.f) - Math.abs(a.f))
      .slice(0, 8);
    if (rows.length === 0) return "";
    const fmt = rows.map((r) => `${r.sym} ${(r.f * 100).toFixed(3)}%`).join(" · ");
    return `Funding extremes (8h, Bybit linear — positive = crowded longs): ${fmt}`;
  } catch { return ""; }
}

/** Crypto Fear & Greed index (alternative.me, free). */
export async function fetchFearGreed(): Promise<string> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=7", { next: { revalidate: 3600 } });
    if (!res.ok) return "";
    const body = await res.json() as { data?: Array<{ value?: string; value_classification?: string }> };
    const d = body.data ?? [];
    if (d.length === 0) return "";
    const today = d[0], weekAgo = d[d.length - 1];
    return `Fear & Greed: ${today.value} (${today.value_classification}) — 7d ago: ${weekAgo?.value} (${weekAgo?.value_classification})`;
  } catch { return ""; }
}
