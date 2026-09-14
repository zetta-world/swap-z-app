/**
 * ⚠️⚠️ REVOGAR UM ADMIN CONFIRMAVA SEM TER REVOGADO.
 *
 * Esta rota já carregava a cicatriz escrita — e ela continuava VERDADEIRA:
 *
 *     "o `eq` exigia a caixa exata, então revogar com o endereço digitado em
 *      minúsculo apagava ZERO linhas e devolvia sucesso — o operador via
 *      'revogado' e o acesso continuava de pé."
 *
 * O `ilike` corrigiu o SINTOMA (a caixa) e deixou o MECANISMO. `supabase-js`
 * RESOLVE com `{ error }` e não lança, então um DELETE recusado era
 * indistinguível de um bem-sucedido — e sem `.select()`, um DELETE que casa
 * zero linhas também.
 *
 * ⚠️ É pior que o kill-switch (A25): lá o operador deixava de procurar um
 * problema; aqui ele deixa de procurar uma PESSOA com acesso de admin à
 * plataforma inteira. E `logAdminAction` + `logSecurity` gravavam "revogado"
 * de qualquer jeito — o registro forense mentia junto com a tela.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const ROTA  = semComentarios(readFileSync(join(process.cwd(), "src/app/admin/api/admins/route.ts"), "utf8"));
const PAINEL = semComentarios(readFileSync(join(process.cwd(), "src/components/admin/panels/AdminAccessPanel.tsx"), "utf8"));

describe("① os dois DELETE do revoke são conferidos", () => {
  it("⚠️⚠️ cada um traz `.select()` — sem ele, 'apagou' e 'não achou' voltam idênticos", () => {
    expect(ROTA).toMatch(/from\("platform_admins"\)\.delete\(\)\.ilike\("wallet_address", target\)\.select\(/);
    expect(ROTA).toMatch(/from\("tier_cache"\)\.delete\(\)[\s\S]{0,90}\.select\(/);
  });

  it("⚠️⚠️ e o `error` dos DOIS é lido — falhar em um deixa o acesso de pé", () => {
    // `platform_admins` apagado e `tier_cache` não é revogação PELA METADE, e a
    // metade que sobra ainda autoriza.
    //
    // ⚠️ ESTA TRAVA JÁ TEVE BURACO: ela casava a PRESENÇA de `doLegado.error`,
    // que aparece DUAS vezes na mesma linha (a condição e o `.message`). Trocar
    // a condição por `false` deixava o `.message` no ramo morto e ela passava
    // verde. Agora exige a forma: cada um como CONDIÇÃO do próprio ternário.
    expect(ROTA).toMatch(/doPainel\.error \? `platform_admins: \$\{doPainel\.error\.message/);
    expect(ROTA).toMatch(/doLegado\.error \? `tier_cache: \$\{doLegado\.error\.message/);
    expect(ROTA).toMatch(/if \(falhou\.length\)/);
    expect(ROTA).toMatch(/status: 500/);
  });

  it("⚠️ a resposta diz que o acesso CONTINUA — não só que houve erro", () => {
    expect(ROTA).toMatch(/o acesso de admin CONTINUA DE PÉ/);
  });
});

describe("② a auditoria só é escrita depois da revogação confirmada", () => {
  it("⚠️⚠️ o registro forense não pode mentir junto com a tela", () => {
    const iFalha = ROTA.indexOf("if (falhou.length)");
    const iAudit = ROTA.indexOf('logAdminAction(actor, "admin.revoke"');
    expect(iFalha).toBeGreaterThan(0);
    expect(iAudit).toBeGreaterThan(iFalha);
  });

  it("⚠️ e a falha vira evento de SEGURANÇA alto, não silêncio", () => {
    expect(ROTA).toMatch(/logSecurity\("admin_revoke_falhou"/);
  });

  it("⚠️ a CONCESSÃO também confere antes de auditar", () => {
    const iErro  = ROTA.indexOf("if (erroDaConcessao)");
    const iAudit = ROTA.indexOf('logAdminAction(actor, "admin.grant"');
    expect(iErro).toBeGreaterThan(0);
    expect(iAudit).toBeGreaterThan(iErro);
  });
});

describe("③ zero linhas não é erro — e também não é 'revoguei'", () => {
  it("⚠️ a rota devolve a CONTAGEM, separada por mecanismo", () => {
    // Um segundo clique casa zero linhas e está certo: é idempotência. O que
    // não pode é o painel dizer "revogado" quando nada mudou.
    expect(ROTA).toMatch(/const removidas = \(doPainel\.data\?\.length \?\? 0\) \+ \(doLegado\.data\?\.length \?\? 0\)/);
    expect(ROTA).toMatch(/removidas === 0/);
    expect(ROTA).toMatch(/painel: doPainel\.data\?\.length/);
    expect(ROTA).toMatch(/legado: doLegado\.data\?\.length/);
  });

  it("⚠️⚠️ e a TELA distingue os dois — senão a correção morre no último metro", () => {
    expect(PAINEL).toMatch(/json\.removidas === 0/);
    expect(PAINEL).toMatch(/nada foi removido/);
    // A frase antiga, incondicional, era o defeito do lado da tela.
    expect(PAINEL).not.toMatch(/setMsg\(`✓ admin revogado de \$\{w\.slice\(0, 10\)\}…`\)/);
  });

  it("⚠️ o painel mostra o PORQUÊ, não o código do erro", () => {
    // "nao_revogou" não diz a ninguém o que fazer; a frase do `porque` diz.
    expect([...PAINEL.matchAll(/json\.porque \?\? json\.error/g)]).toHaveLength(2);
  });
});
