/**
 * ADM-004 — leitura de interruptor que falha é DESCONHECIDA, nunca "desligado".
 * E todo interruptor tem consumidor real (ou está declarado aposentado).
 */
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAVES_DE_INTERRUPTOR, MAPA_INTERRUPTORES } from "./gate-keys";
import { estadoDoValor, observarInterruptores, type LeituraInterruptores } from "./kill-switches";

describe("ADM-004 · tri-estado", () => {
  it("leitura falha → TODAS desconhecidas (nem OFF, nem ON)", () => {
    const l = { lido: false, errorCode: "leitura_falhou", asOf: null } as unknown as LeituraInterruptores;
    const o = observarInterruptores(l, CHAVES_DE_INTERRUPTOR);
    expect(new Set(Object.values(o).map((x) => x.estado))).toEqual(new Set(["desconhecido"]));
  });

  it("valor gravado: 'true' = on, 'false'/ausente = off, lixo = inválido", () => {
    expect(estadoDoValor("true")).toBe("on");
    expect(estadoDoValor("false")).toBe("off");
    expect(estadoDoValor(null)).toBe("off");
    expect(estadoDoValor("undefined")).toBe("invalido");
  });
});

describe("cada interruptor é lido por alguém (ou está aposentado, por escrito)", () => {
  for (const chave of CHAVES_DE_INTERRUPTOR) {
    it(chave, () => {
      const m = MAPA_INTERRUPTORES[chave];
      if (m.aposentado) {
        expect(m.consumidores).toEqual([]);
        expect(m.aposentado.length).toBeGreaterThan(10);
        return;
      }
      expect(m.consumidores.length).toBeGreaterThan(0);
      for (const arq of m.consumidores) {
        expect(arq.startsWith("src/lib/admin/"), `${arq} é do admin, não consumidor`).toBe(false);
        expect(existsSync(join(process.cwd(), arq)), arq).toBe(true);
        expect(readFileSync(join(process.cwd(), arq), "utf8"), `${arq} não lê ${chave}`).toContain(chave);
      }
    });
  }
});

describe("GET /admin/api/killswitch", () => {
  it("leitura falha → 503 unavailable, SEM mapa de estados (nunca {switches:{}})", async () => {
    vi.resetModules();
    vi.doMock("@/lib/admin/require", () => ({ requireAdmin: async () => ({ wallet: "0xA" }) }));
    vi.doMock("@/lib/admin/track", () => ({ logSecurity: vi.fn() }));
    vi.doMock("@/lib/admin/kill-switches", async (orig) => ({
      ...(await orig<typeof import("./kill-switches")>()),
      lerInterruptores: async () => ({ lido: false, errorCode: "tempo_esgotado", asOf: null }),
    }));
    const { GET } = await import("@/app/admin/api/killswitch/route");
    const r = await GET();
    expect(r.status).toBe(503);
    const j = await r.json();
    expect(j.state).toBe("unavailable");
    expect(j).not.toHaveProperty("switches");
    expect(j).not.toHaveProperty("interruptores");
    vi.doUnmock("@/lib/admin/kill-switches");
  });
});
