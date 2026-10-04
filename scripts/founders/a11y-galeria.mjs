// Uso: (1) FOUNDERS_GALERIA_OUT=<dir> npx vitest run src/components/founders
//      (2) npx tailwindcss -i src/app/globals.css -o <dir>/galeria.css --content "src/components/founders/*.tsx,<dir>/*.html"
//      (3) node scripts/founders/a11y-galeria.mjs <dir>   (Chrome local; PLAYWRIGHT_CORE/CHROME opcionais)
// Checagem de navegador da galeria Founders (file://, rede bloqueada).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const G = process.argv[2];
const out = []; let falhas = 0;
const ok = (c, msg) => { out.push(`${c ? "PASS" : "FAIL"} ${msg}`); if (!c) falhas++; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
  const bloqueadas = [];
  for (const lang of ["en", "zh"]) {
    for (const [nome, w, h] of [["mobile", 375, 812], ["tablet", 768, 1024], ["desktop", 1280, 800]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h } });
      const p = await ctx.newPage();
      await p.route("**/*", (r) => r.request().url().startsWith("file:") ? r.continue() : (bloqueadas.push(r.request().url()), r.abort()));
      await p.goto(`file://${G}/galeria-${lang}.html`);
      const m = await p.evaluate(() => {
        const de = document.documentElement;
        const secs = [...document.querySelectorAll("section")];
        return {
          overflow: de.scrollWidth - de.clientWidth,
          secFora: secs.filter((s) => { const r = s.getBoundingClientRect(); return r.left < 0 || r.right > de.clientWidth + 0.5; }).length,
          secs: secs.length,
          textoCortado: [...document.querySelectorAll("dd,h2,button")].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
          botaoMin: Math.min(...[...document.querySelectorAll("button")].map((e) => e.getBoundingClientRect().height)),
          cols: new Set(secs.map((s) => Math.round(s.getBoundingClientRect().left))).size,
        };
      });
      ok(m.secs === 21, `${lang}/${nome}: 21 painéis (${m.secs})`);
      ok(m.overflow <= 0, `${lang}/${nome}: sem rolagem horizontal (excesso ${m.overflow}px)`);
      ok(m.secFora === 0, `${lang}/${nome}: nenhum painel fora da largura`);
      ok(m.textoCortado === 0, `${lang}/${nome}: nenhum texto cortado em dd/h2/botão (${m.textoCortado})`);
      ok(m.botaoMin >= 44, `${lang}/${nome}: alvo de toque do botão >= 44px (${m.botaoMin.toFixed(1)})`);
      out.push(`INFO ${lang}/${nome}: colunas=${m.cols}`);
      await p.screenshot({ path: `${G}/shot-${lang}-${nome}.png`, fullPage: true });

      if (lang === "en" && nome === "desktop") {
        // teclado: Tab só alcança os 2 botões habilitados, na ordem do documento, com foco visível
        const visitados = [];
        for (let i = 0; i < 4; i++) {
          await p.keyboard.press("Tab");
          visitados.push(await p.evaluate(() => {
            const a = document.activeElement; if (!a || a === document.body) return null;
            const cs = getComputedStyle(a);
            return { estado: a.closest("section")?.dataset.estado, tag: a.tagName, outline: cs.outlineStyle, ow: cs.outlineWidth };
          }));
        }
        const alvos = visitados.filter(Boolean).map((v) => v.estado);
        ok(JSON.stringify(alvos.slice(0, 2)) === JSON.stringify(["ELIGIBLE", "SALE_ACTIVE"]), `teclado: Tab alcança ELIGIBLE e SALE_ACTIVE em ordem (${alvos.join(",")})`);
        ok(visitados[0] && visitados[0].outline !== "none" && visitados[0].ow !== "0px", `teclado: foco visível (${visitados[0]?.outline} ${visitados[0]?.ow})`);
        await p.keyboard.press("Shift+Tab");
        const voltou = await p.evaluate(() => document.activeElement?.closest("section")?.dataset.estado ?? null);
        out.push(`INFO teclado: Shift+Tab -> ${voltou}`);

        // árvore de acessibilidade (CDP): nomes, papéis e descrições
        const cdp = await ctx.newCDPSession(p);
        const { nodes } = await cdp.send("Accessibility.getFullAXTree");
        const val = (n, k) => n[k]?.value;
        const regioes = nodes.filter((n) => val(n, "role") === "region");
        ok(regioes.length === 21 && regioes.every((n) => val(n, "name")), `ARIA: 21 regiões com nome acessível (${regioes.length})`);
        const status = nodes.filter((n) => val(n, "role") === "status");
        ok(status.length === 21 && status.every((n) => (n.properties || []).some((q) => q.name === "live" && q.value.value === "polite")), `ARIA: 21 status com live=polite (${status.length})`);
        const botoes = nodes.filter((n) => val(n, "role") === "button");
        const desab = botoes.filter((n) => (n.properties || []).some((q) => q.name === "disabled" && q.value.value));
        ok(botoes.length === 21 && desab.length === 19, `ARIA: 21 botões, 19 desabilitados (${botoes.length}/${desab.length})`);
        ok(desab.every((n) => val(n, "description")), `ARIA: todo botão desabilitado tem descrição (motivo)`);
        const barras = nodes.filter((n) => val(n, "role") === "progressbar");
        ok(barras.length > 0 && barras.every((n) => val(n, "name") && (n.properties || []).some((q) => q.name === "valuetext")), `ARIA: progressbar com nome e valuetext (${barras.length})`);
        const imagens = nodes.filter((n) => ["image", "img", "graphics-symbol"].includes(val(n, "role")) && !n.ignored);
        ok(imagens.length === 0, `ARIA: ícones fora da árvore (${imagens.length})`);
      }
      await ctx.close();
    }
  }
  // reduced motion
  for (const rm of ["no-preference", "reduce"]) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: rm });
    const p = await ctx.newPage();
    await p.goto(`file://${G}/galeria-en.html`);
    const anim = await p.evaluate(() => [...document.querySelectorAll("section svg")].map((s) => getComputedStyle(s).animationName).filter((n) => n !== "none"));
    if (rm === "reduce") ok(anim.length === 0, `reduced-motion=reduce: nenhuma animação (${anim.join(",") || "nenhuma"})`);
    else ok(anim.length >= 4, `reduced-motion=no-preference: ícones animados (${anim.join(",")})`);
    await ctx.close();
  }
  ok(bloqueadas.length === 0, `rede: nenhuma requisição fora de file:// (${bloqueadas.length})`);
  await b.close();
  console.log(out.join("\n")); console.log(`FALHAS=${falhas}`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
