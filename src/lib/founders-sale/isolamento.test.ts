import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
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

  it("nenhuma rota ou página importa founders-sale", () => {
    const usos = arquivos(join(RAIZ, "src/app")).filter((p) => readFileSync(p, "utf8").includes("founders-sale"));
    expect(usos).toEqual([]);
  });
});
