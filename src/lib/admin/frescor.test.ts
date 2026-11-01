import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { idadeEmSegundos, rotuloDeFrescor } from "@/lib/admin/frescor";

describe("R3 · frescor a partir do fetchedAt (idade do DADO, não da tentativa)", () => {
  it("calcula a idade e o rótulo", () => {
    const t = Date.parse("2026-10-31T12:00:00Z");
    expect(idadeEmSegundos("2026-10-31T12:00:00Z", t + 42_000)).toBe(42);
    expect(rotuloDeFrescor(2)).toBe("agora");
    expect(rotuloDeFrescor(42)).toBe("há 42s");
    expect(rotuloDeFrescor(125)).toBe("há 2min");
    expect(rotuloDeFrescor(7300)).toBe("há 2h");
  });
  it("sem dado ou data inválida → null (o painel diz 'sem dado', não 'agora')", () => {
    expect(idadeEmSegundos(null, 0)).toBeNull();
    expect(idadeEmSegundos("lixo", 0)).toBeNull();
    expect(rotuloDeFrescor(null)).toBeNull();
  });
});

describe("R3 · polling com pausa de aba — nenhum painel sonda com setInterval próprio", () => {
  it("só o useAutoRefresh (e relógios visuais que já respeitam document.hidden) usam setInterval", () => {
    const dir = "src/components/admin";
    const arqs: string[] = [];
    const andar = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) andar(p); else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) arqs.push(p); } };
    andar(dir);
    const ofensores = arqs.filter((p) => {
      const s = readFileSync(p, "utf8");
      if (!/setInterval\(/.test(s) || p.endsWith("useAutoRefresh.ts")) return false;
      // relógio visual permitido só se respeita a aba escondida
      return !/document\.hidden/.test(s);
    });
    expect(ofensores).toEqual([]);
  });
});
