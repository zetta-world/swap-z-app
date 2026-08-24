/**
 * External-URL scheme guard (pentest 28/07 — CONFIRMED XSS).
 *
 * A token's `website` / `socials[].url` come straight from DexScreener token
 * metadata, which ANYONE can set when they deploy a token. Rendered as
 * `<a href={url}>` (PairView, TopMovers) with no scheme check, a value of
 * `javascript:…` executes attacker code on click — proven in real Chromium.
 * React 18 only WARNS on javascript: hrefs; it still emits them. In a DEX,
 * same-origin script execution can drive the signing UI → wallet drain.
 *
 * This returns the URL only when its scheme is http/https/mailto; anything
 * else (javascript:, data:, vbscript:, blob:, or a parse failure) becomes
 * `undefined`, so the anchor renders inert (no navigable href). Applied at BOTH
 * the data boundary (dexscreener normalizer) and the render sinks — belt and
 * braces, because a future feed could reintroduce a raw URL.
 */

const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);

// Control chars + space: a scheme like "java\tscript:" is stripped by the
// WHATWG parser back into "javascript:". Reject anything carrying them.
const CONTROL_OR_SPACE = /[\u0000-\u0020]/;

/** Returns the URL if its scheme is safe to put in an href, else undefined. */
export function safeExternalUrl(raw: string | null | undefined): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || CONTROL_OR_SPACE.test(trimmed)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined; // relative or unparseable → not a safe external link
  }
  return ALLOWED_SCHEMES.has(parsed.protocol) ? parsed.href : undefined;
}
