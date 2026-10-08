import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { foundersPublicCopy } from "@/lib/founders-public/content";
import { foundersPublicFacts } from "@/lib/founders-public/facts";
import type { PublicLocale } from "@/lib/founders-public/types";
import FoundersPublicPage from "./FoundersPublicPage";

let locale: PublicLocale = "pt";
vi.mock("@/lib/store/ui", () => ({ useUI: () => ({ lang: locale, setLang: vi.fn() }) }));
vi.mock("@/lib/founders-public/telemetry", () => ({ trackFoundersPublicEvent: vi.fn() }));

describe("FoundersPublicPage", () => {
  beforeEach(() => { locale = "pt"; });

  it("renders the full public experience without a buy, mint or fake countdown control", () => {
    const html = renderToStaticMarkup(createElement(FoundersPublicPage, { facts: foundersPublicFacts() }));
    expect((html.match(/<h1/g) ?? [])).toHaveLength(1);
    expect((html.match(/<details/g) ?? [])).toHaveLength(59);
    for (const id of ["products", "founder", "tiers", "sale", "custody", "faq", "risk"]) expect(html).toContain(`id=\"${id}\"`);
    expect(html).toContain("36 meses Premium");
    expect(html).toContain("Implementado / desabilitado");
    expect(html).toContain("A confirmar");
    expect(html).not.toMatch(/>\s*(buy|mint|comprar|cunhar)\s*</i);
    expect(html).not.toContain("data-countdown");
  });

  it("renders all localized public variants without unresolved placeholders", () => {
    for (const next of ["en", "pt", "es", "zh"] as PublicLocale[]) {
      locale = next;
      const html = renderToStaticMarkup(createElement(FoundersPublicPage, { facts: foundersPublicFacts() }));
      expect(html).toContain(foundersPublicCopy(next, foundersPublicFacts()).hero.title);
      expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });
});
