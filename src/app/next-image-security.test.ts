import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(candidate);
    return /\.[jt]sx?$/.test(entry.name) ? [candidate] : [];
  });
}

describe("Next image optimizer boundary", () => {
  it("does not allow arbitrary remote image hosts", () => {
    const source = readFileSync("next.config.mjs", "utf8");
    expect(source).not.toMatch(/hostname\s*:\s*["']\*\*["']/);
    expect(source).not.toMatch(/images\s*:\s*\{[\s\S]*remotePatterns/s);
  });

  it("keeps every literal next/image source local", () => {
    const files = sourceFilesUnder("src").filter((file) => {
      const source = readFileSync(file, "utf8");
      return /from\s+["']next\/image["']/.test(source);
    });
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const component = source.match(/import\s+(\w+)\s+from\s+["']next\/image["']/)?.[1];
      expect(component, `${file} must use a default next/image import`).toBeTruthy();
      expect(source).not.toMatch(new RegExp(`<${component}\\b[^>]{0,500}\\bsrc\\s*=\\s*["']https?://`));
    }
  });
});
