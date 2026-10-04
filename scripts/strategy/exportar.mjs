#!/usr/bin/env node
/**
 * Exporta, SÓ LENDO, o que a Fase A precisa. Uso:
 *   STRATEGY_PSQL="docker exec -i <container> psql -X -U <user> -d postgres" \
 *     node scripts/strategy/exportar.mjs --alvo descartavel --fonte <rótulo> --out <arquivo.json>
 *
 * `--alvo hospedado` exige `--dono-autorizou`: ler o Supabase hospedado é ação do dono
 * (CLAUDE.md §8). O comando psql vem do ambiente; credencial nunca entra em argumento
 * nem no arquivo de saída (só o rótulo `--fonte`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { embrulharSomenteLeitura } from "./somente-leitura.mjs";

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const alvo = arg("--alvo");
const fonte = arg("--fonte");
const out = arg("--out");
const sqlPath = arg("--sql", join(dirname(fileURLToPath(import.meta.url)), "sql", "exportar.sql"));
if (!["descartavel", "hospedado"].includes(alvo) || !fonte || !out) {
  console.error("uso: --alvo descartavel|hospedado --fonte <rótulo> --out <arquivo> [--sql <arquivo>]"); process.exit(64);
}
if (alvo === "hospedado" && !process.argv.includes("--dono-autorizou")) {
  console.error("RECUSADO: leitura do banco hospedado exige autorização explícita do dono (--dono-autorizou)."); process.exit(77);
}
if (/(postgres(ql)?:\/\/[^\s]*:[^\s@]*@)|password=/i.test(fonte)) { console.error("RECUSADO: --fonte parece conter credencial"); process.exit(65); }
const cmd = process.env.STRATEGY_PSQL;
if (!cmd) { console.error("defina STRATEGY_PSQL (comando psql, sem senha no texto)"); process.exit(64); }
if (/password=|:\/\/[^\s]*:[^\s@]+@/i.test(cmd)) { console.error("RECUSADO: STRATEGY_PSQL contém senha; use PGPASSWORD/.pgpass"); process.exit(65); }

let script;
try { script = embrulharSomenteLeitura(readFileSync(sqlPath, "utf8")); }
catch (e) { console.error(`RECUSADO: ${e.message}`); process.exit(65); }
const [bin, ...args] = cmd.split(/\s+/).filter(Boolean);
const r = spawnSync(bin, [...args, "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1"], { input: script, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
if (r.status !== 0) { console.error(r.stderr.trim()); process.exit(r.status || 1); }
const dados = JSON.parse(r.stdout.trim());
writeFileSync(out, JSON.stringify({ capturado_em: new Date().toISOString(), fonte, ...dados }, null, 1));
console.log(`ok: ${out} (${Object.entries(dados).map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : "?"}`).join(" ")})`);
