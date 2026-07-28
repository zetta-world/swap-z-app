import { describe, it, expect } from "vitest";
import { safeExternalUrl } from "@/lib/safe-url";

describe("safeExternalUrl — the token-metadata href XSS guard (pentest 28/07)", () => {
  // ── attack side: dangerous schemes become undefined (inert anchor) ──
  it("drops javascript: (the confirmed wallet-drain vector)", () => {
    expect(safeExternalUrl("javascript:window.top.__x=1")).toBeUndefined();
    expect(safeExternalUrl("JavaScript:alert(1)")).toBeUndefined();      // case
    expect(safeExternalUrl("  javascript:alert(1)")).toBeUndefined();    // leading space
    expect(safeExternalUrl("java\tscript:alert(1)")).toBeUndefined();    // tab-smuggled
    expect(safeExternalUrl("java\nscript:alert(1)")).toBeUndefined();    // newline-smuggled
  });
  it("drops data:, vbscript:, blob:, file:", () => {
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeExternalUrl("vbscript:msgbox(1)")).toBeUndefined();
    expect(safeExternalUrl("blob:https://x/y")).toBeUndefined();
    expect(safeExternalUrl("file:///etc/passwd")).toBeUndefined();
  });
  it("drops junk / relative / empty", () => {
    for (const v of ["", "  ", "/relative", "not a url", null, undefined]) {
      expect(safeExternalUrl(v as string)).toBeUndefined();
    }
  });

  // ── legit side: real token links still work ──
  it("passes http/https/mailto through unchanged", () => {
    expect(safeExternalUrl("https://uniswap.org")).toBe("https://uniswap.org/");
    expect(safeExternalUrl("http://token.xyz/path?q=1")).toBe("http://token.xyz/path?q=1");
    expect(safeExternalUrl("https://t.me/tokenchat")).toBe("https://t.me/tokenchat");
    expect(safeExternalUrl("mailto:team@token.xyz")).toBe("mailto:team@token.xyz");
  });
});
