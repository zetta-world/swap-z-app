/**
 * ⚠️⚠️ CONCEDER UM PLANO CRIAVA UM ADMIN — achado A04 da auditoria externa
 * (14/09), confirmado no banco.
 *
 * `tier_cache.source` carregava DOIS significados no mesmo valor `'admin'`:
 *
 *   (a) "este plano foi definido por um admin"  ← o que POST /admin/api/tier grava
 *   (b) "esta carteira É um admin"              ← o que requireAdmin LÊ
 *
 * Um clique em "conceder trader" para um cliente entregava a ele o painel
 * inteiro: gates, kill-switches, concessão de tier, mural. Medido: das 4
 * carteiras com `source = 'admin'`, TRÊS não estavam em `platform_admins`.
 *
 * ⚠️ A trava olha a FONTE porque o defeito é a RELAÇÃO entre um escritor e um
 * leitor em arquivos diferentes — nenhum teste unitário de qualquer um dos dois
 * sozinho o pegaria. Foi assim que ele sobreviveu à suíte inteira.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const TIER    = semComentarios(readFileSync("src/app/admin/api/tier/route.ts", "utf8"));
const ADMINS  = semComentarios(readFileSync("src/app/admin/api/admins/route.ts", "utf8"));
const REQUIRE = semComentarios(readFileSync("src/lib/admin/require.ts", "utf8"));
const SELECT  = semComentarios(readFileSync("src/app/api/tier/select/route.ts", "utf8"));

describe("① conceder PLANO não escreve o marcador de ADMIN", () => {
  it("⚠️⚠️ a concessão de tier grava `concessao`, nunca `admin`", () => {
    expect(TIER).toMatch(/source: *"concessao"/);
    expect(TIER).not.toMatch(/source: *"admin"/);
  });

  it("⚠️ e o erro da escrita é lido — concessão que falha não pode dizer ok", () => {
    // O cliente pagou por um plano; "ok" sobre uma escrita que falhou é o
    // defeito que esta base já pagou quatro vezes.
    expect(TIER).toMatch(/const \{ error \} = await db\.from\("tier_cache"\)\.upsert/);
    expect(TIER).toMatch(/error: "nao_consegui_conceder"/);
  });
});

describe("② quem concede ADMIN é outra rota, e outra tabela", () => {
  it("o caminho legítimo escreve em `platform_admins` e não toca em tier_cache", () => {
    expect(ADMINS).toMatch(/db\.from\("platform_admins"\)\.upsert/);
    // A rota de admin NÃO grava tier_cache ao conceder — só ao REVOGAR, para
    // derrubar o legado junto.
    const grant = ADMINS.slice(ADMINS.indexOf('action === "grant"'), ADMINS.indexOf('revoke guards'));
    expect(grant).not.toMatch(/tier_cache.*upsert/);
  });
});

describe("③ a ponte legada continua de pé — e só pode encolher", () => {
  /**
   * ⚠️ NÃO REMOVER SEM DECISÃO HUMANA. `requireAdmin` ainda honra
   * `tier_cache.source = 'admin'` para não trancar fora quem foi semeado antes
   * de `platform_admins` existir — e uma dessas carteiras é a que concedeu
   * admin ao próprio dono. O que mudou é que nada mais ESCREVE esse valor.
   */
  it("⚠️ requireAdmin ainda lê o legado (a ponte), e platform_admins primeiro", () => {
    expect(REQUIRE).toMatch(/platform_admins/);
    expect(REQUIRE).toMatch(/tier_cache[\s\S]{0,200}"admin"/);
    const iPanel  = REQUIRE.indexOf("platform_admins");
    const iLegacy = REQUIRE.indexOf("tier_cache");
    expect(iPanel).toBeLessThan(iLegacy);
  });

  it("⚠️ o auto-seletor de tier segue exigindo `admin` — ele é para admins", () => {
    // Se ele passasse a aceitar `concessao`, qualquer cliente com plano
    // concedido trocaria o próprio tier à vontade.
    expect(SELECT).toMatch(/row\.source !== "admin"/);
    expect(SELECT).not.toMatch(/concessao/);
  });
});
