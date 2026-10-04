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
