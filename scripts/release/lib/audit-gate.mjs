/**
 * PORTÃO ESTREITO DO `npm audit` — R-03 (decisão do dono, 04/10/2026:
 * R03_DECISION=TEMPORARY_NARROW_CI_EXCEPTION). Ver docs/R03-AUDIT-EXCEPTION.md.
 *
 * NÃO é "audit desligado". Regras, todas FALHA FECHADA:
 *   1. CRITICAL em qualquer pacote ou advisory → falha (a exceção nunca cobre critical);
 *   2. qualquer advisory HIGH que não seja exatamente o registrado (source + nome + faixa + severidade) → falha;
 *   3. a CADEIA de pacotes high/critical tem de ser IDÊNTICA à registrada (nomes, nós no node_modules, vias,
 *      isDirect). Pacote novo na cadeia, caminho novo até `braces` ou pacote que saiu → falha (deriva);
 *   4. arquivo de exceção sem `status: "TEMPORARIA"` / `revisar_antes_do_rc: true` / decisão → falha;
 *   5. relatório ilegível ou fora do formato v2 → falha.
 * Moderate/low seguem fora do portão (mesmo nível de antes: --audit-level=high).
 * A vulnerabilidade NÃO está corrigida; a saída diz isso toda vez.
 */

const ALTAS = new Set(["high", "critical"]);

/** Forma canônica de um item da cadeia (sem `range` de pacote: muda com a base de advisories, não com o lock). */
export function itemDaCadeia(v) {
  return {
    name: v.name,
    severity: v.severity,
    isDirect: Boolean(v.isDirect),
    nodes: [...(v.nodes ?? [])].sort(),
    via: (v.via ?? []).map((x) => (typeof x === "string" ? x : `advisory:${x.source}`)).sort(),
  };
}

export function cadeiaAtual(audit) {
  return Object.values(audit.vulnerabilities ?? {})
    .filter((v) => ALTAS.has(v.severity))
    .map(itemDaCadeia)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function advisoriesAltos(audit) {
  const out = new Map();
  for (const v of Object.values(audit.vulnerabilities ?? {})) {
    for (const x of v.via ?? []) {
      if (typeof x === "object" && x && ALTAS.has(x.severity)) {
        out.set(x.source, { source: x.source, name: x.name, severity: x.severity, range: x.range, url: x.url });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.source - b.source);
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** @returns {{ ok: boolean, falhas: string[], avisos: string[] }} */
export function avaliar(audit, excecoes) {
  const falhas = [];
  const avisos = [];
  if (!audit || audit.auditReportVersion !== 2 || typeof audit.vulnerabilities !== "object") {
    return { ok: false, falhas: ["RELATORIO_INVALIDO: esperado `npm audit --json` (auditReportVersion 2)"], avisos };
  }
  const ex = excecoes?.excecoes ?? [];
  if (excecoes?.status !== "TEMPORARIA" || excecoes?.revisar_antes_do_rc !== true || !excecoes?.decisao) {
    falhas.push("EXCECAO_MAL_FORMADA: exige status TEMPORARIA, revisar_antes_do_rc=true e decisao");
  }

  // 1. critical nunca passa
  const criticos = Object.values(audit.vulnerabilities).filter((v) => v.severity === "critical").map((v) => v.name);
  const metaCrit = Number(audit.metadata?.vulnerabilities?.critical ?? 0);
  if (criticos.length || metaCrit > 0) falhas.push(`CRITICAL: ${criticos.join(", ") || `${metaCrit} no metadata`}`);

  // 2. só o advisory registrado, idêntico
  const permitidos = new Map(ex.map((e) => [e.advisory.source, e.advisory]));
  for (const a of advisoriesAltos(audit)) {
    const reg = permitidos.get(a.source);
    if (!reg) falhas.push(`NOVO_HIGH: advisory ${a.source} ${a.name} ${a.range} ${a.url ?? ""}`.trim());
    else if (!igual({ ...reg }, { source: a.source, name: a.name, severity: a.severity, range: a.range, url: a.url })) {
      falhas.push(`ADVISORY_MUDOU: ${a.source} registrado ${JSON.stringify(reg)} × atual ${JSON.stringify(a)}`);
    }
  }

  // 3. cadeia idêntica
  const atual = cadeiaAtual(audit);
  const registrada = [...ex.flatMap((e) => e.cadeia)].sort((a, b) => a.name.localeCompare(b.name));
  const porNome = (l) => new Map(l.map((i) => [i.name, i]));
  const A = porNome(atual), R = porNome(registrada);
  for (const [n, i] of A) {
    if (!R.has(n)) falhas.push(`DERIVA_CADEIA: pacote novo na cadeia high: ${n} (${i.nodes.join(", ")})`);
    else if (!igual(i, R.get(n))) falhas.push(`DERIVA_CADEIA: ${n} mudou: registrado ${JSON.stringify(R.get(n))} × atual ${JSON.stringify(i)}`);
  }
  for (const n of R.keys()) if (!A.has(n)) falhas.push(`DERIVA_CADEIA: ${n} saiu da cadeia — revisar/remover a exceção (não assumir correção sem prova)`);

  if (!falhas.length && ex.length) {
    avisos.push(`EXCECAO_EM_USO: ${ex.map((e) => `${e.id} ${e.advisory.url}`).join("; ")} — vulnerabilidade NÃO corrigida; revisão OBRIGATÓRIA antes da seleção de RC`);
  }
  return { ok: falhas.length === 0, falhas, avisos };
}
