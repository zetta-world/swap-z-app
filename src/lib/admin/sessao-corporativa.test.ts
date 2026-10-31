/**
 * R1 — primitivas da sessão corporativa (desligadas) e o banco amarrado ao código.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  atributosDoCookie, avaliarSessao, formatoDeTokenValido, hashDoToken, hashesIguais, novoTokenDeSessao,
  INATIVIDADE_S, JANELA_STEP_UP_S, type SessaoLida,
} from "./sessao-corporativa";
import { PAPEIS } from "./rbac";

const T0 = Date.parse("2026-10-25T12:00:00Z");
const base: SessaoLida = {
  kind: "corp", state: "active", createdAt: T0, lastSeenAt: T0, absoluteExpiresAt: T0 + 8 * 3600_000,
  idleTimeoutS: INATIVIDADE_S, aal: "aal2", mfaVerifiedAt: T0, stepUpAt: null, revokedAt: null,
};

describe("token e cookie", () => {
  it("token opaco com formato fixo; o banco guarda só o hash de 32 bytes", () => {
    const t = novoTokenDeSessao();
    expect(formatoDeTokenValido(t)).toBe(true);
    expect(novoTokenDeSessao()).not.toBe(t);
    expect(hashDoToken(t)).toHaveLength(32);
    expect(hashesIguais(hashDoToken(t), hashDoToken(t))).toBe(true);
    expect(hashesIguais(hashDoToken(t), hashDoToken(t + "x"))).toBe(false);
    for (const lixo of ["", "za1_", "za1_" + "a".repeat(42), "zb1_" + "a".repeat(43), null, 42]) {
      expect(formatoDeTokenValido(lixo)).toBe(false);
    }
  });

  it("cookie __Host-: Secure, HttpOnly, SameSite=Strict, Path=/, sem Domain", () => {
    const c = atributosDoCookie();
    expect(c).toMatchObject({ name: "__Host-zswap_admin", httpOnly: true, secure: true, sameSite: "strict", path: "/" });
    expect(c).not.toHaveProperty("domain");
  });
});

describe("avaliarSessao — fail-closed", () => {
  it("válida dentro das janelas", () => {
    expect(avaliarSessao(base, T0 + 60_000)).toEqual({ ok: true, precisaStepUp: false });
  });
  it("revogada, expirada, inativa, MFA pendente e corp sem aal2 → inválida", () => {
    expect(avaliarSessao({ ...base, revokedAt: T0 }, T0 + 1)).toMatchObject({ motivo: "revogada" });
    expect(avaliarSessao(base, base.absoluteExpiresAt)).toMatchObject({ motivo: "expirada" });
    expect(avaliarSessao(base, T0 + (INATIVIDADE_S + 1) * 1000)).toMatchObject({ motivo: "inativa" });
    expect(avaliarSessao({ ...base, state: "mfa_pending" }, T0 + 1)).toMatchObject({ motivo: "mfa_pendente" });
    expect(avaliarSessao({ ...base, aal: "aal1" }, T0 + 1)).toMatchObject({ motivo: "sem_mfa" });
    expect(avaliarSessao({ ...base, createdAt: NaN }, T0)).toMatchObject({ motivo: "relogio_invalido" });
  });
  it("step-up: exigido e vencido → precisaStepUp; recente → não", () => {
    expect(avaliarSessao(base, T0 + 1000, true)).toEqual({ ok: true, precisaStepUp: true });
    expect(avaliarSessao({ ...base, stepUpAt: T0 }, T0 + 1000, true)).toEqual({ ok: true, precisaStepUp: false });
    expect(avaliarSessao({ ...base, stepUpAt: T0 }, T0 + (JANELA_STEP_UP_S + 1) * 1000, true)).toEqual({ ok: true, precisaStepUp: true });
  });
});

describe("0083 amarrada ao código", () => {
  const sql = readFileSync("supabase/migrations/0083_admin_private_identidade_rbac.sql", "utf8");
  it("CHECK de role no banco = PAPEIS de rbac.ts", () => {
    const m = sql.match(/role\s+text not null check \(role in \(([^)]+)\)\)/);
    expect(m).not.toBeNull();
    const doBanco = m![1].split(",").map((x) => x.trim().replace(/'/g, "")).sort();
    expect(doBanco).toEqual([...PAPEIS].sort());
  });
  it("token_hash tem 32 bytes no banco, igual ao hashDoToken", () => {
    expect(sql).toMatch(/token_hash\s+bytea not null unique check \(length\(token_hash\) = 32\)/);
  });
  it("nenhum código lê admin_private ainda (R1 desligado de verdade)", async () => {
    const { execSync } = await import("node:child_process");
    const achados = execSync("grep -rln \"admin_private\" src --include=*.ts --include=*.tsx || true", { encoding: "utf8" })
      .split("\n").filter((l) => l && !l.endsWith(".test.ts"));
    expect(achados).toEqual([]);
  });
});
