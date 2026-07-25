import { describe, it, expect } from "vitest";
import { shouldRetro, parseLessons, lessonsBlock } from "@/lib/zion/retro";

describe("Auto-Retro — reflection loop plumbing", () => {
  it("shouldRetro: fires every N decided since the last checkpoint", () => {
    expect(shouldRetro(10, null, 10)).toBe(true);   // never reflected, crossed N
    expect(shouldRetro(9, null, 10)).toBe(false);
    expect(shouldRetro(25, 20, 10)).toBe(false);    // only +5 since last
    expect(shouldRetro(30, 20, 10)).toBe(true);
  });

  it("parseLessons: direct JSON, embedded JSON, caps and truncation", () => {
    expect(parseLessons('{"lessons":["a","b"]}')).toEqual(["a", "b"]);
    expect(parseLessons('Here you go:\n{"lessons":["only one"]}\nthanks')).toEqual(["only one"]);
    expect(parseLessons('{"lessons":["1","2","3","4","5"]}')).toHaveLength(3); // cap
    const long = parseLessons(`{"lessons":["${"x".repeat(500)}"]}`)[0];
    expect(long.length).toBe(220); // truncation — a lesson is a scalpel, not an essay
  });

  it("parseLessons: junk in, empty out (never throws into the cron)", () => {
    expect(parseLessons("no json here")).toEqual([]);
    expect(parseLessons('{"lessons": "not-an-array"}')).toEqual([]);
    expect(parseLessons("")).toEqual([]);
  });

  it("lessonsBlock: renders context-not-permission framing, empty when no lessons", () => {
    expect(lessonsBlock(undefined)).toBe("");
    expect(lessonsBlock([])).toBe("");
    const block = lessonsBlock(["counter-trend buys in RANGING all stopped"]);
    expect(block).toContain("<your_lessons>");
    expect(block).toContain("never override the desk's hard rules");
    expect(block).toContain("1. counter-trend buys in RANGING all stopped");
  });
});
