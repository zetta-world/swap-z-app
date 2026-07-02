import { describe, it, expect } from "vitest";
import { parsePrice } from "@/lib/zion/card-mapping";

/**
 * parsePrice is money-critical: a locale slip here already caused real damage
 * once (PT/EU "7,32" read as 732). These tests pin the "last separator is the
 * decimal" contract across every format the models actually emit.
 */
describe("parsePrice", () => {
  it("parses plain machine-format numbers", () => {
    expect(parsePrice("7.32")).toBe(7.32);
    expect(parsePrice("64000")).toBe(64000);
    expect(parsePrice("0.000123")).toBe(0.000123);
  });

  it("parses PT/EU comma-decimal", () => {
    expect(parsePrice("7,32")).toBe(7.32);
    expect(parsePrice("0,816")).toBe(0.816);
  });

  it("never reads a sub-$1 price with 3 decimals as thousands (DOT 1000x bug)", () => {
    expect(parsePrice("0.816")).toBe(0.816);
    expect(parsePrice("0,816")).toBe(0.816);
    expect(parsePrice("0.123")).toBe(0.123);
  });

  it("parses mixed thousands + decimal in both conventions", () => {
    expect(parsePrice("1.234,56")).toBe(1234.56); // EU: dot thousands, comma decimal
    expect(parsePrice("1,234.56")).toBe(1234.56); // US: comma thousands, dot decimal
    expect(parsePrice("64.000,10")).toBe(64000.10);
  });

  it("treats single separator with 3-digit groups as thousands", () => {
    expect(parsePrice("1,234")).toBe(1234);
    expect(parsePrice("64.000")).toBe(64000);
  });

  it("strips currency symbols and junk", () => {
    expect(parsePrice("$7.32")).toBe(7.32);
    expect(parsePrice("R$ 1.234,56")).toBe(1234.56);
    expect(parsePrice("64000 USDT")).toBe(64000);
  });

  it("returns 0 on garbage / non-positive", () => {
    expect(parsePrice("")).toBe(0);
    expect(parsePrice("abc")).toBe(0);
    expect(parsePrice("-5")).toBe(5 /* sign stripped by sanitizer; documents current behavior */);
  });
});
