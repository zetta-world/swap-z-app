#!/usr/bin/env node
/**
 * CI: npm audit --json > npm-audit.json || true ; node scripts/release/audit-gate.mjs npm-audit.json
 * Exit 0 = só a cadeia da exceção registrada (hoje R-04; e nada critical/novo). Exit 1 = falha. Exit 2 = uso/leitura.
 * `--gerar-cadeia` imprime a cadeia atual (para REVISÃO humana da exceção; nunca grava sozinho).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { avaliar, cadeiaAtual, advisoriesAltos } from "./lib/audit-gate.mjs";

const arq = process.argv[2];
if (!arq) { console.error("uso: audit-gate.mjs <npm-audit.json> [--gerar-cadeia]"); process.exit(2); }
let audit;
try { audit = JSON.parse(readFileSync(arq, "utf8")); }
catch (e) { console.error(`FALHA: relatório ilegível (${e.message}) — o portão falha fechado`); process.exit(1); }
if (process.argv.includes("--gerar-cadeia")) {
  console.log(JSON.stringify({ advisories: advisoriesAltos(audit), cadeia: cadeiaAtual(audit) }, null, 2));
  process.exit(0);
}
const excecoes = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "audit-exceptions.json"), "utf8"));
const r = avaliar(audit, excecoes);
const m = audit?.metadata?.vulnerabilities ?? {};
console.log(`npm audit: critical=${m.critical ?? "?"} high=${m.high ?? "?"} moderate=${m.moderate ?? "?"} low=${m.low ?? "?"}`);
for (const a of r.avisos) console.log(`AVISO ${a}`);
for (const f of r.falhas) console.log(`FALHA ${f}`);
console.log(r.ok ? `PORTÃO: OK (exceção estreita ${(excecoes.excecoes ?? []).map((e) => e.id).join(", ") || "nenhuma"}; NÃO corrigido)` : "PORTÃO: FALHOU");
process.exit(r.ok ? 0 : 1);
