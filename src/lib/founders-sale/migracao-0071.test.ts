import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TIPOS_EVIDENCIA } from "./evidencia";
import { TIERS } from "./config";

/** A 0071 espelha o domínio: tipos de evidência, tiers e o que ela NÃO pode guardar. Prova SQL: supabase/tests/18. */
const SQL = readFileSync("supabase/migrations/0071_founders_sale.sql", "utf8");
const codigo = SQL.replace(/--[^\n]*/g, "");

describe("migration 0071 — venda Founders", () => {
  it("tipos de evidência e tiers iguais aos do domínio", () => {
    for (const t of TIPOS_EVIDENCIA) expect(codigo).toContain(`'${t}'`);
    expect(codigo).toMatch(new RegExp(`tier in \\(${TIERS.map((t) => `'${t}'`).join(", ")}\\)`));
  });
  it("aditiva: só cria o que é dela; não altera/derruba nada existente; ACL fechada", () => {
    expect(codigo).not.toMatch(/\bdrop table\b|\balter table (?!public\.founders_)|\btruncate\b(?! on public\.founders_sale_events)/i);
    for (const t of ["founders_allowlist_snapshots", "founders_allowlist_entries", "founders_demand_signals", "founders_sale_events"]) {
      expect(codigo).toContain(`alter table public.${t}`);
      expect(codigo).toMatch(new RegExp(`revoke all on table public\\.${t}\\s+from public, anon, authenticated, service_role`));
    }
    expect(codigo).not.toMatch(/create policy/i);
  });
  it("não guarda decisão pendente nem dado sensível: sem preço, royalty, tesouraria, e-mail, chave", () => {
    expect(codigo).not.toMatch(/\b(preco|price|royalty|tesouraria|treasury|email|secret|private_key|lamports)\b/i);
  });
});

describe("migration 0072 — preço exibido e versão da regra no sinal de demanda", () => {
  const sql72 = readFileSync("supabase/migrations/0072_founders_demand_price_rule.sql", "utf8").replace(/--[^\n]*/g, "");
  it("aditiva, só em founders_demand_signals; sem policy; anon/authenticated revogados", () => {
    expect(sql72).not.toMatch(/\bdrop table\b|\btruncate\b|create policy/i);
    for (const m of sql72.matchAll(/alter table (public\.[a-z_]+)/gi)) expect(m[1]).toBe("public.founders_demand_signals");
    expect(sql72).toMatch(/revoke all on table public\.founders_demand_signals from public, anon, authenticated/);
    expect(sql72).toMatch(/grant update \(preco_intencao_usd\)/);
    expect(sql72).not.toMatch(/grant [^;]*regra_versao/);
  });
  it("pretende_comprar exige preço; nada de royalty, tesouraria, e-mail ou chave", () => {
    expect(sql72).toMatch(/intencao_nao_vinculante is distinct from 'pretende_comprar' or preco_intencao_usd is not null/);
    expect(sql72).not.toMatch(/\b(royalty|tesouraria|treasury|email|secret|private_key|lamports)\b/i);
  });
});
