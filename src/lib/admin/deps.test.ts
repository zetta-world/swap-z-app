import { describe, it, expect } from "vitest";
import { EXTERNAL_DEPS, summarizeDeps, type DepStatus } from "@/lib/admin/deps";

const dep = (over: Partial<DepStatus>): DepStatus => ({
  id: "x", name: "X", purpose: "p", breaks: "b", impact: "critical",
  ok: true, latencyMs: 10, ...over,
});

describe("catálogo de dependências", () => {
  it("cobre TODO o caminho do dinheiro — o buraco que deixou a Jupiter morrer em silêncio", () => {
    const ids = EXTERNAL_DEPS.map((d) => d.id);
    for (const required of ["jupiter", "zerox", "lifi", "geckoterminal", "binance_spot", "gateio"]) {
      expect(ids).toContain(required);
    }
  });

  it("toda dependência declara O QUE QUEBRA — sem isso o alerta é inútil de madrugada", () => {
    for (const d of EXTERNAL_DEPS) {
      expect(d.breaks.length).toBeGreaterThan(10);
      expect(d.purpose.length).toBeGreaterThan(5);
    }
  });

  it("quem executa swap é classificado como CRÍTICO", () => {
    for (const id of ["jupiter", "zerox", "lifi"]) {
      expect(EXTERNAL_DEPS.find((d) => d.id === id)!.impact).toBe("critical");
    }
  });

  it("não tem id duplicado (dedup de alerta usa o id como chave)", () => {
    const ids = EXTERNAL_DEPS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("geobloqueio (451) não é incidente", () => {
  it("451 sai da conta de queda — senão o painel fica amarelo pra sempre", () => {
    // A Binance recusa IP de datacenter americano e a Vercel roda nos EUA.
    // É condição PERMANENTE da região, não evento. Um alarme que nunca apaga
    // treina o operador a ignorar todos os outros.
    const r = summarizeDeps([
      dep({ id: "fut", name: "Binance Futuros", ok: false, geoBlocked: true, impact: "degraded" }),
    ]);
    expect(r.degradedDown).toHaveLength(0);
    expect(r.criticalDown).toHaveLength(0);
    expect(r.geoBlocked).toHaveLength(1);
    expect(r.verdict).toContain("🟢");
  });

  it("mas continua VISÍVEL no veredito — o sinal realmente não chega", () => {
    const r = summarizeDeps([dep({ name: "Binance Futuros", ok: false, geoBlocked: true, impact: "degraded" })]);
    expect(r.verdict).toContain("Binance Futuros");
    expect(r.verdict).toContain("regional");
  });

  it("geobloqueio não mascara uma queda real que aconteça junto", () => {
    const r = summarizeDeps([
      dep({ id: "fut", ok: false, geoBlocked: true, impact: "degraded" }),
      dep({ id: "jup", name: "Jupiter", ok: false, impact: "critical" }),
    ]);
    expect(r.verdict).toContain("🔴");
    expect(r.criticalDown).toHaveLength(1);
  });
});

describe("summarizeDeps — o que merece acordar alguém", () => {
  it("tudo no ar → verde", () => {
    const r = summarizeDeps([dep({}), dep({ id: "y", impact: "degraded" })]);
    expect(r.verdict).toContain("🟢");
    expect(r.criticalDown).toHaveLength(0);
  });

  it("crítica fora → vermelho, e nomeia quem caiu", () => {
    const r = summarizeDeps([dep({ name: "Jupiter", ok: false, impact: "critical" })]);
    expect(r.verdict).toContain("🔴");
    expect(r.verdict).toContain("Jupiter");
    expect(r.criticalDown).toHaveLength(1);
  });

  it("só degradada fora → amarelo, não vermelho", () => {
    const r = summarizeDeps([dep({ name: "Gate.io", ok: false, impact: "degraded" })]);
    expect(r.verdict).toContain("🟡");
    expect(r.criticalDown).toHaveLength(0);
  });

  it("cosmética fora NÃO conta como incidente (alarme à toa vira alarme ignorado)", () => {
    const r = summarizeDeps([dep({ name: "Fear & Greed", ok: false, impact: "cosmetic" })]);
    expect(r.criticalDown).toHaveLength(0);
    expect(r.degradedDown).toHaveLength(0);
    expect(r.verdict).toContain("🟢");
  });

  it("crítica vence degradada no veredito", () => {
    const r = summarizeDeps([
      dep({ name: "Gate.io", ok: false, impact: "degraded" }),
      dep({ id: "j", name: "Jupiter", ok: false, impact: "critical" }),
    ]);
    expect(r.verdict).toContain("🔴");
    expect(r.verdict).toContain("Jupiter");
  });
});
