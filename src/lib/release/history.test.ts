import { describe, it, expect } from "vitest";
import { canonica, comparar, extrasConferem, hashConjunto } from "../../../scripts/release/lib/history.mjs";

const EMAIL = "pessoa@example.com";
const base = [
  { version: "0001", name: "auth", statements: ["create table a();"], created_by: null, idempotency_key: null, rollback: null },
  { version: "20260916101528", name: "0057_x", statements: ["select 1;"], created_by: EMAIL, idempotency_key: null, rollback: null },
];

describe("comparador de schema_migrations (scripts/release/lib/history.mjs)", () => {
  it("idêntico: referência íntegra, sem extras", () => {
    const r = comparar(base, base);
    expect(r).toMatchObject({ iguais: 2, diferentes: [], faltando: [], extras: [], referenciaIntegra: true });
  });

  it("compara por versão, não por posição (versões 00xx ordenam antes de timestamps)", () => {
    const alvo = [{ version: "0059", name: "nova", statements: [], created_by: null, idempotency_key: null, rollback: null }, ...base];
    const r = comparar(alvo, base);
    expect(r.referenciaIntegra).toBe(true);
    expect(r.extras).toEqual(["0059"]);
    expect(extrasConferem(r, ["0059"])).toBe(true);
    expect(extrasConferem(r, ["0059", "0060"])).toBe(false);
  });

  it("conteúdo diferente numa linha da referência é detectado", () => {
    const mexida = [base[0], { ...base[1], statements: ["select 2;"] }];
    const r = comparar(mexida, base);
    expect(r.referenciaIntegra).toBe(false);
    expect(r.diferentes).toEqual(["20260916101528"]);
  });

  it("linha da referência ausente é detectada", () => {
    expect(comparar([base[0]], base).faltando).toEqual(["20260916101528"]);
  });

  it("nunca expõe created_by (pode ser email) nem SQL", () => {
    const saida = JSON.stringify([canonica(base[1]), comparar(base, base), hashConjunto(base)]);
    expect(saida).not.toContain(EMAIL);
    expect(saida).not.toContain("select 1");
  });

  it("hash do conjunto independe da ordem de entrada", () => {
    expect(hashConjunto([base[1], base[0]])).toBe(hashConjunto(base));
  });
});
