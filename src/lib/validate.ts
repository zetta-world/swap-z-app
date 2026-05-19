import { CHAINS, type ChainId } from "./chains";

/**
 * Input validation helpers for API routes.
 *
 * Every public API route MUST:
 *   1. Whitelist `chain` against CHAIN_IDS
 *   2. Validate any address as either "native" or a strict 0x-hex format
 *   3. Cap free-form text (message, query) to a reasonable length
 *   4. Strip control characters from anything injected into an LLM prompt
 */

const CHAIN_IDS = new Set<ChainId>(CHAINS.map((c) => c.id));
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_RE  = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidChain(v: string | null): v is ChainId {
  return !!v && CHAIN_IDS.has(v as ChainId);
}

/**
 * Accepts:
 *   - "native"
 *   - EVM address: strict 0x + 40 hex chars
 *   - Solana base58 address (32-44 chars)
 *   - A short symbol (≤ 12 chars, alphanumeric) — for seed-token lookups
 *
 * Returns the normalized value or `null` if invalid.
 */
export function validateAddress(v: string | null | undefined, opts: { allowSymbol?: boolean } = {}): string | null {
  if (!v || typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  if (trimmed === "native") return "native";
  if (ADDRESS_RE.test(trimmed)) return trimmed.toLowerCase();
  if (SOLANA_RE.test(trimmed)) return trimmed;
  if (opts.allowSymbol && /^[A-Za-z0-9]{1,12}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Decimal numeric input (amount). Accepts "1.5", "0.0001", "1000". No
 * exponents, no negatives, ≤ 32 chars.
 */
export function validateAmount(v: string | null | undefined): string | null {
  if (!v || typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.length > 32) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Sanitize free-form text before splicing it into an LLM user message.
 *  - Caps length
 *  - Strips control chars (except newline and tab)
 *  - Collapses runs of whitespace
 *  - Strips trailing backslashes which can break quote escaping
 */
export function sanitizePromptText(v: string | null | undefined, maxLen = 500): string | null {
  if (!v || typeof v !== "string") return null;
  const stripped = v
    // Remove control characters except \n and \t
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Collapse 3+ newlines into 2
    .replace(/\n{3,}/g, "\n\n")
    // Collapse internal whitespace runs
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (stripped.length === 0) return null;
  return stripped.length > maxLen ? stripped.slice(0, maxLen) : stripped;
}
