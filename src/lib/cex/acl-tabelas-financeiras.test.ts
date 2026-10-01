/**
 * ⚠️⚠️ GUARDA ESTRUTURAL DA 0067 — finding DB-ACL-FINANCIAL-TABLES
 * (Platform Closure Batch 3).
 *
 * COMPLEMENTAR, NÃO SUBSTITUTA. A prova da propriedade ("as tabelas
 * financeiras são service_role only") é o PostgreSQL real, com os DEFAULT
 * PRIVILEGES do Supabase reproduzidos: `supabase/tests/14_acl_tabelas_financeiras.sql`
 * e o T10c de `02_acl_rls_substituicao.sql`. Esta trava só impede que a
 * migration seja afrouxada no texto sem que ninguém perceba no CI, que não roda
 * PostgreSQL.
 *
 * ⚠️ Por que existe a 0067: RLS ligada sem policies devolve 0 linhas e recusa
 * INSERT/UPDATE — mas NÃO cobre TRUNCATE (medido: anon truncou `cex_fills`
 * num banco descartável com os grants padrão da plataforma). O GRANT de tabela
 * é a primeira porta, e ela estava aberta nas quatro tabelas antigas.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const DIR = "supabase/migrations";
const ARQUIVO = `${DIR}/0067_acl_tabelas_financeiras.sql`;

/** O escopo do finding — EXATO. Nem uma a mais, nem uma a menos. */
const TABELAS = [
  "autopilot_position_effects",
  "autopilot_positions",
  "cex_conexoes",
  "cex_execution_intents",
  "cex_fills",
];

/** Tira comentários SQL antes de medir: a cicatriz fala de coisas que o código não faz. */
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const sql = existsSync(ARQUIVO) ? readFileSync(ARQUIVO, "utf8") : "";
const codigo = semComentarios(sql);
const statements = codigo.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);

describe("0067 — ACL das tabelas financeiras (DB-ACL-FINANCIAL-TABLES)", () => {
  it("a migration existe", () => {
    expect(existsSync(ARQUIVO), `${ARQUIVO} ausente`).toBe(true);
  });

  it("⚠️ revoga a lista EXATA das cinco tabelas, e só isso", () => {
    const re = /^revoke all on table public\.(\w+) from public, anon, authenticated$/i;
    const revogadas: string[] = [];
    for (const st of statements) {
      const m = st.match(re);
      expect(m, `statement fora do padrão REVOKE ALL ... FROM public, anon, authenticated: "${st}"`).not.toBeNull();
      revogadas.push(m![1]);
    }
    expect([...revogadas].sort()).toEqual(TABELAS);
  });

  it("⚠️ não mexe em service_role, default privileges, policies, RLS nem dados", () => {
    expect(codigo).not.toMatch(/service_role/i);
    expect(codigo).not.toMatch(/alter\s+default\s+privileges/i);
    expect(codigo).not.toMatch(/create\s+policy/i);
    expect(codigo).not.toMatch(/\bgrant\b/i);
    expect(codigo).not.toMatch(/row\s+level\s+security/i);
    expect(codigo).not.toMatch(/\b(insert|update|delete|truncate)\b/i);
    expect(codigo).not.toMatch(/\b(create|alter|drop)\b/i);
  });

  it("⚠️ as migrations certificadas 0059–0066 continuam byte a byte iguais", () => {
    /**
     * Hash fixo em vez de `git show <sha>`: o CI já caiu uma vez porque um
     * checkout raso não tinha o commit de referência. O conteúdo destes
     * arquivos é o que o retest independente certificou em 3123fb4.
     */
    const CERTIFICADAS: Record<string, string> = {
      "0059_fee_cumulativa_e_cobertura.sql":   "fb80853e40592de62f83e06d4f90f694e18061aecd1eeff2e6beaec533b2eab9",
      "0060_autorizacao_deriva_do_intent.sql": "f4167fbe28b480769a40045a586ad459232fe8336df0183e488ec49761e3abdc",
      "0061_fingerprint_credential_intent.sql": "6886847c1ce7d1174d5885ac18bce61a4b535f065aca7f9b91e68cd22fc2d3ba",
      "0062_fills_dedupe_por_intent.sql":      "ff4303b8b0277689a74253b3fc858e8d89c8ec07b0925d9a3e5ffd692e304857",
      "0063_cex_conexoes_versionadas.sql":     "ba937249387bb3101e346e5a8d1558b25a28c2c914aef5d6744adbe4bb504d6a",
      "0064_autopilot_projecao_de_posicao.sql": "d0bca6fdc66d09daa4a98b79c017c3273c1b8708cbbd520427e1ebe2a435fba3",
      "0065_autopilot_rearm_preserva_rails.sql": "a316510c2cac7d5d0c042387c67c91ae608029b5f14f8b9b4f01e1eaf5df4a5a",
      "0066_dca_safety_accounting.sql":        "d9702220b053432e64f3053b92daa91cbb51d641b5e237f76d1fbb9152bbbafe",
    };
    for (const [f, h] of Object.entries(CERTIFICADAS)) {
      const atual = createHash("sha256").update(readFileSync(`${DIR}/${f}`)).digest("hex");
      expect(atual, `${f} mudou desde a certificação`).toBe(h);
    }
  });

  it("o teste PostgreSQL real existe e mede privilégio, não visibilidade", () => {
    const t14 = readFileSync("supabase/tests/14_acl_tabelas_financeiras.sql", "utf8");
    expect(t14).toMatch(/has_table_privilege/);
    expect(t14).toMatch(/permission denied for table/);
    expect(t14).toMatch(/truncate/i);
    // e o critério original do T10c continua lá, intocado
    const t02 = readFileSync("supabase/tests/02_acl_rls_substituicao.sql", "utf8");
    expect(t02).toMatch(/has_table_privilege\('anon', 'public\.'\|\|r\.relname, 'SELECT'\)/);
  });
});
