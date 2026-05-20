/**
 * Z-SWAP Conviction Score — 0-100 composite signal per trading pair.
 *
 * Designed to answer one question at a glance: "should I touch this?"
 *
 * Inputs are derived from /api/pair (DexScreener + GoPlus + Honeypot):
 *   - audit summary       → risk inversion
 *   - pressure ratios     → net buy/sell lean
 *   - liquidity (USD)     → depth
 *   - volume, txns        → activity vs depth
 *   - pair age (seconds)  → maturity
 *
 * The function is pure and deterministic — same inputs always produce the
 * same score. The factor breakdown is a list of human-readable signals
 * (positive, neutral, negative) the UI can render alongside the number.
 *
 * Bands:
 *   85-100   STRONG   clean audit · buyers leading · deep liquidity
 *   65-84    SOLID    decent profile · some thinness or minor flags
 *   45-64    NEUTRAL  mixed signals · proceed with care
 *   25-44    WEAK     significant risks present
 *    0-24    AVOID    honeypot / no liquidity / extreme tax
 */

export type ConvictionBand = "strong" | "solid" | "neutral" | "weak" | "avoid";

export interface ConvictionFactor {
  /** Short label rendered in the UI breakdown. */
  label:  string;
  /** Direction this factor pushed the score. */
  kind:   "positive" | "neutral" | "negative" | "critical";
  /** Contribution to the final score (signed, scaled). */
  delta:  number;
}

export interface ConvictionResult {
  score:        number;        // 0-100
  band:         ConvictionBand;
  bandLabel:    string;        // "Solid", "Avoid", etc.
  color:        string;        // hex used by the UI
  /** One-line explanation suitable as a tagline under the score. */
  summary:      string;
  factors:      ConvictionFactor[];
}

// ─── Inputs ─────────────────────────────────────────────────────────

export interface ConvictionAudit {
  isHoneypot:   boolean;
  buyTax:       number | null;   // 0.05 = 5%
  sellTax:      number | null;
  openSource:   boolean | null;
  proxy:        boolean | null;
  mintable:     boolean | null;
  topHolderPct: number | null;
  lpLockedPct:  number | null;
  honeypotRisk: "low" | "medium" | "high" | null;
}

export interface ConvictionPressure {
  buy:  number;   // 0-1
  sell: number;   // 0-1
}

export interface ConvictionInput {
  audit:        ConvictionAudit | null;
  /** Volume- and txn-pressure ratios from DexScreener. */
  pressureTxns:    ConvictionPressure;
  pressureVolume:  ConvictionPressure;
  /** Liquidity in USD. */
  liquidityUsd:    number;
  /** 24h volume in USD. */
  volume24hUsd:    number;
  /** Pair age in seconds (null = unknown). */
  ageSec:          number | null;
  /** 24h change percent (DexScreener already returns a percentage). */
  change24hPct:    number;
}

/**
 * Compute the Conviction Score from /api/pair data.
 */
