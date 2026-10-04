import { describe, it, expect, vi, beforeAll } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import FoundersSalePage from "./FoundersSalePage";
import { quadrosDaPrevia, type QuadroPrevia } from "@/lib/founders-sale/previa";

/**
 * PÁGINA FOUNDERS — render estático (sem DOM, sem rede) de TODOS os quadros nas 4 línguas.
 * Com FOUNDERS_PAGINA_OUT grava HTML para a checagem em Chrome (viewport, teclado, árvore a11y, reduced motion,
 * contraste, alvo de toque) — scripts/founders/a11y-pagina.mjs.
 */
const idioma = vi.hoisted(() => ({ lang: "en" as string }));
vi.mock("@/lib/store/ui", () => ({ useUI: (sel: (s: { lang: string }) => unknown) => sel({ lang: idioma.lang }) }));
const LINGUAS = ["en", "pt", "es", "zh"] as const;

let quadros: QuadroPrevia[] = [];
beforeAll(async () => { quadros = await quadrosDaPrevia(); });
const render = (q: QuadroPrevia, previa: boolean) => renderToStaticMarkup(createElement(FoundersSalePage, { quadros: [q], previa, inicial: q.id }));
const texto = (html: string) => html.replace(/<[^>]+>/g, " ");

describe("FoundersSalePage", () => {
  it("todos os quadros × 4 línguas: sem chave crua, sem {var}, um único h1, seções rotuladas", () => {
    for (const lang of LINGUAS) {
      idioma.lang = lang;
      for (const q of quadros) {
        const html = render(q, true);
        expect(html, `${lang}/${q.id}`).not.toMatch(/founders\.[a-zA-Z_]+/);
        expect(texto(html), `${lang}/${q.id}`).not.toMatch(/\{[a-z]+\}/);
        expect(html.match(/<h1\b/g)).toHaveLength(1);
        for (const m of html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)) expect(html).toContain(`id="${m[1]}"`);
      }
    }
    idioma.lang = "en";
  });

  it("vitrine pública (previa=false): nenhum número de preço; 'Pricing being finalized'; sem rótulo provisório nem banner de prévia", () => {
    for (const q of quadros) {
      const t = texto(render(q, false));
      expect(t).toContain("Pricing being finalized");
      expect(t).not.toMatch(/\$\s?(149|399|1,?990)\b|\b(149|399|1990) USD/);
      expect(t).not.toMatch(/PROVISIONAL|Local preview/);
    }
  });

  it("prévia (previa=true): valor só com rótulo PROVISIONAL e banner de simulação", () => {
    const t = texto(render(quadros.find((q) => q.id === "eligible")!, true));
    expect(t).toMatch(/PROVISIONAL · local simulation: 149 USD/);
    expect(t).toMatch(/Local preview — simulated data/);
  });

  it("sem promessa financeira; 36 meses; não é first-come; royalties para a tesouraria", () => {
    const t = texto(render(quadros[0], false));
    expect(t).toMatch(/not an investment/);
    expect(t).toMatch(/36 months from the official close of the sale/);
    expect(t).toMatch(/It is not first-come/);
    expect(t).toMatch(/royalties go to the Z-SWAP treasury/);
    expect(t).not.toMatch(/guaranteed (return|profit)|passive income|dividend(?!s)|revenue share(?! or)/i);
  });

  it("reserva divulgada na vitrine pública (30/10/0, fora dos 2.850) e nenhum percentual de royalty exposto", () => {
    for (const lang of LINGUAS) {
      idioma.lang = lang;
      const t = texto(render(quadros[0], false));
      expect(t, lang).toMatch(/30[\s\S]*10[\s\S]*2[.,]850/);
      expect(t, lang).not.toMatch(/royalt[^%]{0,80}\d\s?%|版税[^%]{0,40}\d\s?%|regal[^%]{0,80}\d\s?%/i);
      expect(t, lang).not.toMatch(/\+\s?30\s?%/);
    }
    idioma.lang = "en";
    const t = texto(render(quadros[0], false));
    expect(t).toContain("Reserved (not sold)");
    expect(t).toMatch(/no team or insider allocation/i);
  });

  it("onboarding só com transação confirmada e referência; esgotado só no SOLD_OUT", () => {
    for (const q of quadros) {
      const html = render(q, true);
      expect(html.includes("Welcome, Founder"), q.id).toBe(q.estadoUI === "TRANSACTION_CONFIRMED");
      expect(/<h2[^>]*>Sold out<\/h2>/.test(html), q.id).toBe(q.estadoUI === "SOLD_OUT");
    }
  });

  it("estados negativos sempre mostram próxima ação", () => {
    for (const id of ["not-eligible", "eligibility-pending", "wallet-limit", "wrong-network", "price-unavailable", "config-invalid", "unknown-state", "tx-failed", "paused", "sold-out", "ended"]) {
      expect(texto(render(quadros.find((q) => q.id === id)!, true)), id).toMatch(/What you can do/);
    }
  });

  it("grava as páginas para a checagem de navegador quando pedido", () => {
    const out = process.env.FOUNDERS_PAGINA_OUT;
    if (!out) return;
    mkdirSync(out, { recursive: true });
    for (const lang of ["en", "zh"] as const) {
      idioma.lang = lang;
      for (const id of ["coming-soon", "eligible", "tx-confirmed", "wrong-network", "sold-out"]) {
        const q = quadros.find((x) => x.id === id)!;
        writeFileSync(join(out, `pagina-${lang}-${id}.html`),
          `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
          `<title>Founders ${id} (${lang})</title><link rel="stylesheet" href="pagina.css"></head><body>${renderToStaticMarkup(createElement(FoundersSalePage, { quadros, previa: true, inicial: id }))}</body></html>`);
        void q;
      }
    }
    idioma.lang = "en";
  });
});
