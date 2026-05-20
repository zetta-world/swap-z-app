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
    | "yield" | "approve"
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
    } catch {
      // Malformed JSON — quietly skip; the user still sees the terminal text
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
