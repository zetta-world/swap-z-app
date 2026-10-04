import { describe, it, expect, vi } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import FoundersSalePanel from "./FoundersSalePanel";
import { GALERIA, ESTADOS_DA_GALERIA } from "./galeria";
import { podeMintar } from "@/lib/founders-sale/visao";

// No SSR o zustand serve o estado INICIAL (sempre "en"); para provar as 4 línguas
// de verdade, o store é trocado por um seletor sobre uma variável do teste.
const idioma = vi.hoisted(() => ({ lang: "en" as string }));
vi.mock("@/lib/store/ui", () => ({
  useUI: (sel: (s: { lang: string }) => unknown) => sel({ lang: idioma.lang }),
}));
const useUI = { setState: (s: { lang: string }) => { idioma.lang = s.lang; } };

/**
 * Renderização estática (sem DOM, sem rede) dos 14 estados do painel Founders.
 * Prova invariantes de acessibilidade no markup e, com FOUNDERS_GALERIA_OUT,
 * grava a galeria HTML usada na checagem de navegador (viewport/teclado/
 * reduced motion — docs/PLANO-FOUNDERS-NFT-SALE-READINESS.md §4).
 */
const LINGUAS = ["en", "pt", "es", "zh"] as const;

function render(estado: (typeof ESTADOS_DA_GALERIA)[number]) {
  return renderToStaticMarkup(createElement(FoundersSalePanel, { estado, ...GALERIA[estado] }));
}

describe("FoundersSalePanel — todos os estados de UI", () => {
  it("renderiza todos os estados em todas as línguas sem chave crua", () => {
    for (const lang of LINGUAS) {
      useUI.setState({ lang });
      for (const estado of ESTADOS_DA_GALERIA) {
        const html = render(estado);
        expect(html, `${lang}/${estado}`).toContain(`data-estado="${estado}"`);
        if (lang !== "en") {
          useUI.setState({ lang: "en" });
          const emIngles = render(estado);
          useUI.setState({ lang });
          expect(html, `${lang}/${estado} não traduzido`).not.toEqual(emIngles);
        }
        expect(html, `${lang}/${estado} chave crua`).not.toMatch(/founders\.[a-zA-Z_]+/);
        expect(html, `${lang}/${estado} {var} sem valor`).not.toMatch(/\{[a-z]+\}/);
      }
    }
    useUI.setState({ lang: "en" });
  });

  it("botão de mint só habilitado em ELIGIBLE/SALE_ACTIVE; senão desabilitado com motivo", () => {
    for (const estado of ESTADOS_DA_GALERIA) {
      const html = render(estado);
      const botao = html.match(/<button[^>]*>/)![0];
      if (podeMintar(estado)) {
        expect(botao, estado).not.toContain(" disabled=\"\"");
        expect(botao, estado).not.toContain("aria-describedby");
      } else {
        expect(botao, estado).toContain(" disabled=\"\"");
        const alvo = botao.match(/aria-describedby="([^"]+)"/)![1];
        expect(html, estado).toContain(`id="${alvo}"`);
      }
    }
  });

  it("região rotulada, status vivo, ícones ocultos, animação só motion-safe", () => {
    for (const estado of ESTADOS_DA_GALERIA) {
      const html = render(estado);
      const rotulo = html.match(/<section[^>]*aria-labelledby="([^"]+)"/)![1];
      expect(html).toContain(`id="${rotulo}"`);
      expect(html).toMatch(/role="status"[^>]*aria-live="polite"/);
      for (const svg of html.match(/<svg[^>]*>/g) ?? []) expect(svg).toContain('aria-hidden="true"');
      expect(html).not.toMatch(/(?<!motion-safe:)animate-(spin|pulse)/);
    }
  });

  it("sem sucesso falso: CONFIRMED só existe com referência; progresso só com números", () => {
    expect(render("TRANSACTION_CONFIRMED")).toContain("mock-tx-0001");
    for (const estado of ESTADOS_DA_GALERIA) {
      if (estado !== "TRANSACTION_CONFIRMED") expect(render(estado)).not.toContain("mock-tx-");
    }
    const semDados = render("COMING_SOON");
    expect(semDados).not.toContain('role="progressbar"');
    expect(semDados.replace(/<[^>]+>/g, " ")).not.toMatch(/\d+(\.\d)?\s*%/);
    const ok = render("SALE_ACTIVE");
    expect(ok).toMatch(/role="progressbar"[^>]*aria-valuemax="1000"[^>]*aria-valuenow="372"/);
  });

  it("contagem: dígitos decorativos ocultos, rótulo completo para leitor de tela", () => {
    const html = render("SALE_NOT_STARTED");
    expect(html).toContain('<span class="sr-only">Starts in 2 days, 1 hours, 2 minutes and 3 seconds');
  });

  it("grava a galeria quando pedido (para a checagem de navegador)", () => {
    const out = process.env.FOUNDERS_GALERIA_OUT;
    if (!out) return;
    mkdirSync(out, { recursive: true });
    for (const lang of ["en", "zh"] as const) {
      useUI.setState({ lang });
      // uma árvore só: useId gera ids únicos entre os 14 cartões
      const cartoes = renderToStaticMarkup(createElement(Fragment, null, ...ESTADOS_DA_GALERIA.map((e) =>
        createElement("div", { key: e, className: "galeria-item" }, createElement(FoundersSalePanel, { estado: e, ...GALERIA[e] })))));
      writeFileSync(join(out, `galeria-${lang}.html`),
        `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>Founders preview (${lang})</title><link rel="stylesheet" href="galeria.css"></head>` +
        `<body><main class="p-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">${cartoes}</main></body></html>`);
    }
    useUI.setState({ lang: "en" });
  });
});
