/**
 * Safe rich-text for the FOUR i18n strings that are rendered as HTML via
 * `dangerouslySetInnerHTML` (the autopilot consent copy uses <b> for emphasis).
 *
 * Security context (pentest 28/07): `format()` in i18n/index.ts interpolates
 * {vars} into a translated string WITHOUT escaping, and those four call sites
 * feed the result straight into innerHTML. Today the keys take no vars, so
 * there is no live XSS — but it is a loaded gun: the day someone passes user
 * data to one of those keys (a token symbol, a wallet label…), or a
 * translation entry is tampered with, raw markup reaches the DOM. In a DEX
 * that is a wallet-drain-grade sink.
 *
 * This function is the chamber safety: it accepts a resolved translation
 * string and returns an object for `dangerouslySetInnerHTML` in which EVERY
 * character is HTML-escaped EXCEPT the small allow-list of formatting tags the
 * copy actually uses (<b>, </b>, <i>, </i>). A <script>, an onerror=, an <img>
 * — injected via a var or a poisoned catalog — comes out as inert text.
 */

const ALLOWED = new Set(["<b>", "</b>", "<i>", "</i>"]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes everything, then re-permits ONLY the allow-listed formatting tags. */
export function sanitizeRichText(input: string): string {
  const escaped = escapeHtml(input);
  // Bring back exactly the allowed tags (their escaped forms → real tags).
  return escaped.replace(/&lt;(\/?[bi])&gt;/g, (m, tag) => {
    const real = `<${tag}>`;
    return ALLOWED.has(real) ? real : m;
  });
}

/** Drop-in for `dangerouslySetInnerHTML={richText(t("key"))}`. */
export function richText(resolved: string): { __html: string } {
  return { __html: sanitizeRichText(resolved) };
}
