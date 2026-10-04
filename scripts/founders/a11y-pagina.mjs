// Checagem de navegador da PÁGINA Founders (file://, rede bloqueada). Uso:
//   (1) FOUNDERS_PAGINA_OUT=<dir> npx vitest run src/components/founders/founders-page.test.ts
//   (2) npx tailwindcss -i src/app/globals.css -o <dir>/pagina.css --content "src/components/founders/*.tsx,<dir>/*.html"
//   (3) node scripts/founders/a11y-pagina.mjs <dir>   (Chrome local; PLAYWRIGHT_CORE/CHROME opcionais)
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const G = process.argv[2];
const out = []; let falhas = 0;
const ok = (c, msg) => { out.push(`${c ? "PASS" : "FAIL"} ${msg}`); if (!c) falhas++; };
const paginas = readdirSync(G).filter((n) => /^pagina-.*\.html$/.test(n)).sort();

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
  const bloqueadas = [];
  for (const arq of paginas) {
    for (const [nome, w, h] of [["mobile", 375, 812], ["tablet", 768, 1024], ["desktop", 1280, 900]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
      const p = await ctx.newPage();
      await p.route("**/*", (r) => r.request().url().startsWith("file:") ? r.continue() : (bloqueadas.push(r.request().url()), r.abort()));
      await p.goto(`file://${G}/${arq}`);
      const m = await p.evaluate(() => {
        const de = document.documentElement;
        const alvos = [...document.querySelectorAll("button, select, summary, a[href]")].filter((e) => e.getClientRects().length);
        // contraste WCAG: cor do texto × primeiro fundo opaco subindo a árvore (fallback: fundo do body)
        const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
        const lum = ([r, g, bb]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bb); };
        const fundo = (el) => {
          for (let e = el; e; e = e.parentElement) {
            const cs = getComputedStyle(e);
            if (/gradient/.test(cs.backgroundImage)) { const g = cs.backgroundImage.match(/rgba?\(([^)]+)\)/); if (g) { const c = g[1].split(",").map(Number); if (c[3] === undefined || c[3] > 0.95) return c; } }
            const c = rgb(cs.backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.95)) return c;
          }
          return [2, 3, 10];
        };
        const ruins = [];
        for (const el of document.querySelectorAll("p, li, dt, dd, span, h1, h2, h3, button, summary, label, option")) {
          if (!el.getClientRects().length || !el.textContent.trim() || el.closest("[aria-hidden=true]") || el.classList.contains("sr-only")) continue;
          const cs = getComputedStyle(el);
          const fg = rgb(cs.color), bg = fundo(el);
          const a = fg[3] === undefined ? 1 : fg[3];
          const misto = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
          const L1 = lum(misto), L2 = lum(bg);
          const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          const grande = parseFloat(cs.fontSize) >= 18.66 || (parseFloat(cs.fontSize) >= 14 && Number(cs.fontWeight) >= 700);
          const disabled = el.closest("button:disabled");
          if (!disabled && ratio < (grande ? 3 : 4.5)) ruins.push(`${el.tagName}:${ratio.toFixed(2)}:${el.textContent.trim().slice(0, 30)}`);
        }
        return {
          overflow: de.scrollWidth - de.clientWidth,
          cortados: [...document.querySelectorAll("dd,h1,h2,h3,button,summary")].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
          alvoMin: Math.min(...alvos.map((e) => e.getBoundingClientRect().height)),
          h1: document.querySelectorAll("h1").length,
          animados: [...document.querySelectorAll("*")].filter((e) => getComputedStyle(e).animationName !== "none").length,
          contrasteRuim: ruins,
        };
      });
      ok(m.overflow <= 0, `${arq}/${nome}: sem rolagem horizontal (${m.overflow}px)`);
      ok(m.cortados === 0, `${arq}/${nome}: nenhum texto cortado (${m.cortados})`);
      ok(m.alvoMin >= 44, `${arq}/${nome}: alvos de toque ≥ 44px (${m.alvoMin.toFixed(1)})`);
      ok(m.h1 === 1, `${arq}/${nome}: um único h1`);
      ok(m.animados === 0, `${arq}/${nome}: reduced-motion → nenhuma animação (${m.animados})`);
      ok(m.contrasteRuim.length === 0, `${arq}/${nome}: contraste WCAG AA (${m.contrasteRuim.slice(0, 3).join(" | ") || "ok"})`);
      if (nome === "desktop") {
        // teclado: todos os interativos visíveis alcançáveis por Tab, foco visível
        const alcancados = new Set(); let semFoco = 0;
        for (let i = 0; i < 40; i++) {
          await p.keyboard.press("Tab");
          const r = await p.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return null; const cs = getComputedStyle(a); return { k: String([...document.querySelectorAll("*")].indexOf(a)), vis: cs.outlineStyle !== "none" && cs.outlineWidth !== "0px" }; });
          if (!r) continue; if (alcancados.has(r.k)) break; alcancados.add(r.k); if (!r.vis) semFoco++;
        }
        const interativos = await p.evaluate(() => [...document.querySelectorAll("button:not(:disabled), select, summary, a[href]")].filter((e) => e.getClientRects().length).length);
        ok(alcancados.size >= interativos, `${arq}: Tab alcança os ${interativos} interativos (${alcancados.size})`);
        ok(semFoco === 0, `${arq}: foco visível em todos (${semFoco} sem)`);
        const cdp = await ctx.newCDPSession(p);
        const { nodes } = await cdp.send("Accessibility.getFullAXTree");
        const val = (n, k) => n[k]?.value;
        const papeis = (r) => nodes.filter((n) => val(n, "role") === r && !n.ignored);
        ok(papeis("main").length === 1, `${arq}: um landmark main`);
        ok(papeis("region").length >= 8 && papeis("region").every((n) => val(n, "name")), `${arq}: regiões nomeadas (${papeis("region").length})`);
        ok(papeis("status").length >= 2, `${arq}: status com aria-live (${papeis("status").length})`);
        ok(papeis("navigation").every((n) => val(n, "name")), `${arq}: navegação da prévia rotulada`);
        const botoes = papeis("button");
        ok(botoes.every((n) => val(n, "name")), `${arq}: todo botão tem nome acessível`);
        ok(papeis("combobox").every((n) => val(n, "name")), `${arq}: seletor de cenário rotulado`);
      }
      await ctx.close();
    }
  }
  ok(bloqueadas.length === 0, `rede: nenhuma requisição fora de file:// (${bloqueadas.length})`);
  await b.close();
  console.log(out.join("\n")); console.log(`PAGINAS=${paginas.length} FALHAS=${falhas}`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
