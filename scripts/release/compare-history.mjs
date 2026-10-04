#!/usr/bin/env node
// Compara dois JSONs de schema_migrations (saída de sql/history-rows.sql, ou {rows:[…]}).
//   node scripts/release/compare-history.mjs atual.json referencia.json [--extras 0059,…,0069]
// Exit 0 = referência íntegra (e extras conferem, se pedidas); 1 = diverge; 2 = uso.
// Saída: só contagens e versões (nunca conteúdo de linha).
import { readFileSync } from "node:fs";
import { comparar, extrasConferem, hashConjunto } from "./lib/history.mjs";

const args = process.argv.slice(2);
const ie = args.indexOf("--extras");
let extras = null;
if (ie >= 0) { extras = (args[ie + 1] ?? "").split(",").filter(Boolean); args.splice(ie, 2); }
if (args.length !== 2) { console.error("uso: compare-history.mjs atual.json referencia.json [--extras v1,v2]"); process.exit(2); }
const ler = (p) => { const d = JSON.parse(readFileSync(p, "utf8")); return Array.isArray(d) ? d : d.rows; };
const atual = ler(args[0]), ref = ler(args[1]);
const r = comparar(atual, ref);
const okExtras = extras === null ? true : extrasConferem(r, extras);
console.log(`referencia=${r.referencia} atual=${r.atual} iguais=${r.iguais} diferentes=[${r.diferentes}] faltando=[${r.faltando}] extras=[${r.extras}]`);
console.log(`hash_atual=${hashConjunto(atual).slice(0, 16)} hash_referencia=${hashConjunto(ref).slice(0, 16)}`);
console.log(`REFERENCIA_INTEGRA=${r.referenciaIntegra} EXTRAS_CONFEREM=${extras === null ? "n/a" : okExtras}`);
process.exit(r.referenciaIntegra && okExtras ? 0 : 1);
