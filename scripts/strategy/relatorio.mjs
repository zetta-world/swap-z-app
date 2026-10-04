#!/usr/bin/env node
/**
 * Relatório da Fase A a partir de uma exportação (arquivo). Não toca banco.
 *   node scripts/strategy/relatorio.mjs <exportacao.json> [--eventos <eventos.json>] --out <prefixo>
 * Requer Node ≥ 22.18/24 (strip-types) para carregar o motor .ts sem build.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { reconciliar, relatorioMarkdown } from "../../src/lib/strategy-truth/reconciliacao.ts";

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const entrada = process.argv[2];
const out = arg("--out");
if (!entrada || !out) { console.error("uso: relatorio.mjs <exportacao.json> [--eventos <arquivo>] --out <prefixo>"); process.exit(64); }
const exp = JSON.parse(readFileSync(entrada, "utf8"));
const ev = arg("--eventos");
if (ev) exp.eventos_conhecidos = JSON.parse(readFileSync(ev, "utf8"));
const rel = reconciliar(exp);
writeFileSync(`${out}.json`, JSON.stringify(rel, null, 1));
writeFileSync(`${out}.md`, relatorioMarkdown(rel));
console.log(Object.entries(rel.resumo).map(([k, v]) => `${k}=${v}`).join(" "));
