/**
 * ⚠️⚠️ UM `try/catch` EM VOLTA DE ESCRITA DO SUPABASE — A INVARIANTE Nº 1 DESTA
 * CASA AO CONTRÁRIO.
 *
 * `supabase-js` NÃO LANÇA em erro de banco: ele RESOLVE com `{ error }`. O
 * `catch { continue; }` do fecho de posição foi escrito para tornar o laço
 * resistente e nunca executou uma vez.
 *
 * O estrago é de DUPLA CONTAGEM: com o UPDATE recusado, a execução caía direto
 * no acumulador e a conta era CREDITADA pelo P&L enquanto a posição continuava
 * `open`. Na passada seguinte a mesma posição é encontrada, fechada (ou falha)
 * de novo, e creditada DE NOVO — `realized_pnl_usd` e `wins` crescendo sem teto
 * sobre uma única saída.
 *
 * ⚠️ E é o flywheel que lê esses números. Expectancy inflada por contagem dupla
 * é pior que expectancy ausente: ela decide ESCALA.
 *
 * ⚠️ O QUE O BANCO NÃO PROVA. Medi a divergência entre `realized_pnl_usd` e a
 * soma das posições fechadas: ela existe e é grande, mas é EXPLICADA por
 * `reset.ts` e `recapitalize.ts`, que zeram `realized_pnl_usd`, `wins` e
 * `losses` deixando as posições fechadas onde estão. Não serve de evidência, e
 * um UPDATE recusado não deixa rastro nenhum. O defeito é real na leitura do
 * código; o banco não confirma nem nega.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const bruto = readFileSync(join(process.cwd(), "src/lib/paper/engine.ts"), "utf8");
const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const ENGINE = semComentarios(bruto);

describe("① nenhuma escrita do livro fica dentro de try/catch", () => {
  it("⚠️⚠️ o fecho da posição lê o `error` — o `catch` nunca pegou nada", () => {
    expect(ENGINE).toMatch(/const \{ error: erroDoFecho \} = await db\.from\("paper_positions"\)\.update\(/);
    expect(ENGINE).toMatch(/if \(erroDoFecho\)/);
  });

  it("⚠️⚠️ e `continue` ANTES de creditar — senão credita saída que não gravou", () => {
    const i = ENGINE.indexOf("if (erroDoFecho)");
    const j = ENGINE.indexOf("const d = delta.get(p.account_id)");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(ENGINE.slice(i, j)).toMatch(/continue;/);
  });

  it("⚠️ não sobrou `try` em volta de escrita de posição ou de conta", () => {
    // Um `try` aqui é sempre engano: o cliente resolve, não lança.
    expect(ENGINE).not.toMatch(/try \{\s*await db\.from\("paper_(positions|accounts)"\)/);
  });
});

describe("② as duas mexidas no caixa são conferidas", () => {
  it("⚠️⚠️ o CRÉDITO do fecho — as posições já estão closed, ninguém tenta de novo", () => {
    expect(ENGINE).toMatch(/const \{ error: erroDoCredito \} = await db\.from\("paper_accounts"\)\.update\(/);
    expect(ENGINE).toMatch(/if \(erroDoCredito\)/);
  });

  it("⚠️⚠️ o DÉBITO da abertura — a última linha da derivação estava solta", () => {
    // O `.select()` logo acima existe para o caixa não divergir das posições. A
    // gravação da derivação não era conferida: mesma divergência, porta seguinte.
    expect(ENGINE).toMatch(/const \{ error: erroDoDebito \} = await db\.from\("paper_accounts"\)/);
    expect(ENGINE).toMatch(/if \(erroDoDebito\)/);
  });
});

describe("③ e cada falha carrega a CONSEQUÊNCIA, não só o erro", () => {
  it("o fecho diz por que NÃO credita", () => {
    expect(bruto).toMatch(/creditar aqui seria contar a mesma saida duas vezes/);
    expect(ENGINE).toMatch(/paper_fecho_nao_gravado/);
  });

  it("o crédito diz que o P&L some do livro para sempre", () => {
    expect(bruto).toMatch(/a expectancy desta mesa fica menor que a real/);
    expect(ENGINE).toMatch(/paper_credito_nao_gravado/);
  });

  it("o débito diz que a conta vai abrir posição com dinheiro que não tem", () => {
    expect(bruto).toMatch(/acredita\s+\*?\s*\*?\s*ter mais capital do que tem|ter mais capital do que tem/);
    expect(ENGINE).toMatch(/paper_debito_nao_gravado/);
  });
});
