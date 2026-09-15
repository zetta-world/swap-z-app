/**
 * ⚠️⚠️ O CONTADOR DE 24h DO PAINEL DE SEGURANÇA SAÍA DA CONSULTA ERRADA.
 * Achado A28 da auditoria externa.
 *
 * O `Promise.all` da rota carregava QUATRO consultas e a desestruturação pegava
 * DUAS. Os elementos 0 e 1 eram a MESMA consulta (`limit(60)`), e as duas de 24h,
 * nos índices 2 e 3, rodavam e eram DESCARTADAS:
 *
 *     const [{ data: recent }, { data: rows24h }] = await Promise.all([
 *       db…limit(60),    db…limit(60),          ← 0 e 1: duplicata
 *       db…gte(ago24h),  db…gte(ago24h),        ← 2 e 3: descartadas
 *     ]);
 *
 * Resultado: `errors24h`, `security24h`, `high24h` e `topKinds` saíam dos 60
 * eventos mais recentes DE TODOS OS TEMPOS.
 *
 *   · num dia calmo o painel INFLAVA — contava erros de semanas atrás como se
 *     fossem de hoje;
 *   · num dia movimentado ele TRAVAVA em 60, escondendo o volume real bem
 *     quando ele importa.
 *
 * O rótulo dizia "24h" e o número vinha de outro lugar — no painel que existe
 * para ver abuso e tentativa de invasão.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const bruto = readFileSync(join(process.cwd(), "src/app/admin/api/logs/route.ts"), "utf8");
const semComentarios = bruto
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ");

/** O corpo do `Promise.all`, sem comentários — foi comentário que enganou a
 *  minha primeira varredura desta classe. */
function corpoDoPromiseAll(): string {
  const i = semComentarios.indexOf("await Promise.all([");
  expect(i, "Promise.all sumiu da rota — atualize esta trava").toBeGreaterThan(0);
  let prof = 1, j = i + "await Promise.all([".length;
  while (j < semComentarios.length && prof > 0) {
    if (semComentarios[j] === "[") prof++;
    else if (semComentarios[j] === "]") prof--;
    j++;
  }
  return semComentarios.slice(i, j);
}

describe("① uma consulta por propósito, sem duplicata", () => {
  it("⚠️⚠️ o `Promise.all` tem exatamente DUAS consultas", () => {
    const corpo = corpoDoPromiseAll();
    const consultas = [...corpo.matchAll(/db\.from\("platform_events"\)/g)].length;
    expect(consultas, "quatro consultas para duas variáveis era o defeito").toBe(2);
  });

  it("⚠️⚠️ uma `limit(60)` e uma `gte(ago24h)` — não duas de cada", () => {
    const corpo = corpoDoPromiseAll();
    expect([...corpo.matchAll(/\.limit\(60\)/g)]).toHaveLength(1);
    expect([...corpo.matchAll(/\.gte\("created_at", ago24h\)/g)]).toHaveLength(1);
  });

  it("⚠️⚠️ e a de 24h vem DEPOIS da de 60 — é ela que alimenta `rows24h`", () => {
    // A ordem é o que liga cada consulta à sua variável. Invertê-la devolve o
    // defeito sem mudar mais nada.
    const corpo = corpoDoPromiseAll();
    expect(corpo.indexOf(".limit(60)")).toBeLessThan(corpo.indexOf('gte("created_at", ago24h)'));
    expect(semComentarios).toMatch(/const \[\{ data: recent \}, \{ data: rows24h \}\]/);
  });
});

describe("② os contadores leem a janela de 24h", () => {
  it("⚠️ `errors24h`, `security24h` e `high24h` iteram `rows24h`", () => {
    expect(semComentarios).toMatch(/for \(const r of \(rows24h \?\? \[\]\) as Row\[\]\)/);
    for (const c of ["errors24h", "security24h", "high24h"]) {
      expect(semComentarios, c).toContain(c);
    }
  });

  it("⚠️ e a tela recebe os 60 recentes por `recent`, separado", () => {
    expect(semComentarios).toMatch(/recent: \(recent \?\? \[\]\) as Row\[\]/);
  });

  it("⚠️ o teto da consulta de 24h é EXPLÍCITO, não o corte mudo do PostgREST", () => {
    // Sem `.limit()`, o PostgREST corta em 1.000 sem avisar — o mesmo defeito
    // que `paginate.ts` existe para impedir. Aqui o teto é uma decisão dita.
    const corpo = corpoDoPromiseAll();
    expect(corpo).toMatch(/\.gte\("created_at", ago24h\)\s*\.limit\(1000\)/);
  });
});
