/**
 * Premium-quality number formatting for crypto UIs.
 * Smart decimal precision based on magnitude — never lies, never spams zeros.
 */

export function formatUsd(n: number | undefined | null, opts: { compact?: boolean } = {}) {
  if (n === undefined || n === null || !Number.isFinite(n)) return "$0.00";
  const abs = Math.abs(n);
  if (opts.compact && abs >= 1000) {
    return "$" + compactNumber(n);
  }
  if (abs >= 1) {
    return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  }
  if (abs >= 0.01) {
    return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  }
  // sub-cent: use 6 sig figs, no commas
  return "$" + n.toPrecision(4);
}

export function formatAmount(n: number | undefined | null, decimals = 4) {
  if (n === undefined || n === null || !Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return compactNumber(n);
  if (abs >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
  if (abs >= 0.0001) return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  if (abs === 0) return "0";
  return n.toExponential(2);
}

export function compactNumber(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9)  return (n / 1e9 ).toFixed(2) + "B";
  if (abs >= 1e6)  return (n / 1e6 ).toFixed(2) + "M";
  if (abs >= 1e3)  return (n / 1e3 ).toFixed(2) + "K";
  return n.toFixed(2);
}

export function formatPct(n: number | undefined | null, signed = true) {
  if (n === undefined || n === null || !Number.isFinite(n)) return "0%";
  const sign = signed && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function shortenAddress(addr: string, head = 6, tail = 4) {
  if (!addr) return "";
  if (addr.length <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Convert "12.34" string input into a safe number, returns null if invalid */
export function parseDecimalInput(s: string): number | null {
  if (!s || s.trim() === "") return null;
  const cleaned = s.replace(/,/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
