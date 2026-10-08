import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { messages } from "@/lib/i18n/messages";

const READ_ONLY_WORDING = {
  en: /read-only/i,
  pt: /somente para leitura/i,
  es: /solo lectura/i,
  zh: /只读/,
} as const;

const FORBIDDEN_ACTION_CLAIMS = [
  /provide liquidity/i,
  /prover liquidez/i,
  /proveer liquidez/i,
  /提供流动性/,
];

describe("public scope of Pools and Portfolio", () => {
  it.each(Object.keys(READ_ONLY_WORDING) as Array<keyof typeof READ_ONLY_WORDING>)(
    "%s describes Pools as read-only and does not promise a liquidity action",
    (locale) => {
      const copy = messages[locale].pools;
      expect(`${copy.body} ${copy.emptyBody}`).toMatch(READ_ONLY_WORDING[locale]);
      for (const forbidden of FORBIDDEN_ACTION_CLAIMS) {
        expect(copy.body).not.toMatch(forbidden);
      }
    },
  );

  it.each(Object.keys(READ_ONLY_WORDING) as Array<keyof typeof READ_ONLY_WORDING>)(
    "%s limits Portfolio wording to the assets that page actually tracks",
    (locale) => {
      const copy = messages[locale].portfolio.connectWalletBody;
      expect(copy).not.toMatch(/(?:9|10\+)\s*(?:chains?|redes|cadenas|条链)/i);
    },
  );

  it("keeps the Pools surface read-only in code", () => {
    const source = readFileSync(new URL("./PoolsView.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(?:deposit|withdraw|addLiquidity|removeLiquidity)\b/);
  });
});
