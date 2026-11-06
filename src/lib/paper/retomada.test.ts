import { describe, expect, it } from "vitest";
import { computeExitPath } from "./saida";

const agora = Date.parse("2026-11-04T20:00:00Z");
const H = 3_600_000;

describe("saída após pausa não inventa o preço passado", () => {
  const pos = { side: "buy", entry_price: 100, cost_usd: 50, target_price: 110, stop_price: 95,
    opened_at: "2026-09-15T00:00:00Z", horizon_hours: 8 };
  it.each([90, 100, 120])("sem trajetória antiga não fecha ao spot de hoje: %s", (spot) => {
    expect(computeExitPath(pos, [], spot, agora)).toBeNull();
    expect(computeExitPath(pos, [{ t: agora, high: 120, low: 90, close: spot }], spot, agora)).toBeNull();
  });
  it("continua resolvendo um toque observado dentro da janela original", () => {
    const vela = { t: Date.parse(pos.opened_at) + H, high: 112, low: 99, close: 109 };
    expect(computeExitPath(pos, [vela], 90, agora)?.reason).toBe("target");
  });
});
