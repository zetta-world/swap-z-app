#!/usr/bin/env node
// Pré-voo do release SEM VALORES: confere se os NOMES de variável exigidos pelo alvo
// estão configurados num ambiente hospedado.
//
//   vercel env ls production | awk 'NR>2 && $1 ~ /^[A-Z][A-Z0-9_]+$/ {print $1}' > nomes.txt
//   node scripts/release/check-env-names.mjs nomes.txt            # escopo release
//   node scripts/release/check-env-names.mjs --escopo public_gate nomes.txt
//
// Entrada: um nome por linha (arquivo ou stdin). Linhas com "=" são RECUSADAS — este
// script nunca deve receber valor. Saída: só nomes. Exit 0 = nada faltando, 1 = falta
// algum, 2 = uso/entrada inválidos. Catálogo: src/lib/release/server-env.catalog.json.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const catalogo = JSON.parse(readFileSync(join(aqui, "../../src/lib/release/server-env.catalog.json"), "utf8"));

const args = process.argv.slice(2);
let escopo = "release";
const i = args.indexOf("--escopo");
if (i >= 0) { escopo = args[i + 1]; args.splice(i, 2); }
if (!["release", "public_gate"].includes(escopo)) { console.error("escopo inválido"); process.exit(2); }

const bruto = args[0] ? readFileSync(args[0], "utf8") : readFileSync(0, "utf8");
const linhas = bruto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
if (linhas.some((l) => l.includes("="))) {
  console.error("entrada recusada: contém '=' (parece VALOR de variável). Passe só nomes.");
  process.exit(2);
}
const nomes = new Set(linhas.filter((l) => /^[A-Z][A-Z0-9_]*$/.test(l)));
const exigidas = catalogo.variaveis.filter((v) => v.escopo === escopo);
const faltando = exigidas.filter((v) => !nomes.has(v.nome));

for (const v of exigidas) console.log(`${nomes.has(v.nome) ? "PRESENTE" : "AUSENTE "} ${v.nome}${v.novaNoAlvo ? "  (nova no alvo)" : ""}`);
console.log(`escopo=${escopo} exigidas=${exigidas.length} ausentes=${faltando.length}`);
process.exit(faltando.length === 0 ? 0 : 1);
