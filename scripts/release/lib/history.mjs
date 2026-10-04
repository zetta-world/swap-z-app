// Comparação de supabase_migrations.schema_migrations — pura, sem I/O. Testada em
// src/lib/release/history.test.ts. Nunca devolve conteúdo de linha (created_by pode ser email).
import { createHash } from "node:crypto";

const md5 = (s) => createHash("md5").update(s).digest("hex");
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** Linha canônica: versão + hashes dos campos. Nenhum valor bruto sai daqui. */
export function canonica(r) {
  const arr = (a) => (a == null ? "<null>" : a.join("\n"));
  return {
    version: String(r.version),
    name: r.name ?? null,
    statements_md5: md5(arr(r.statements)),
    rollback_md5: md5(arr(r.rollback)),
    created_by_present: r.created_by != null,
    idempotency_key_present: r.idempotency_key != null,
  };
}

/** Hash canônico de um conjunto de linhas (ordem por versão, texto). */
export function hashConjunto(rows) {
  const c = rows.map(canonica).sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
  return sha256(c.map((x) => JSON.stringify(x)).join("\n"));
}

/**
 * Compara `atual` com `referencia`: toda linha da referência tem de existir (por versão)
 * e ser igual; as extras são listadas por versão. Devolve só versões e contagens.
 */
export function comparar(atual, referencia) {
  const porVersao = new Map(atual.map((r) => [String(r.version), canonica(r)]));
  const iguais = [], diferentes = [], faltando = [];
  for (const r of referencia) {
    const v = String(r.version), a = porVersao.get(v);
    if (!a) { faltando.push(v); continue; }
    (JSON.stringify(a) === JSON.stringify(canonica(r)) ? iguais : diferentes).push(v);
  }
  const ref = new Set(referencia.map((r) => String(r.version)));
  const extras = [...porVersao.keys()].filter((v) => !ref.has(v)).sort();
  return {
    referencia: referencia.length, atual: atual.length, iguais: iguais.length,
    diferentes, faltando, extras,
    referenciaIntegra: diferentes.length === 0 && faltando.length === 0,
  };
}

/** Extras esperadas exatamente? (ex.: alvo = referência + 0059…0069) */
export function extrasConferem(resultado, esperadas) {
  const a = [...resultado.extras].sort(), b = [...esperadas].map(String).sort();
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
