import { describe, it, expect } from "vitest";
import { pairToDetail } from "@/lib/api/dexscreener";

/**
 * Boundary test (pentest 28/07): DexScreener token metadata is
 * attacker-controlled. pairToDetail is where it enters our system, so a
 * javascript:/data: URL in websites/socials must be stripped HERE — before it
 * can reach any <a href> render sink (the confirmed XSS in PairView/TopMovers).
 * Closes the "PairView end-to-end" gap at the data layer.
 */
describe("pairToDetail — sanitizes attacker-controlled token URLs at the boundary", () => {
  const malicious = {
    chainId: "ethereum", dexId: "uniswap", pairAddress: "0xEVIL",
    baseToken: { address: "0xEVIL", name: "Evil", symbol: "EVIL" },
    quoteToken: { address: "0xUSDC", name: "USD Coin", symbol: "USDC" },
    priceUsd: "1", info: {
      websites: [
        { url: "javascript:window.__x=document.cookie" },   // XSS
        { url: "data:text/html,<script>alert(1)</script>" },// XSS
        { url: "https://real-token.xyz" },                  // legit
      ],
      socials: [
        { type: "twitter",  url: "javascript:drain()" },    // XSS
        { type: "telegram", url: "https://t.me/real" },      // legit
      ],
    },
  };

  it("drops javascript: / data: websites, keeps the http(s) one", () => {
    const d = pairToDetail(malicious);
    expect(d.websites).toEqual(["https://real-token.xyz/"]);
    expect(d.websites.some((u) => /javascript:|data:/i.test(u))).toBe(false);
  });

  it("drops javascript: socials, keeps the legit one", () => {
    const d = pairToDetail(malicious);
    expect(d.socials.map((s) => s.url)).toEqual(["https://t.me/real"]);
    expect(d.socials.some((s) => /javascript:|data:/i.test(s.url))).toBe(false);
  });

  it("a token with ONLY malicious links yields empty arrays (no sink fuel)", () => {
    const d = pairToDetail({
      ...malicious,
      info: { websites: [{ url: "javascript:1" }], socials: [{ type: "x", url: "vbscript:1" }] },
    });
    expect(d.websites).toEqual([]);
    expect(d.socials).toEqual([]);
  });
});
