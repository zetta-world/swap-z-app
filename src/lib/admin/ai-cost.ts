/**
 * Model-aware Anthropic cost estimation — the single source of truth for
 * "how much did this AI usage cost". Replaces the old flat `{input:3,
 * output:15, cacheRead:0.30}` table that (a) priced every model as Sonnet and
 * (b) ignored cache-WRITE entirely, which on a cache-heavy workload is the
 * single largest input line item (~24% of the bill went uncounted).
 *
 * Prices are USD per 1M tokens. Cache write 5m = 1.25× base input; cache write
 * 1h = 2× base input; cache read = 0.1× base input (Anthropic's standard
 * prompt-cache multipliers).
 */

interface ModelPrice {
  input: number;       // per 1M, uncached input
  output: number;      // per 1M, output
  cacheWrite5m: number;// per 1M, 5-minute cache write (1.25× input)
  cacheWrite1h: number;// per 1M, 1-hour cache write (2× input)
  cacheRead: number;   // per 1M, cache read (0.1× input)
}

function tier(input: number, output: number): ModelPrice {
  return { input, output, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2, cacheRead: input * 0.1 };
}

// Keyed by a substring of the model id so version suffixes still match.
const PRICES: Array<[RegExp, ModelPrice]> = [
  // Opus 4.5+ is $5/$25 per MTok (official API pricing). The old tier(15, 75)
  // was Opus 4.1-era pricing and inflated the FINANCE estimate 3x.
  [/opus/i,            tier(5, 25)],
  [/sonnet/i,          tier(3, 15)],
  [/haiku/i,           tier(1, 5)],
  // Open/hosted models in the A/B (approximate public rates — the authoritative
  // cost is each provider's own console balance).
  [/kimi|moonshot/i,   tier(0.6, 2.5)],
  [/deepseek/i,        tier(0.27, 1.1)],
  [/mistral/i,         tier(2, 6)],
  [/grok|xai/i,        tier(1.25, 2.5)],
  [/llama/i,           tier(0.2, 0.6)],
];
// Default to Sonnet pricing when the model is unknown/absent (old events).
const DEFAULT_PRICE = tier(3, 15);

export function priceForModel(model?: string | null): ModelPrice {
  if (model) for (const [re, p] of PRICES) if (re.test(model)) return p;
  return DEFAULT_PRICE;
}

export interface UsageTokens {
  model?:            string | null;
  inTokens?:         number;  // uncached input
  outTokens?:        number;
  cachedTokens?:     number;  // cache read
  cacheWriteTokens?: number;  // cache creation (5m); 1h tracked separately if ever used
}

/** USD cost for one usage record, priced by its own model. */
export function estimateCost(u: UsageTokens): number {
  const p = priceForModel(u.model);
  return (
    (u.inTokens ?? 0)         * p.input        +
    (u.outTokens ?? 0)        * p.output       +
    (u.cachedTokens ?? 0)     * p.cacheRead    +
    (u.cacheWriteTokens ?? 0) * p.cacheWrite5m
  ) / 1_000_000;
}
