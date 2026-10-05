/**
 * RM-07 (audit remediation) — o resumo diário do watchdog não imprime $0 para leitura que falhou.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: vi.fn(() => null) }));
const { textoDoDigest } = await import("@/lib/admin/watchdog");

const ok = <T,>(linhas: T[]) => ({ linhas, erro: null, truncado: false });
const BASE = {
  users: 12, eUsers: null, active24h: 3, eActive: null, ago24h: "2026-10-04T00:00:00Z",
  opsL: ok([{ volume_usd: 100, pnl_usd: 5, created_at: "2026-10-05T00:00:00Z" }]),
  sessL: ok([{ pnl_today: 2, is_active: true }]),
  posL: ok([{ cost_usd: 40 }]),
};

describe("RM-07 · digest: indisponível ≠ $0", () => {
  it("tudo medido → os números, sem aviso", () => {
    const t = textoDoDigest(BASE);
    expect(t).toMatch(/Users: 12 \(3 active 24h\)/);
    expect(t).toMatch(/Volume 24h: \$100/);
    expect(t).toMatch(/P&L \(all\): \+\$5/);
    expect(t).not.toMatch(/indisponível|incompleta/);
  });
  it("⚠️ operações falharam → volume e P&L 'indisponível', nunca '$0'", () => {
    const t = textoDoDigest({ ...BASE, opsL: { linhas: [], erro: "timeout", truncado: false } });
    expect(t).toMatch(/Volume 24h: indisponível/);
    expect(t).toMatch(/P&L \(all\): indisponível/);
    expect(t).not.toMatch(/Volume 24h: \$0/);
    expect(t).toMatch(/leitura incompleta/);
    expect(t).toMatch(/exposure \$40/);   // o que foi medido continua
  });
  it("contagem com erro → 'indisponível'; truncado também", () => {
    const t = textoDoDigest({ ...BASE, eUsers: { message: "x" }, users: null, posL: { linhas: [], erro: null, truncado: true } });
    expect(t).toMatch(/Users: indisponível/);
    expect(t).toMatch(/exposure indisponível/);
  });
});
