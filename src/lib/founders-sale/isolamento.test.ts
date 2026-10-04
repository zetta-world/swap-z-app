import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * NFT_REAL_SALE=OFF · MAINNET_MINT=OFF · PUBLIC_SALE=OFF como TRAVA, não como promessa:
 * as fundações da venda não falam com rede/chain, e nenhuma rota/página as usa ainda.
 * Quando o dono decidir (docs/PLANO-FOUNDERS-NFT-SALE-READINESS.md §2), esta trava muda junto
 * com a decisão — conscientemente.
 */
const RAIZ = process.cwd();
const DIR = join(RAIZ, "src/lib/founders-sale");
const modulos = readdirSync(DIR).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"));

function arquivos(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) arquivos(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

describe("founders-sale: isolado de rede, chain e rotas", () => {
  it("só importa node:crypto e módulos irmãos", () => {
    for (const m of modulos) {
      const s = readFileSync(join(DIR, m), "utf8");
      for (const [, de] of s.matchAll(/from\s+["']([^"']+)["']/g)) {
        expect(de === "node:crypto" || de.startsWith("./"), `${m} importa ${de}`).toBe(true);
      }
      expect(/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(s), `${m} faz chamada de rede`).toBe(false);
    }
  });

  /**
   * Única exceção permitida: a rota de PRÉVIA LOCAL atrás de `FOUNDERS_SALE_PREVIEW=1` (decisão de 04/10: a
   * experiência completa precisa existir localmente; produção não tem a flag → 404). Qualquer outra rota/página
   * que importe a venda reprova.
   */
  const PREVIA = join("src", "app", "(previa)", "founders-pass");
  it("só a rota de prévia (com porta) importa founders-sale ou o painel", () => {
    const usos = arquivos(join(RAIZ, "src/app"))
      .filter((p) => /founders-sale|components\/founders/.test(readFileSync(p, "utf8")))
      .map((p) => p.replace(RAIZ + "/", ""));
    expect(usos).toEqual([join(PREVIA, "page.tsx")]);
    const page = readFileSync(join(RAIZ, PREVIA, "page.tsx"), "utf8");
    expect(page).toMatch(/if \(!previaHabilitada\(\)\) notFound\(\);/);
    expect(readFileSync(join(RAIZ, PREVIA, "gate.ts"), "utf8")).toMatch(/process\.env\.FOUNDERS_SALE_PREVIEW === "1"/);
    // HTTP 404 de verdade: nenhuma fronteira de loading acima da porta (senão o status sai 200 — L-038)
    expect(existsSync(join(RAIZ, "src", "app", "(previa)", "loading.tsx"))).toBe(false);
    expect(existsSync(join(RAIZ, PREVIA, "loading.tsx"))).toBe(false);
  });

  it("a porta fica FECHADA sem a flag e só abre com o valor exato \"1\"", async () => {
    const { previaHabilitada } = await import("../../app/(previa)/founders-pass/gate");
    const antes = process.env.FOUNDERS_SALE_PREVIEW;
    try {
      delete process.env.FOUNDERS_SALE_PREVIEW; expect(previaHabilitada()).toBe(false);
      for (const v of ["", "0", "true", "yes", " 1"]) { process.env.FOUNDERS_SALE_PREVIEW = v; expect(previaHabilitada()).toBe(false); }
      process.env.FOUNDERS_SALE_PREVIEW = "1"; expect(previaHabilitada()).toBe(true);
    } finally { if (antes === undefined) delete process.env.FOUNDERS_SALE_PREVIEW; else process.env.FOUNDERS_SALE_PREVIEW = antes; }
  });

  it("nenhum componente fora de components/founders usa o painel; o painel não fala com rede", () => {
    const fora = arquivos(join(RAIZ, "src/components"))
      .filter((p) => !p.includes(join("components", "founders")))
      .filter((p) => /components\/founders|founders-sale/.test(readFileSync(p, "utf8")));
    expect(fora).toEqual([]);
    for (const p of arquivos(join(RAIZ, "src/components/founders"))) {
      expect(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource/.test(readFileSync(p, "utf8")), p).toBe(false);
    }
  });
});