export function computeConviction(input: ConvictionInput): ConvictionResult {
  const factors: ConvictionFactor[] = [];

  // ─── Hard kill switches ────────────────────────────────────────
  if (input.audit?.isHoneypot) {
    return finalize(0, [
      { label: "Honeypot flag", kind: "critical", delta: -100 },
    ]);
  }
  if (input.audit?.honeypotRisk === "high") {
    return finalize(8, [
      { label: "Honeypot.is: HIGH risk", kind: "critical", delta: -80 },
    ]);
  }
  if (input.liquidityUsd <= 1_000) {
    return finalize(10, [
      { label: `Liquidity dust ($${Math.round(input.liquidityUsd)})`, kind: "critical", delta: -70 },
    ]);
  }

  // ─── Soft factors ──────────────────────────────────────────────
  let score = 50;   // start at NEUTRAL

  // 1. Audit (weight ~30)
  if (input.audit) {
    const a = input.audit;
    const sellTaxPct = a.sellTax !== null ? a.sellTax * 100 : 0;
    const buyTaxPct  = a.buyTax  !== null ? a.buyTax  * 100 : 0;

    if (a.sellTax === null && a.buyTax === null && a.openSource === null) {
      // No GoPlus/Honeypot coverage on this chain — neutral
      factors.push({ label: "Audit coverage absent", kind: "neutral", delta: 0 });
    } else {
      if (sellTaxPct === 0 && buyTaxPct === 0) {
        push(factors, { label: "Zero buy/sell tax", kind: "positive", delta: +6 });
        score += 6;
      } else if (sellTaxPct > 10) {
        push(factors, { label: `Sell tax ${sellTaxPct.toFixed(1)}%`, kind: "critical", delta: -20 });
        score -= 20;
      } else if (sellTaxPct > 5) {
        push(factors, { label: `Sell tax ${sellTaxPct.toFixed(1)}%`, kind: "negative", delta: -8 });
        score -= 8;
      } else if (sellTaxPct > 3) {
        push(factors, { label: `Sell tax ${sellTaxPct.toFixed(1)}%`, kind: "neutral", delta: -3 });
        score -= 3;
      }
      if (buyTaxPct > 10) {
        push(factors, { label: `Buy tax ${buyTaxPct.toFixed(1)}%`, kind: "critical", delta: -15 });
        score -= 15;
      } else if (buyTaxPct > 5) {
        push(factors, { label: `Buy tax ${buyTaxPct.toFixed(1)}%`, kind: "negative", delta: -5 });
        score -= 5;
      }
      if (a.openSource === false) {
        push(factors, { label: "Contract not open source", kind: "negative", delta: -8 });
        score -= 8;
      } else if (a.openSource === true) {
        push(factors, { label: "Open source", kind: "positive", delta: +3 });
        score += 3;
      }
      if (a.proxy === true) {
        push(factors, { label: "Proxy contract", kind: "negative", delta: -4 });
        score -= 4;
      }
      if (a.mintable === true) {
        push(factors, { label: "Mintable", kind: "negative", delta: -5 });
        score -= 5;
      }
      if (a.topHolderPct !== null) {
        if (a.topHolderPct > 70) {
          push(factors, { label: `Top-10 holders ${a.topHolderPct.toFixed(0)}%`, kind: "critical", delta: -15 });
          score -= 15;
        } else if (a.topHolderPct > 50) {
          push(factors, { label: `Top-10 holders ${a.topHolderPct.toFixed(0)}%`, kind: "negative", delta: -7 });
          score -= 7;
        } else if (a.topHolderPct < 25) {
          push(factors, { label: `Holders well dispersed (${a.topHolderPct.toFixed(0)}%)`, kind: "positive", delta: +3 });
          score += 3;
        }
      }
      if (a.lpLockedPct !== null) {
        if (a.lpLockedPct >= 80) {
          push(factors, { label: `LP locked ${a.lpLockedPct.toFixed(0)}%`, kind: "positive", delta: +4 });
          score += 4;
        } else if (a.lpLockedPct < 30) {
          push(factors, { label: `LP locked only ${a.lpLockedPct.toFixed(0)}%`, kind: "negative", delta: -6 });
          score -= 6;
        }
      }
    }
  }

  // 2. Buy/sell pressure (weight ~25)
  const buyLean = input.pressureTxns.buy - input.pressureTxns.sell;
  if (buyLean > 0.20) {
    push(factors, { label: `Buyers leading txns (${pct(input.pressureTxns.buy)} buy)`, kind: "positive", delta: +10 });
    score += 10;
  } else if (buyLean > 0.05) {
    push(factors, { label: `Slight buyer lean (${pct(input.pressureTxns.buy)} buy)`, kind: "positive", delta: +4 });
    score += 4;
  } else if (buyLean < -0.20) {
    push(factors, { label: `Sellers dominating (${pct(input.pressureTxns.sell)} sell)`, kind: "negative", delta: -10 });
    score -= 10;
  } else if (buyLean < -0.05) {
    push(factors, { label: `Slight seller lean (${pct(input.pressureTxns.sell)} sell)`, kind: "negative", delta: -3 });
    score -= 3;
  } else {
    push(factors, { label: "Balanced flow", kind: "neutral", delta: 0 });
  }

  // 3. Liquidity depth (weight ~20)
  if (input.liquidityUsd >= 5_000_000) {
    push(factors, { label: `Deep liquidity ($${compact(input.liquidityUsd)})`, kind: "positive", delta: +10 });
    score += 10;
  } else if (input.liquidityUsd >= 500_000) {
    push(factors, { label: `Good liquidity ($${compact(input.liquidityUsd)})`, kind: "positive", delta: +5 });
    score += 5;
  } else if (input.liquidityUsd >= 100_000) {
    push(factors, { label: `Adequate liquidity ($${compact(input.liquidityUsd)})`, kind: "neutral", delta: 0 });
  } else if (input.liquidityUsd >= 25_000) {
    push(factors, { label: `Thin liquidity ($${compact(input.liquidityUsd)})`, kind: "negative", delta: -5 });
    score -= 5;
  } else {
    push(factors, { label: `Very thin liquidity ($${compact(input.liquidityUsd)})`, kind: "negative", delta: -12 });
    score -= 12;
  }

  // 4. Activity ratio (volume / liquidity) (weight ~15)
  if (input.liquidityUsd > 0) {
    const turnover = input.volume24hUsd / input.liquidityUsd;
    if (turnover > 5) {
      push(factors, { label: `Hot turnover ${turnover.toFixed(1)}x`, kind: "positive", delta: +6 });
      score += 6;
    } else if (turnover > 1) {
      push(factors, { label: `Active turnover ${turnover.toFixed(1)}x`, kind: "positive", delta: +3 });
      score += 3;
    } else if (turnover < 0.05) {
      push(factors, { label: `Stagnant volume (${turnover.toFixed(2)}x)`, kind: "negative", delta: -5 });
      score -= 5;
    }
  }

  // 5. Age maturity (weight ~10)
  if (input.ageSec !== null) {
    const days = input.ageSec / 86_400;
    if (days < 1) {
      push(factors, { label: `Fresh pair (${humanAge(input.ageSec)})`, kind: "negative", delta: -8 });
      score -= 8;
    } else if (days < 7) {
      push(factors, { label: `Young pair (${humanAge(input.ageSec)})`, kind: "neutral", delta: -3 });
      score -= 3;
    } else if (days > 180) {
      push(factors, { label: `Mature pair (${humanAge(input.ageSec)})`, kind: "positive", delta: +4 });
      score += 4;
    }
  }

  // 6. Extreme volatility — flag both directions
  if (Math.abs(input.change24hPct) > 100) {
    push(factors, { label: `Extreme 24h move (${input.change24hPct.toFixed(0)}%)`, kind: "negative", delta: -6 });
    score -= 6;
  } else if (input.change24hPct > 20 && buyLean > 0) {
    push(factors, { label: `Momentum +${input.change24hPct.toFixed(0)}% with buy lean`, kind: "positive", delta: +3 });
    score += 3;
  }

  return finalize(score, factors);
}

