/**
 * Parse ZION streamed text into terminal lines + action cards.
 *
 * Action cards are emitted by the model between [[ACTION]] and [[/ACTION]]
 * delimiters with valid JSON inside. We strip them from the visible terminal
 * stream and surface them as structured ActionCard objects the UI can render
 * as Execute buttons.
 */

export interface ActionCard {
  kind:
    | "swap" | "bridge"
    | "arbitrage" | "arbitrage_same_chain" | "arbitrage_cross_chain"
    | "sniper_watch"
    | "limit" | "buy_limit"
    | "sell_safe" | "sell_medium" | "sell_aggressive"
    | "stop_loss"
    | "approve"
    | string;
  title:      string;
  summary:    string;
  chain:      string;
  from?:      { symbol: string; address: string; amount?: string };
  to?:        { symbol: string; address: string };
  triggerPrice?: string;
  estCost?:   string;
  estReturn?: string;
  targetReturn?: string;
  confidence?: "high" | "medium" | "low" | string;
  risk?:      "safe" | "caution" | "risky" | "danger" | string;
  expiresIn?: string;
  /**
   * Top-level probability the card's primary thesis plays out (0-100 as a
   * string, e.g. "65"). For ladder cards (buy_limit / swap with exits[])
   * this represents the BALANCED-target probability — it should match
   * exits[1].probability. For single-target cards (sell_*, stop_loss,
   * arbitrage_*, sniper_*) it's the chance the trigger fires within the
   * timeframe. Free-form string so locale-formatted variants are allowed
   * (e.g. "~65", "65"), the UI strips non-digits to render.
   */
  probability?: string;

  // ─── Extended trade-thesis fields ──────────────────────────────────
  // The model fills these when the card is a tradeable proposal. Free-form
  // string values so locale-specific number formatting stays the model's
  // responsibility (e.g. "$3,420.50", "1,234,56 USDT", "+8.4%").

  /** Buy / entry price the user should pay. Quoted in the quote-asset. */
  entryPrice?:        string;
  /** Position size suggestion (e.g. "0.5 ETH" or "5% of portfolio"). */
  positionSize?:      string;
  /** Stop-loss price — protective exit on the downside. */
  stopLoss?:          string;
  /** Expected profit in % at the primary target (positive number string). */
  expectedProfitPct?: string;
  /** Risk / reward ratio at the primary target (e.g. "2.5:1"). */
  riskReward?:        string;
  /** Expected timeframe to reach the target (e.g. "24h", "2-7d", "2-4w"). */
  timeframe?:         string;
  /** Optional ladder of profit-take rungs, for trade-thesis style proposals. */
  exits?: Array<{
    /** Label (e.g. "Safe", "Balanced", "Stretch"). */
    label:        string;
    /** Target price in the quote-asset. */
    price:        string;
    /** Expected profit % from entry. */
    profitPct:    string;
    /** Approximate probability of reaching this target (0-100). */
    probability?: string;
    /** Suggested fraction of the position to exit here (e.g. "30%"). */
    sizeFraction?: string;
  }>;
}

export interface ParsedZion {
  /** Visible terminal text with action blocks stripped */
  visible: string;
  /** Successfully parsed action cards */
  cards: ActionCard[];
  /** Whether we're still inside an open [[ACTION]] block at end of buffer */
  inProgress: boolean;
}

const OPEN  = "[[ACTION]]";
const CLOSE = "[[/ACTION]]";

export function parseZionStream(buffer: string): ParsedZion {
  const visible: string[] = [];
  const cards: ActionCard[] = [];
  let i = 0;
  let inProgress = false;

  while (i < buffer.length) {
    const openIdx = buffer.indexOf(OPEN, i);
    if (openIdx === -1) {
      visible.push(buffer.slice(i));
      break;
    }
    // Emit text before the action block
    visible.push(buffer.slice(i, openIdx));

    const closeIdx = buffer.indexOf(CLOSE, openIdx + OPEN.length);
    if (closeIdx === -1) {
      // Open block not yet closed — buffer up, treat as in-progress
      inProgress = true;
      break;
    }

    const json = buffer.slice(openIdx + OPEN.length, closeIdx).trim();
    try {
      const parsed = JSON.parse(json) as ActionCard;
      if (parsed && typeof parsed.kind === "string" && parsed.title) {
        cards.push(parsed);
      }
    } catch (err) {
      // Malformed JSON from the model — skip the card so the rest of the
      // stream still renders, but log in dev so we can spot recurring issues.
      if (process.env.NODE_ENV !== "production") {
        console.warn("[zion/parse] malformed ACTION JSON, skipped:", err instanceof Error ? err.message : err, "\nraw:", json.slice(0, 200));
      }
    }
    i = closeIdx + CLOSE.length;
    // Drop any leading newline immediately after the close tag
    if (buffer[i] === "\n") i++;
  }

  return {
    visible: visible.join("").replace(/\n{3,}/g, "\n\n").trimEnd(),
    cards,
    inProgress,
  };
}
