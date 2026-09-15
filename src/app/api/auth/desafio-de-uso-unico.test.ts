/**
 * ⚠️⚠️ O DESAFIO DE AUTENTICAÇÃO ERA REUTILIZÁVEL — achado A01.
 *
 * Eram três passos: SELECT, verifica, DELETE. Dois pedidos concorrentes com a
 * MESMA assinatura liam os dois a mesma linha, verificavam os dois com sucesso,
 * e saíam os dois com sessão.
 *
 * O comentário do arquivo dizia "Single-use regardless of outcome — burn the
 * nonce so failed attempts can't be brute-forced and successes can't be
 * replayed". A intenção estava certa; o passo que a garantia vinha DEPOIS da
 * decisão.
 *
 * ⚠️ E ERA PIOR PELO OUTRO LADO: o `error` do DELETE era jogado fora.
 * `supabase-js` RESOLVE com `{ error }` e não lança, então um DELETE recusado
 * deixava o nonce DE PÉ — reutilizável até expirar. Uso único que depende de uma
 * escrita nunca conferida não é uso único.
 *
 * ⚠️ A atomicidade foi PROVADA contra o banco real, não só lida:
 *
 *     duas consumações concorrentes da mesma linha → a_levou=1, b_levou=0
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const BRUTO = readFileSync(join(process.cwd(), "src/app/api/auth/verify/route.ts"), "utf8");
const ROTA  = semComentarios(BRUTO);

describe("① consumir é o DELETE, não o SELECT", () => {
  it("⚠️⚠️ `DELETE … RETURNING` — o Postgres serializa e só um leva a linha", () => {
    expect(ROTA).toMatch(
      /const \{ data: consumidas, error: erroDoConsumo \} = await db\s*\.from\("auth_nonces"\)\s*\.delete\(\)\s*\.eq\("wallet_address", address\)\s*\.select\("nonce, issued_at, expires_at"\)/,
    );
  });

  it("⚠️⚠️ e NÃO existe mais um SELECT do nonce — era ele que permitia dois leitores", () => {
    expect(ROTA).not.toMatch(/\.from\("auth_nonces"\)\s*\.select\(/);
    expect(ROTA).not.toMatch(/maybeSingle\(\)/);
  });

  it("⚠️⚠️ o consumo acontece ANTES da verificação da assinatura", () => {
    // Verificar antes de consumir é o que deixava a janela aberta.
    const iConsumo = ROTA.indexOf("const { data: consumidas");
    // ⚠️ A CHAMADA, não o import: `verifyEvmSignature` aparece primeiro no topo
    // do arquivo, e casar aquilo mediria a ordem errada.
    const iVerifica = ROTA.indexOf("await verifyEvmSignature({");
    expect(iConsumo).toBeGreaterThan(0);
    expect(iVerifica, "chamada de verifyEvmSignature não encontrada").toBeGreaterThan(0);
    expect(iVerifica).toBeGreaterThan(iConsumo);
  });

  it("⚠️ e o nonce verificado vem do que o DELETE devolveu", () => {
    expect(ROTA).toMatch(/const nonceRow = consumidas\?\.\[0\]/);
    expect(ROTA).toMatch(/nonce: nonceRow\.nonce/);
  });
});

describe("② o consumo recusado falha FECHADO", () => {
  it("⚠️⚠️ erro no DELETE não concede sessão — 503, não seguir em frente", () => {
    expect(ROTA).toMatch(/if \(erroDaEscrita\)|if \(erroDoConsumo\)/);
    const i = ROTA.indexOf("if (erroDoConsumo)");
    expect(i).toBeGreaterThan(0);
    expect(ROTA.slice(i, i + 220)).toMatch(/error: "auth_unavailable" \}, 503\)/);
  });

  it("⚠️⚠️ e o 503 vem ANTES de qualquer verificação de assinatura", () => {
    const iErro = ROTA.indexOf("if (erroDoConsumo)");
    const iVerifica = ROTA.indexOf("await verifyEvmSignature({");
    expect(iErro).toBeGreaterThan(0);
    expect(iVerifica).toBeGreaterThan(iErro);
  });

  it("⚠️ não sobrou DELETE solto do nonce — era o que sumia calado", () => {
    // `await db.from("auth_nonces").delete()…` sem ler o retorno era o defeito.
    expect(ROTA).not.toMatch(/await db\.from\("auth_nonces"\)\.delete\(\)/);
  });
});

describe("③ uso único continua valendo em todos os desfechos", () => {
  it("assinatura ERRADA também gasta o desafio — senão dá para forçar bruta", () => {
    // O consumo é incondicional e acontece antes do `if (!ok)`.
    const iConsumo = ROTA.indexOf("const { data: consumidas");
    const iFalha = ROTA.indexOf('error: "bad_signature"');
    expect(iFalha).toBeGreaterThan(iConsumo);
  });

  it("desafio VENCIDO não precisa de segundo DELETE — já foi consumido", () => {
    const i = ROTA.indexOf('error: "challenge_expired"');
    expect(i).toBeGreaterThan(0);
    const antes = ROTA.slice(Math.max(0, i - 300), i);
    expect(antes).not.toMatch(/\.delete\(\)/);
  });

  it("⚠️ a razão do uso único segue escrita, para o próximo leitor", () => {
    expect(BRUTO).toMatch(/Uso .nico que depende de uma escrita nunca conferida n.o . uso/);
  });
});