// ─── Quick score for the Radar (no audit, no pressure data) ────────

export interface QuickScoreInput {
  liquidityUsd: number;
  volume24hUsd: number;
  change24hPct: number;
}

/**
 * Lightweight conviction proxy when only volume/liquidity/change is
 * available — Nexus Radar uses this per-member before drilling into
 * /api/pair for the full score.
 */
export function computeQuickScore(input: QuickScoreInput): number {
  let s = 50;
  if (input.liquidityUsd >= 1_000_000)      s += 12;
  else if (input.liquidityUsd >= 100_000)   s += 6;
  else if (input.liquidityUsd <= 10_000)    s -= 18;

  if (input.liquidityUsd > 0) {
    const turn = input.volume24hUsd / input.liquidityUsd;
    if (turn > 5) s += 8;
    else if (turn > 1) s += 4;
    else if (turn < 0.05) s -= 6;
  }

  if (Math.abs(input.change24hPct) > 100) s -= 8;
  else if (input.change24hPct > 15)        s += 4;
  else if (input.change24hPct < -15)       s -= 4;

  return Math.max(0, Math.min(100, Math.round(s)));
}

// ─── Helpers ───────────────────────────────────────────────────────

function finalize(rawScore: number, factors: ConvictionFactor[]): ConvictionResult {
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const band  =
    score >= 85 ? "strong"  :
    score >= 65 ? "solid"   :
    score >= 45 ? "neutral" :
    score >= 25 ? "weak"    :
                  "avoid";
  const cfg = {
    strong:  { label: "Strong",  color: "#27D49B" },
    solid:   { label: "Solid",   color: "#00E8FF" },
    neutral: { label: "Neutral", color: "#FFB820" },
    weak:    { label: "Weak",    color: "#FF8A4C" },
    avoid:   { label: "Avoid",   color: "#FF5C5C" },
  }[band];

  // Build a one-liner from the strongest signals
  const top = [...factors]
    .filter((f) => f.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 2)
    .map((f) => f.label.toLowerCase());
  const summary = top.length === 0
    ? "No standout signals — neutral profile."
    : `${cfg.label} — ${top.join(" · ")}.`;

  return {
    score,
    band,
    bandLabel: cfg.label,
    color:     cfg.color,
    summary,
    factors,
  };
}

function push(arr: ConvictionFactor[], f: ConvictionFactor) {
  arr.push(f);
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function compact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}K`;
  return Math.round(n).toString();
}

function humanAge(sec: number): string {
  if (sec < 3600)        return `${Math.round(sec / 60)}m old`;
  if (sec < 86400)       return `${Math.round(sec / 3600)}h old`;
  if (sec < 86400 * 30)  return `${Math.round(sec / 86400)}d old`;
  return `${Math.round(sec / (86400 * 30))}mo old`;
}
