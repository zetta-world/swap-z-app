/**
 * O PORTÃO DO ADMIN — quem decide, e quem não decide.
 *
 * ⚠️ A CICATRIZ (11/08). O dono não conseguia entrar no próprio painel com a
 * carteira que ele mesmo tinha cadastrado. `platform_admins` continha
 * `0x9f068BDF…48AA`; o painel dizia que a concessão tinha funcionado; e toda
 * requisição levava 404.
 *
 * A causa: o middleware devolvia 404 baseado SÓ em `ADMIN_WALLETS`, com um
 * comentário chamando isso de "pré-triagem". Não era — era um PORTÃO. Quando
 * ele dizia não, o `requireAdmin` nunca rodava, e as outras DUAS origens de
 * permissão que ele aceita (`platform_admins` e o legado
 * `tier_cache.source='admin'`) nunca puderam valer nada.
 *
 * Conceder admin pelo painel era um botão que gravava a linha, mostrava
 * sucesso e não fazia efeito nenhum.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const mw = readFileSync("src/middleware.ts", "utf8");
const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const mwCodigo = semComentarios(mw);

describe("o middleware NÃO decide quem é admin", () => {
  /**
   * ⚠️ A TRAVA CENTRAL. Se `ADMIN_WALLETS` voltar a ser lido aqui, o portão
   * volta e as concessões pelo painel voltam a não valer nada — em silêncio,
   * porque a linha continua sendo gravada com sucesso.
   */
  it("não lê ADMIN_WALLETS", () => {
    expect(mwCodigo).not.toContain("ADMIN_WALLETS");
  });

  it("não tem função de lista de permissão", () => {
    expect(mwCodigo).not.toMatch(/isEnvAdmin|adminWallets|allowlist/i);
  });

  /** O que ele PODE fazer na borda, sem banco: exigir sessão assinada. */
  it("exige sessão válida, e é só isso que ele exige", () => {
    expect(mwCodigo).toContain("jwtVerify");
    expect(mwCodigo).toMatch(/sessaoValida/);
  });

  /** 404 e nunca 403 — a existência do painel não se revela. */
  it("nega com 404, nunca 403", () => {
    expect(mwCodigo).toMatch(/status:\s*404/);
    expect(mwCodigo).not.toMatch(/status:\s*403/);
  });
});

/**
 * ⚠️ O MIDDLEWARE SÓ PODE PARAR DE DECIDIR PORQUE ISTO AQUI É VERDADE.
 *
 * Toda superfície sob `/admin` passa por `requireAdmin` — diretamente, ou pelo
 * layout que a embrulha. Se um arquivo novo escapar, a autorização dele some
 * junto com o portão antigo, e ninguém percebe até alguém entrar.
 */
describe("toda superfície /admin é coberta por requireAdmin", () => {
  function varrer(dir: string, achados: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) { varrer(p, achados); continue; }
      if (/^(route\.ts|page\.tsx|layout\.tsx)$/.test(nome)) achados.push(p);
    }
    return achados;
  }

  const arquivos = varrer("src/app/admin");

  it("existem superfícies admin para conferir (o teste não passa por vazio)", () => {
    expect(arquivos.length).toBeGreaterThan(20);
  });

  it("cada uma chama requireAdmin, ou tem layout ancestral que chama", () => {
    /** Um arquivo é coberto por si mesmo ou por um `layout.tsx` acima dele. */
    const chama = (f: string) => readFileSync(f, "utf8").includes("requireAdmin");
    const layoutsQueChamam = new Set(
      arquivos.filter((f) => f.endsWith("layout.tsx") && chama(f))
              .map((f) => f.replace(/\/layout\.tsx$/, "")),
    );
    const descobertos = arquivos.filter((f) => {
      if (chama(f)) return false;
      let dir = f.slice(0, f.lastIndexOf("/"));
      while (dir.startsWith("src/app/admin")) {
        if (layoutsQueChamam.has(dir)) return false;
        dir = dir.slice(0, dir.lastIndexOf("/"));
      }
      return true;
    });
    expect(
      descobertos,
      "superfície admin sem requireAdmin — o middleware não protege mais isso",
    ).toEqual([]);
  });
});

describe("requireAdmin continua aceitando as TRÊS origens", () => {
  const req = semComentarios(readFileSync("src/lib/admin/require.ts", "utf8"));

  /**
   * ⚠️ AS TRÊS EXISTEM POR MOTIVOS DIFERENTES: o ambiente é o que sobrevive a
   * um banco vazio; `platform_admins` é o que o painel escreve; o `tier_cache`
   * é legado para quem foi cadastrado antes da tabela existir. Perder qualquer
   * uma tranca alguém para fora sem aviso — que foi exatamente o que houve.
   */
  it("ambiente, platform_admins e o legado do tier_cache", () => {
    expect(req).toContain("isEnvAdmin");
    expect(req).toContain("platform_admins");
    expect(req).toMatch(/tier_cache[\s\S]{0,200}"admin"/);
  });

  /** Negar sem registrar perde o único sinal de que alguém tentou. */
  it("e registra a negativa como sinal de intrusão", () => {
    expect(req).toContain("admin_access_denied");
  });
});
