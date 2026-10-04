/**
 * TRAVA DE SÓ LEITURA da exportação da Fase A (strategy truth).
 *
 * Duas camadas, de propósito — nenhuma confia só na outra:
 *   1. ESTÁTICA: o SQL tem de ser UMA consulta SELECT/WITH sem verbo de escrita,
 *      sem função com efeito colateral e sem `SELECT … INTO`. Comentários e
 *      literais são removidos antes de olhar, para "insert" num texto não passar
 *      nem barrar à toa.
 *   2. DO BANCO: a consulta roda dentro de `BEGIN TRANSACTION READ ONLY` e termina
 *      em ROLLBACK. Mesmo que a trava 1 falhe, o Postgres recusa escrita com 25006.
 */
const PROIBIDOS = [
  "insert", "update", "delete", "merge", "upsert", "alter", "create", "drop", "truncate", "grant", "revoke",
  "comment", "copy", "call", "do", "vacuum", "analyze", "cluster", "reindex", "lock", "refresh", "listen",
  "notify", "prepare", "execute", "deallocate", "discard", "reset", "set", "begin", "commit", "rollback",
  "savepoint", "release", "import", "security", "owner",
];
const FUNCOES_PROIBIDAS = [
  "nextval", "setval", "pg_advisory_lock", "pg_advisory_xact_lock", "pg_try_advisory_lock", "dblink", "dblink_exec",
  "lo_import", "lo_export", "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_terminate_backend",
  "pg_cancel_backend", "pg_reload_conf", "set_config", "pg_notify", "txid_current", "pg_sleep",
];

export function limparSql(sql) {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, " '' ")
    .replace(/'(?:[^']|'')*'/g, " '' ")
    .replace(/"(?:[^"]|"")*"/g, " _id_ ");
}

/** Devolve a lista de motivos de recusa; vazia = aceito. */
export function verificarSomenteLeitura(sql) {
  const motivos = [];
  const s = limparSql(String(sql)).toLowerCase().trim().replace(/;\s*$/, "");
  if (!s) return ["SQL vazio"];
  if (s.includes(";")) motivos.push("mais de um comando");
  if (!/^(select|with)\b/.test(s)) motivos.push("não começa com SELECT/WITH");
  for (const p of PROIBIDOS) if (new RegExp(`\\b${p}\\b`).test(s)) motivos.push(`palavra proibida: ${p}`);
  for (const f of FUNCOES_PROIBIDAS) if (new RegExp(`\\b${f}\\s*\\(`).test(s)) motivos.push(`função proibida: ${f}`);
  if (/\binto\b/.test(s)) motivos.push("SELECT … INTO");
  if (/\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/.test(s)) motivos.push("trava de linha (FOR UPDATE/SHARE)");
  return motivos;
}

/** Script psql: transação SÓ LEITURA, timeout, termina em ROLLBACK. */
export function embrulharSomenteLeitura(sql, timeoutS = 120) {
  const motivos = verificarSomenteLeitura(sql);
  if (motivos.length) throw new Error(`SQL recusado: ${motivos.join("; ")}`);
  return [
    "\\set ON_ERROR_STOP 1",
    "begin transaction isolation level repeatable read read only;",
    `set local statement_timeout = '${Math.max(1, Math.floor(timeoutS))}s';`,
    `${String(sql).trim().replace(/;\s*$/, "")};`,
    "rollback;",
    "",
  ].join("\n");
}
