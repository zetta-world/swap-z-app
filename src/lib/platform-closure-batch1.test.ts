import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PC-2 / A51 — rearme preserva rails", () => {
  const migration = readFileSync("supabase/migrations/0065_autopilot_rearm_preserva_rails.sql", "utf8");
  const sessions = readFileSync("src/lib/autopilot/sessions.ts", "utf8");

  it("A51.1/A51.2: mesma data preserva trades, pnl, freeze e não escreve bandeiras", () => {
    expect(migration).toMatch(/last_reset_day\s*=\s*v_hoje[\s\S]*then public\.autopilot_sessions\.trades_today/);
    expect(migration).toMatch(/last_reset_day\s*=\s*v_hoje[\s\S]*then public\.autopilot_sessions\.pnl_today/);
    expect(migration).toMatch(/then public\.autopilot_sessions\.frozen_until_day/);
    expect(migration).not.toMatch(/set[\s\S]*contabilidade_incompleta_em\s*=/i);
    expect(migration).not.toMatch(/set[\s\S]*quarentena_em\s*=/i);
  });

  it("A51.3/A51.4: data nova zera rails; sessão nova nasce limpa", () => {
    expect(migration).toMatch(/else 0\s*end,\s*pnl_today/);
    expect(migration).toMatch(/else v_hoje\s*end,\s*frozen_until_day/);
    expect(migration).toMatch(/else null\s*end,/);
    expect(migration).toMatch(/p_expires_at,\s*0,\s*0,\s*v_hoje,\s*null,/);
  });

  it("A51.5: rearm atualiza conexão/config por RPC atômica sem creds_cipher", () => {
    expect(sessions).toContain('rearmRpc("autopilot_rearm_preserva_rails"');
    expect(sessions).toContain("p_conexao_id: cofre.id");
    expect(sessions).not.toMatch(/\.from\("autopilot_sessions"\)[\s\S]{0,160}\.upsert\(/);
    expect(migration).not.toContain("creds_cipher");
  });

  it("RPC nasce SECURITY DEFINER com search_path e ACL service_role-only", () => {
    expect(migration).toMatch(/security definer/i);
    expect(migration).toMatch(/set search_path = public, pg_temp/i);
    expect(migration).toMatch(/revoke all on function public\.autopilot_rearm_preserva_rails[\s\S]*from public, anon, authenticated;/i);
    expect(migration).toMatch(/grant execute on function public\.autopilot_rearm_preserva_rails[\s\S]*to service_role;/i);
  });
});

describe("PC-3 — regiões financeiras", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    functions: Record<string, { regions?: string[] }>;
  };

  it.each([
    "src/app/api/cex/order/route.ts",
    "src/app/api/autopilot/cron/route.ts",
    "src/app/api/dca/cron/route.ts",
  ])("fixa %s em gru1", (path) => {
    expect(vercel.functions[path]?.regions).toEqual(["gru1"]);
  });
});
