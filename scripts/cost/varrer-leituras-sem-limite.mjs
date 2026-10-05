#!/usr/bin/env node
/**
 * CE-12 — varredura ESTÁTICA de leituras PostgREST sem teto explícito.
 *
 * O PostgREST corta toda resposta em `db-max-rows` (1000 no hospedado). Uma
 * leitura que pode passar disso e não pagina devolve uma fatia silenciosa — foi
 * o defeito de `mercado/store.lerDoBanco` (CE-11) e de `consumoDaJanela` (CE-04).
 *
 * Heurística (não substitui leitura humana): para cada `.select(` fora de teste,
 * junta a instrução até o `;` e procura `.limit(`, `.range(`, `.single(`,
 * `.maybeSingle(` ou `head: true`. Sem nenhum → candidato. A triagem (tabela,
 * cardinalidade possível, se decide algo) é manual e vai para o relatório.
 *
 * Uso: node scripts/cost/varrer-leituras-sem-limite.mjs [--json]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function arquivos(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules" && n !== "__referencia__") arquivos(p, out); }
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

const achados = [];
for (const f of arquivos("src")) {
  const s = readFileSync(f, "utf8");
  const re = /\.select\(/g;
  let m;
  while ((m = re.exec(s))) {
    // a instrução: volta até o `await`/`=`/`return` mais próximo e vai até o `;`
    const ini = Math.max(s.lastIndexOf(";", m.index), s.lastIndexOf("{", m.index), s.lastIndexOf("}", m.index)) + 1;
    let fim = s.indexOf(";", m.index);
    if (fim < 0) fim = s.length;
    const inst = s.slice(ini, fim);
    if (/\.(insert|upsert|update|delete)\(/.test(inst)) continue;          // select de retorno de escrita
    if (/\.limit\(|\.range\(|\.single\(|\.maybeSingle\(|head:\s*true/.test(inst)) continue;
    const tabela = (inst.match(/\.from\(\s*["'`]([a-z_0-9]+)["'`]/) || [])[1] ?? "(variável/helper)";
    const linha = s.slice(0, m.index).split("\n").length;
    achados.push({ arquivo: f, linha, tabela });
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(achados, null, 2));
} else {
  const porTabela = new Map();
  for (const a of achados) porTabela.set(a.tabela, [...(porTabela.get(a.tabela) ?? []), `${a.arquivo}:${a.linha}`]);
  console.log(`leituras sem teto explícito: ${achados.length} em ${porTabela.size} tabelas`);
  for (const [t, locais] of [...porTabela].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${t} (${locais.length})`);
    for (const l of locais) console.log(`  ${l}`);
  }
}
