/**
 * ⚠️⚠️ A SAÍDA POR LIQUIDAÇÃO EXISTIA EM PRODUÇÃO E NÃO NO REPOSITÓRIO —
 * achado A05 da auditoria externa.
 *
 * Em 23/08 a restrição de `celeiro_posicoes.motivo_saida` foi ampliada DIRETO
 * no banco, para aceitar `liquidacao`. O arquivo nunca entrou aqui.
 *
 * Medido em 15/09, comparando `supabase_migrations.schema_migrations` com
 * `supabase/migrations/`:
 *
 *     produção   CHECK (motivo_saida = ANY (ARRAY['alvo','stop','tempo','liquidacao']))
 *     repo       0028_celeiro_posicoes.sql:35 → check (... in ('alvo','stop','tempo'))
 *
 * ⚠️ NÃO É COSMÉTICO. `deveFechar` devolve `motivo: "liquidacao"` quando o preço
 * toca o nível de liquidação do agente alavancado. Um banco reconstruído a
 * partir deste repositório RECUSARIA a escrita — 23514 — no fechamento de uma
 * posição alavancada, que é caminho de dinheiro. Em produção não dói porque
 * produção tem a restrição larga: o estrago aparece em ambiente novo, que é
 * exatamente onde ninguém estaria olhando.
 *
 * ⚠️ E A TRAVA NÃO É SOBRE ESTE MOTIVO. Ela amarra a união `MotivoDeSaida` à
 * restrição vigente: acrescentar um motivo no TypeScript sem acrescentar no SQL
 * passa a quebrar o teste, em vez de quebrar a escrita meses depois.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const DIR = "supabase/migrations";

/** Os motivos declarados na união `MotivoDeSaida`, lidos do fonte. */
function motivosDoTypeScript(): string[] {
  const fonte = readFileSync("src/lib/celeiro/posicao.ts", "utf8");
  const m = fonte.match(/export type MotivoDeSaida\s*=\s*([^;]+);/);
  if (!m) throw new Error("não achei a união MotivoDeSaida em posicao.ts");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/**
 * A ÚLTIMA restrição de `motivo_saida` declarada nas migrations.
 *
 * ⚠️ A ÚLTIMA, não a primeira: 0028 cria a estreita e 0049 a substitui. Ler a
 * primeira acusaria o repositório correto de estar errado — e ordem de arquivo
 * é o que decide num diretório de migrations.
 */
function restricaoVigente(): string {
  const arquivos = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  let ultima = "";
  for (const f of arquivos) {
    const sql = readFileSync(`${DIR}/${f}`, "utf8").replace(/^\s*--.*$/gm, " ");
    // `check (motivo_saida ...)` até o fecha-parênteses da lista.
    for (const m of sql.matchAll(/motivo_saida[\s\S]{0,60}?(?:in|=\s*any)\s*\(([\s\S]{0,300}?)\)\s*\)/gi)) {
      ultima = m[1];
    }
  }
  if (!ultima) throw new Error("nenhuma restrição de motivo_saida nas migrations");
  return ultima;
}

/**
 * ⚠️ O CAMINHO QUE PRODUZ `liquidacao` NÃO É TESTADO AQUI DE PROPÓSITO.
 * `posicao.test.ts` já o cobre em três casos, incluindo o par que importa (stop
 * mais perto ganha da liquidação). Repetir aqui seria um teste a mais para
 * manter e nenhuma pergunta a mais respondida — esta trava é sobre ESQUEMA.
 */
describe("o motivo que o código grava existe no esquema do repositório", () => {
  it("⚠️⚠️ `liquidacao` está na restrição — sem isso o banco novo recusa 23514", () => {
    expect(restricaoVigente()).toContain("liquidacao");
  });

  it("⚠️ e TODO motivo da união está lá, não só o que a auditoria achou", () => {
    const vigente = restricaoVigente();
    for (const motivo of motivosDoTypeScript()) {
      expect(vigente, `motivo "${motivo}" não está na restrição`).toContain(`'${motivo}'`);
    }
  });

  it("⚠️ o gêmeo: um motivo inventado NÃO está — a trava não aceita qualquer coisa", () => {
    // Sem isto, uma restrição que contivesse a tabela inteira passaria igual.
    expect(restricaoVigente()).not.toContain("pentelho");
  });

  it("a união tem os quatro motivos, e `liquidacao` é um deles", () => {
    expect(motivosDoTypeScript().sort())
      .toEqual(["alvo", "liquidacao", "stop", "tempo"]);
  });
});
