/**
 * FASE A — DATA TRUTH (docs/PLANO-STRATEGY-INTELLIGENCE-FORENSIC-LEARNING.md §4, FSL-10).
 *
 * Motor PURO de reconciliação: recebe uma EXPORTAÇÃO já feita (só leitura, ver
 * scripts/strategy/) e devolve um relatório canônico. Não conserta nada, não
 * escreve em lugar nenhum, não conhece banco. O reparo de carteira que existe
 * (`src/lib/paper/reconcile.ts` + `admin/api/paper-repair`) continua manual e
 * fora daqui — este módulo só DIZ o que diverge e qual explicação os dados sustentam.
 *
 * ⚠️ SEM IMPORTS de propósito: o CLI (`scripts/strategy/relatorio.mjs`) carrega este
 * arquivo direto com o strip-types do Node 24, e o teste de isolamento prova que ele
 * não alcança rede nem cliente de banco.
 *
 * Classificação de uma divergência — a PRIMEIRA explicação que os dados sustentam:
 *   EXPLAINED            bate (dentro da tolerância) com a leitura atual do código
 *   ARCHIVAL_EFFECT      bate quando se inclui/isola a rodada arquivada (0017, `archived_at`)
 *   RESET_EFFECT         bate com o que fechou depois de um reset conhecido
 *   VERSIONED_SEMANTICS  bate com o que fechou depois de uma troca de semântica conhecida
 *   DATA_GAP             falta dado para conferir (pnl nulo, vínculo órfão, resultado ausente)
 *   UNKNOWN              nenhuma explicação acima — investigar; NÃO chamar de corrupção
 */

export const CLASSIFICACOES = ["EXPLAINED", "VERSIONED_SEMANTICS", "ARCHIVAL_EFFECT", "RESET_EFFECT", "DATA_GAP", "UNKNOWN"] as const;
export type Classificacao = (typeof CLASSIFICACOES)[number];
export type Confianca = "HIGH" | "MEDIUM" | "LOW";
export const VERSAO_REGRAS = "fase-a-v1";

/** Tolerâncias: as mesmas do detector existente (`paper/reconcile.ts`). */
export const TOL_CONTADOR_USD = 0.01;
export const TOL_CAIXA_USD = 0.5;
export const TOL_CELEIRO_USD = 0.01;
export const TOL_LAB_PP = 0.01;

type Num = number | string | null;
type Ts = string | null;

export interface EventoConhecido {
  tipo: "reset" | "semantica";
  em: string;                 // ISO
  /** source/agente afetado; ausente = todos */
  escopo?: string[];
  descricao: string;
}

export interface Exportacao {
  capturado_em: string;
  fonte: string;              // ex.: "descartavel:zswap-rr-rt-…" — nunca credencial
  paper_accounts: Array<{ id: string; source: string; starting_usd: Num; cash_usd: Num; realized_pnl_usd: Num; wins: Num; losses: Num; created_at: Ts; updated_at: Ts }>;
  paper_positions: Array<{ id: string; account_id: string; suggestion_id: string; source: string; symbol: string; side: string; cost_usd: Num; status: string; exit_reason: string | null; pnl_usd: Num; opened_at: Ts; closed_at: Ts; archived_at: Ts }>;
  zion_suggestions: Array<{ id: string; source: string; symbol: string; side: string; status: string; created_at: Ts; resolved_at: Ts; archived_at: Ts }>;
  celeiro_posicoes: Array<{ id: string; agente: string; lado: string; usd: Num; preco_entrada: Num; preco_saida: Num; motivo_saida: string | null; aberta_em: Ts; fechada_em: Ts; genoma_versao: Num; meta?: Record<string, unknown> | null }>;
  celeiro_fluxos: Array<{ id: string; agente: string; causa: string; usdt: Num; ref: string | null; ocorreu_em: Ts; genoma_versao: Num }>;
  celeiro_genoma: Array<{ agente: string; versao: Num; ativo: boolean; criado_em: Ts }>;
  bancada_rodada: Array<{ id: string; origem: string; estrategia_id: string | null; status: string; criada_em: Ts; terminada_em: Ts }>;
  bancada_operacao: Array<{ id: string; rodada_id: string; desfecho: string; liquido_pct: Num }>;
  bancada_resultado: Array<{ rodada_id: string; n: Num; acertos: Num; liquido_pct: Num }>;
  lab_runs: Array<{ id: string; strategy_id: string; status: string; started_at: Ts; finished_at: Ts }>;
  lab_results: Array<{ id: string; run_id: string; net_pct: Num; gross_pct: Num; cost_pct: Num; trades: Num; sample_n: Num }>;
  mercado: Array<{ tabela: string; linhas: Num; de: Ts; ate: Ts; chaves: Num }>;
  eventos_conhecidos?: EventoConhecido[];
}

export interface LinhaRelatorio {
  dataset: string;
  row_count: number;
  identity_key: string;
  time_range: { de: string; ate: string } | null;
  authoritative_fields: string[];
  derived_fields: string[];
  known_semantic_versions: string[];
  accounting_total: number | null;
  position_total: number | null;
  delta: number | null;
  classification: Classificacao;
  confidence: Confianca;
  notes: string[];
}

export interface Relatorio {
  versao_regras: string;
  capturado_em: string;
  fonte: string;
  linhas: LinhaRelatorio[];
  resumo: Record<Classificacao, number>;
}

/** Fronteira da rodada 1 (migration 0017): sugestões anteriores são arquivadas. */
export const FRONTEIRA_RODADA_1 = "2026-07-17T08:32:00Z";

// ── utilidades puras ──
const n = (v: Num): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const soma = (xs: Array<number | null>) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
const iso = (t: Ts) => (t ? new Date(t).toISOString() : null);
function faixa(ts: Ts[]): { de: string; ate: string } | null {
  const v = ts.map(iso).filter((x): x is string => x !== null).sort();
  return v.length ? { de: v[0], ate: v[v.length - 1] } : null;
}
const eventosPara = (evs: EventoConhecido[], tipo: EventoConhecido["tipo"], alvo: string) =>
  evs.filter((e) => e.tipo === tipo && (!e.escopo || e.escopo.includes(alvo))).sort((a, b) => a.em.localeCompare(b.em));

// ── paper: contador realizado × posições ──
function paperContador(e: Exportacao, eventos: EventoConhecido[]): LinhaRelatorio[] {
  const out: LinhaRelatorio[] = [];
  for (const a of [...e.paper_accounts].sort((x, y) => x.source.localeCompare(y.source))) {
    const pos = e.paper_positions.filter((p) => p.account_id === a.id);
    const fechadas = pos.filter((p) => p.status === "closed");
    const vivas = fechadas.filter((p) => !p.archived_at);
    const arquivadas = fechadas.filter((p) => p.archived_at);
    const semPnl = fechadas.filter((p) => n(p.pnl_usd) === null);
    const guardado = n(a.realized_pnl_usd);
    const somaVivas = r2(soma(vivas.map((p) => n(p.pnl_usd))));
    const base: Omit<LinhaRelatorio, "classification" | "confidence" | "notes" | "delta"> = {
      dataset: `paper_accounts.realized_pnl_usd:${a.source}`,
      row_count: pos.length,
      identity_key: "paper_accounts.id = paper_positions.account_id",
      time_range: faixa(pos.map((p) => p.closed_at ?? p.opened_at)),
      authoritative_fields: ["paper_positions.pnl_usd", "paper_positions.status", "paper_positions.archived_at"],
      derived_fields: ["paper_accounts.realized_pnl_usd (denormalizado)", "paper_accounts.wins", "paper_accounts.losses"],
      known_semantic_versions: ["archived_at IS NULL = rodada viva (0017)", "pnl_pct líquido de custo de ida e volta (0015)"],
      accounting_total: guardado,
      position_total: somaVivas,
    };
    const notas = [`fechadas=${fechadas.length} vivas=${vivas.length} arquivadas=${arquivadas.length}`];
    if (guardado === null) { out.push({ ...base, delta: null, classification: "DATA_GAP", confidence: "HIGH", notes: [...notas, "realized_pnl_usd nulo"] }); continue; }
    const delta = r2(guardado - somaVivas);
    const bate = (x: number) => Math.abs(guardado - x) <= TOL_CONTADOR_USD;
    if (semPnl.length) { out.push({ ...base, delta, classification: "DATA_GAP", confidence: "HIGH", notes: [...notas, `${semPnl.length} posição(ões) fechada(s) sem pnl_usd`] }); continue; }
    if (bate(somaVivas)) { out.push({ ...base, delta, classification: "EXPLAINED", confidence: "HIGH", notes: [...notas, "contador = soma das fechadas vivas"] }); continue; }
    const somaTudo = r2(soma(fechadas.map((p) => n(p.pnl_usd))));
    const somaArq = r2(soma(arquivadas.map((p) => n(p.pnl_usd))));
    if (arquivadas.length && bate(somaArq)) { out.push({ ...base, delta, classification: "ARCHIVAL_EFFECT", confidence: "HIGH", notes: [...notas, `contador = soma só das ARQUIVADAS (${somaArq}); reset parcial deixou o contador para trás`] }); continue; }
    if (arquivadas.length && bate(somaTudo)) { out.push({ ...base, delta, classification: "ARCHIVAL_EFFECT", confidence: "HIGH", notes: [...notas, `contador = soma de vida inteira (${somaTudo}); a conta guarda a rodada arquivada`] }); continue; }
    let explicado = false;
    for (const [tipo, cls] of [["reset", "RESET_EFFECT"], ["semantica", "VERSIONED_SEMANTICS"]] as const) {
      for (const ev of eventosPara(eventos, tipo, a.source).reverse()) {
        const depois = r2(soma(vivas.filter((p) => (iso(p.closed_at) ?? "") >= new Date(ev.em).toISOString()).map((p) => n(p.pnl_usd))));
        if (bate(depois)) { out.push({ ...base, delta, classification: cls, confidence: "HIGH", notes: [...notas, `contador = fechadas depois de ${ev.em} (${ev.descricao})`] }); explicado = true; break; }
      }
      if (explicado) break;
    }
    if (explicado) continue;
    const decididos = (n(a.wins) ?? 0) + (n(a.losses) ?? 0);
    if (guardado === 0 && decididos === 0 && vivas.length > 0) {
      out.push({ ...base, delta, classification: "RESET_EFFECT", confidence: "LOW", notes: [...notas, "contador e wins/losses zerados com posições vivas fechadas: padrão de reset sem arquivamento; falta o evento datado para confirmar"] });
      continue;
    }
    out.push({ ...base, delta, classification: "UNKNOWN", confidence: "LOW", notes: [...notas, `vida inteira=${somaTudo} arquivadas=${somaArq}; nenhuma explicação conhecida bate — investigar, não rotular corrupção`] });
  }
  return out;
}

// ── paper: invariante de caixa (mesma fórmula de paper/reconcile.ts computeDrift) ──
function paperCaixa(e: Exportacao): LinhaRelatorio[] {
  return [...e.paper_accounts].sort((x, y) => x.source.localeCompare(y.source)).map((a) => {
    const vivas = e.paper_positions.filter((p) => p.account_id === a.id && !p.archived_at);
    const custoAberto = soma(vivas.filter((p) => p.status === "open").map((p) => n(p.cost_usd)));
    const realizado = soma(vivas.filter((p) => p.status === "closed").map((p) => n(p.pnl_usd)));
    const inicial = n(a.starting_usd), caixa = n(a.cash_usd);
    const base = {
      dataset: `paper_accounts.cash_usd:${a.source}`, row_count: vivas.length,
      identity_key: "paper_accounts.id", time_range: faixa(vivas.map((p) => p.opened_at)),
      authoritative_fields: ["paper_accounts.starting_usd", "paper_positions.cost_usd", "paper_positions.pnl_usd"],
      derived_fields: ["paper_accounts.cash_usd"],
      known_semantic_versions: ["caixa = inicial − custo aberto + realizado vivo (paper/reconcile.ts)"],
    };
    if (inicial === null || caixa === null) return { ...base, accounting_total: caixa, position_total: null, delta: null, classification: "DATA_GAP" as const, confidence: "HIGH" as const, notes: ["starting_usd/cash_usd nulo"] };
    const esperado = r2(inicial - custoAberto + realizado);
    const delta = r2(caixa - esperado);
    const ok = Math.abs(delta) <= TOL_CAIXA_USD;
    return { ...base, accounting_total: caixa, position_total: esperado, delta,
      classification: ok ? "EXPLAINED" as const : "UNKNOWN" as const, confidence: ok ? "HIGH" as const : "MEDIUM" as const,
      notes: ok ? ["caixa bate com o livro vivo"] : [delta > 0 ? "caixa a MAIS que o livro (o reparo existente não toca excesso)" : "caixa a MENOS que o livro (vazamento — reparo é manual, admin/api/paper-repair)"] };
  });
}

// ── paper: contadores wins/losses × alvos/stops vivos ──
function paperDecisoes(e: Exportacao): LinhaRelatorio[] {
  return [...e.paper_accounts].sort((x, y) => x.source.localeCompare(y.source)).map((a) => {
    const pos = e.paper_positions.filter((p) => p.account_id === a.id && p.status === "closed");
    const vivas = pos.filter((p) => !p.archived_at && (p.exit_reason === "target" || p.exit_reason === "stop"));
    const arq = pos.filter((p) => p.archived_at).length;
    const conta = (n(a.wins) ?? 0) + (n(a.losses) ?? 0);
    const delta = conta - vivas.length;
    const cls: Classificacao = delta === 0 ? "EXPLAINED" : arq > 0 ? "ARCHIVAL_EFFECT" : "UNKNOWN";
    return {
      dataset: `paper_accounts.wins+losses:${a.source}`, row_count: pos.length, identity_key: "paper_accounts.id",
      time_range: faixa(pos.map((p) => p.closed_at)),
      authoritative_fields: ["paper_positions.exit_reason", "paper_positions.archived_at"], derived_fields: ["paper_accounts.wins", "paper_accounts.losses"],
      known_semantic_versions: ["decisão = alvo ou stop; expired não é win/loss"],
      accounting_total: conta, position_total: vivas.length, delta, classification: cls,
      confidence: cls === "ARCHIVAL_EFFECT" ? "MEDIUM" : cls === "EXPLAINED" ? "HIGH" : "LOW",
      notes: cls === "ARCHIVAL_EFFECT" ? [`${arq} fechada(s) arquivada(s): a conta guarda decisões anteriores ao arquivamento`] : [],
    };
  });
}

// ── paper_positions → zion_suggestions (referência suave) ──
function paperSugestoes(e: Exportacao): LinhaRelatorio {
  const sug = new Map(e.zion_suggestions.map((s) => [s.id, s]));
  const orfas = e.paper_positions.filter((p) => !sug.has(p.suggestion_id));
  const divergentes = e.paper_positions.filter((p) => { const s = sug.get(p.suggestion_id); return s && (s.symbol !== p.symbol || s.side !== p.side); });
  const cls: Classificacao = orfas.length ? "DATA_GAP" : divergentes.length ? "UNKNOWN" : "EXPLAINED";
  return {
    dataset: "paper_positions→zion_suggestions", row_count: e.paper_positions.length, identity_key: "paper_positions.suggestion_id = zion_suggestions.id (sem FK)",
    time_range: faixa(e.paper_positions.map((p) => p.opened_at)),
    authoritative_fields: ["zion_suggestions.id", "zion_suggestions.symbol", "zion_suggestions.side"], derived_fields: ["paper_positions.symbol", "paper_positions.side"],
    known_semantic_versions: ["referência suave (0015): sugestão é fonte só de leitura"],
    accounting_total: e.paper_positions.length, position_total: e.paper_positions.length - orfas.length, delta: orfas.length,
    classification: cls, confidence: "HIGH",
    notes: [`órfãs=${orfas.length}`, `símbolo/lado divergente=${divergentes.length}`],
  };
}

function sugestoes(e: Exportacao): LinhaRelatorio {
  const antes = e.zion_suggestions.filter((s) => (iso(s.created_at) ?? "") < new Date(FRONTEIRA_RODADA_1).toISOString());
  const naoArq = antes.filter((s) => !s.archived_at);
  const status = new Map<string, number>();
  for (const s of e.zion_suggestions) status.set(s.status, (status.get(s.status) ?? 0) + 1);
  return {
    dataset: "zion_suggestions", row_count: e.zion_suggestions.length, identity_key: "zion_suggestions.id",
    time_range: faixa(e.zion_suggestions.map((s) => s.created_at)),
    authoritative_fields: ["status", "outcome_pct", "created_at", "resolved_at"], derived_fields: ["archived_at (época)"],
    known_semantic_versions: [`rodada 1 = created_at < ${FRONTEIRA_RODADA_1} (0017)`, "expired ≠ win/loss"],
    accounting_total: antes.length, position_total: antes.length - naoArq.length, delta: naoArq.length,
    classification: naoArq.length ? "UNKNOWN" : "EXPLAINED", confidence: "HIGH",
    notes: [`status: ${[...status].sort().map(([k, v]) => `${k}=${v}`).join(" ")}`, naoArq.length ? `${naoArq.length} sugestão(ões) da rodada 1 sem archived_at` : "rodada 1 toda arquivada"],
  };
}

// ── Celeiro: fluxo de preço × posições fechadas ──
function movimentoPct(lado: string, ent: number, sai: number) {
  const b = (sai - ent) / ent * 100;
  return lado === "buy" ? b : -b;
}
function celeiro(e: Exportacao): LinhaRelatorio[] {
  const agentes = [...new Set([...e.celeiro_posicoes.map((p) => p.agente), ...e.celeiro_fluxos.map((f) => f.agente)])].sort();
  const out: LinhaRelatorio[] = [];
  for (const ag of agentes) {
    const pos = e.celeiro_posicoes.filter((p) => p.agente === ag);
    const flu = e.celeiro_fluxos.filter((f) => f.agente === ag);
    const fechadas = pos.filter((p) => p.fechada_em);
    const precoPorPos = new Map<string, number>();
    for (const f of flu) if (f.causa === "preco" && f.ref?.startsWith("fechamento:")) {
      const id = f.ref.slice("fechamento:".length);
      precoPorPos.set(id, (precoPorPos.get(id) ?? 0) + (n(f.usdt) ?? 0));
    }
    const semFluxo = fechadas.filter((p) => !precoPorPos.has(p.id));
    const abertasComFluxo = pos.filter((p) => !p.fechada_em && precoPorPos.has(p.id));
    const semPreco = fechadas.filter((p) => !(n(p.preco_entrada)! > 0) || !(n(p.preco_saida)! > 0));
    const esperado = r2(soma(fechadas.filter((p) => !semPreco.includes(p)).map((p) => (n(p.usd) ?? 0) * movimentoPct(p.lado, n(p.preco_entrada)!, n(p.preco_saida)!) / 100)));
    const registrado = r2([...precoPorPos].filter(([id]) => fechadas.some((p) => p.id === id)).reduce((s, [, v]) => s + v, 0));
    const delta = r2(registrado - esperado);
    const alavancadas = fechadas.filter((p) => p.meta && typeof p.meta === "object" && Number((p.meta as Record<string, unknown>).alavanca) > 1).length;
    const porCausa = new Map<string, number>();
    for (const f of flu) porCausa.set(f.causa, r2((porCausa.get(f.causa) ?? 0) + (n(f.usdt) ?? 0)));
    let cls: Classificacao, conf: Confianca;
    if (semFluxo.length || semPreco.length) { cls = "DATA_GAP"; conf = "HIGH"; }
    else if (Math.abs(delta) <= TOL_CELEIRO_USD * Math.max(1, fechadas.length)) { cls = "EXPLAINED"; conf = "HIGH"; }
    else if (alavancadas) { cls = "VERSIONED_SEMANTICS"; conf = "LOW"; }
    else { cls = "UNKNOWN"; conf = "LOW"; }
    out.push({
      dataset: `celeiro_fluxos.preco:${ag}`, row_count: pos.length + flu.length, identity_key: "celeiro_fluxos.ref = 'fechamento:'||celeiro_posicoes.id",
      time_range: faixa([...pos.map((p) => p.aberta_em), ...flu.map((f) => f.ocorreu_em)]),
      authoritative_fields: ["celeiro_fluxos.usdt", "celeiro_fluxos.causa"], derived_fields: ["celeiro_posicoes.preco_saida → movimento × usd"],
      known_semantic_versions: ["preco = usd × movimento assinado pelo lado (celeiro/posicao.ts)", "taxa viaja com a posição desde 23/08", "motivo 'liquidacao' (0049)"],
      accounting_total: registrado, position_total: esperado, delta, classification: cls, confidence: conf,
      notes: [
        `posições=${pos.length} fechadas=${fechadas.length} fluxos=${flu.length}`,
        `fechadas sem fluxo de preço=${semFluxo.length}; abertas com fluxo de fechamento=${abertasComFluxo.length}; sem preço válido=${semPreco.length}`,
        `por causa: ${[...porCausa].sort().map(([k, v]) => `${k}=${v}`).join(" ")}`,
        ...(alavancadas ? [`${alavancadas} posição(ões) com alavanca>1 em meta — semântica de nocional a confirmar`] : []),
      ],
    });
  }
  // genoma: versões referenciadas existem? no máximo um ativo por agente?
  const versoes = new Set(e.celeiro_genoma.map((g) => `${g.agente}#${n(g.versao)}`));
  const refs = [...e.celeiro_posicoes, ...e.celeiro_fluxos].filter((x) => n(x.genoma_versao) !== null);
  const faltando = [...new Set(refs.map((x) => `${x.agente}#${n(x.genoma_versao)}`))].filter((k) => !versoes.has(k)).sort();
  const ativos = new Map<string, number>();
  for (const g of e.celeiro_genoma) if (g.ativo) ativos.set(g.agente, (ativos.get(g.agente) ?? 0) + 1);
  const multi = [...ativos].filter(([, c]) => c > 1).map(([a]) => a).sort();
  out.push({
    dataset: "celeiro_genoma", row_count: e.celeiro_genoma.length, identity_key: "(agente, versao)",
    time_range: faixa(e.celeiro_genoma.map((g) => g.criado_em)),
    authoritative_fields: ["versao", "params", "ativo"], derived_fields: ["celeiro_posicoes.genoma_versao", "celeiro_fluxos.genoma_versao"],
    known_semantic_versions: ["genoma versionado por agente (0027)"],
    accounting_total: refs.length, position_total: refs.length - refs.filter((x) => !versoes.has(`${x.agente}#${n(x.genoma_versao)}`)).length,
    delta: faltando.length,
    classification: faltando.length ? "DATA_GAP" : multi.length ? "UNKNOWN" : "EXPLAINED", confidence: "HIGH",
    notes: [`versões referenciadas sem linha de genoma: ${faltando.join(",") || "nenhuma"}`, `agentes com mais de um genoma ativo: ${multi.join(",") || "nenhum"}`],
  });
  return out;
}

// ── Bancada: resultado.n × operações; vínculo com estratégia ──
function bancada(e: Exportacao): LinhaRelatorio {
  const ops = new Map<string, number>();
  for (const o of e.bancada_operacao) ops.set(o.rodada_id, (ops.get(o.rodada_id) ?? 0) + 1);
  const res = e.bancada_resultado;
  const divergentes = res.filter((r) => (n(r.n) ?? -1) !== (ops.get(r.rodada_id) ?? 0));
  const concluidasSemResultado = e.bancada_rodada.filter((r) => r.status === "concluida" && !res.some((x) => x.rodada_id === r.id));
  const semEstrategia = e.bancada_rodada.filter((r) => r.origem === "propria" && !r.estrategia_id);
  const cls: Classificacao = concluidasSemResultado.length ? "DATA_GAP" : divergentes.length ? "UNKNOWN" : "EXPLAINED";
  return {
    dataset: "bancada_resultado↔bancada_operacao", row_count: e.bancada_rodada.length + e.bancada_operacao.length + res.length,
    identity_key: "bancada_rodada.id = bancada_operacao.rodada_id = bancada_resultado.rodada_id",
    time_range: faixa(e.bancada_rodada.map((r) => r.criada_em)),
    authoritative_fields: ["bancada_operacao.*"], derived_fields: ["bancada_resultado.n", "bancada_resultado.acertos", "bancada_resultado.liquido_pct"],
    known_semantic_versions: ["operações gravadas podem ser amostra (n do resultado conta todas) — a confirmar no código da bancada"],
    accounting_total: soma(res.map((r) => n(r.n))), position_total: e.bancada_operacao.length,
    delta: soma(res.map((r) => n(r.n))) - e.bancada_operacao.length,
    classification: cls, confidence: cls === "EXPLAINED" ? "HIGH" : "MEDIUM",
    notes: [`rodadas=${e.bancada_rodada.length} com resultado=${res.length}`, `n divergente das operações gravadas=${divergentes.length}`,
      `concluídas sem resultado=${concluidasSemResultado.length}`, `rodadas próprias sem estrategia_id (DATA_GAP de vínculo, FSL-10)=${semEstrategia.length}`],
  };
}

// ── Laboratório: run ok ↔ resultado; líquido = bruto − custo ──
function lab(e: Exportacao): LinhaRelatorio {
  const porRun = new Map<string, number>();
  for (const r of e.lab_results) porRun.set(r.run_id, (porRun.get(r.run_id) ?? 0) + 1);
  const ok = e.lab_runs.filter((r) => r.status === "ok");
  const okSem = ok.filter((r) => !porRun.has(r.id));
  const duplicados = [...porRun].filter(([, c]) => c > 1).length;
  const aritmetica = e.lab_results.filter((r) => {
    const net = n(r.net_pct), g = n(r.gross_pct), c = n(r.cost_pct);
    return net !== null && g !== null && c !== null && Math.abs(net - (g - c)) > TOL_LAB_PP;
  });
  const cls: Classificacao = okSem.length || duplicados ? "DATA_GAP" : aritmetica.length ? "VERSIONED_SEMANTICS" : "EXPLAINED";
  return {
    dataset: "lab_runs↔lab_results", row_count: e.lab_runs.length + e.lab_results.length, identity_key: "lab_results.run_id = lab_runs.id",
    time_range: faixa(e.lab_runs.map((r) => r.started_at)),
    authoritative_fields: ["lab_results.gross_pct", "lab_results.cost_pct"], derived_fields: ["lab_results.net_pct", "lab_results.verdict"],
    known_semantic_versions: ["net = gross − cost (convenção esperada; composição multiplicativa daria diferença pequena)"],
    accounting_total: ok.length, position_total: ok.length - okSem.length, delta: okSem.length,
    classification: cls, confidence: aritmetica.length && !okSem.length ? "LOW" : "HIGH",
    notes: [`runs=${e.lab_runs.length} ok=${ok.length} resultados=${e.lab_results.length}`, `ok sem resultado=${okSem.length}; runs com >1 resultado=${duplicados}`,
      `net ≠ gross − cost (>${TOL_LAB_PP}pp)=${aritmetica.length}${aritmetica.length ? " — pode ser composição/versão do motor; não é erro presumido" : ""}`],
  };
}

function mercado(e: Exportacao): LinhaRelatorio[] {
  return [...e.mercado].sort((a, b) => a.tabela.localeCompare(b.tabela)).map((m) => ({
    dataset: `mercado:${m.tabela}`, row_count: n(m.linhas) ?? 0, identity_key: m.tabela === "mercado_vela" ? "(simbolo, intervalo, abriu_em)" : "symbol",
    time_range: m.de && m.ate ? { de: iso(m.de)!, ate: iso(m.ate)! } : null,
    authoritative_fields: m.tabela === "mercado_vela" ? ["high", "low", "close", "volume"] : ["regime", "atr_pct"],
    derived_fields: m.tabela === "mercado_vela" ? [] : ["vol_avg (EWMA)", "range_pct"],
    known_semantic_versions: m.tabela === "mercado_vela" ? ["abriu_em em ms epoch"] : ["regime atual por símbolo; sem histórico (sobrescrito)"],
    accounting_total: null, position_total: null, delta: null,
    classification: "EXPLAINED" as const, confidence: "HIGH" as const,
    notes: [`chaves distintas=${n(m.chaves) ?? "?"}`, m.tabela === "market_brain" ? "sem histórico: não serve para atribuir regime retroativo (FSL-02 precisa de série)" : "descritivo"],
  }));
}

export function reconciliar(e: Exportacao): Relatorio {
  const eventos = e.eventos_conhecidos ?? [];
  const linhas = [
    ...paperContador(e, eventos), ...paperCaixa(e), ...paperDecisoes(e), paperSugestoes(e), sugestoes(e),
    ...celeiro(e), bancada(e), lab(e), ...mercado(e),
  ];
  const resumo = Object.fromEntries(CLASSIFICACOES.map((c) => [c, linhas.filter((l) => l.classification === c).length])) as Record<Classificacao, number>;
  return { versao_regras: VERSAO_REGRAS, capturado_em: e.capturado_em, fonte: e.fonte, linhas, resumo };
}

export function relatorioMarkdown(r: Relatorio): string {
  const fmt = (x: number | null) => (x === null ? "—" : String(x));
  const l = [
    `# Fase A — reconciliação (${r.versao_regras})`, "",
    `capturado_em: ${r.capturado_em} · fonte: ${r.fonte}`, "",
    `resumo: ${CLASSIFICACOES.map((c) => `${c}=${r.resumo[c]}`).join(" · ")}`, "",
    "| dataset | rows | accounting | position | delta | classification | confidence | notes |", "|---|---|---|---|---|---|---|---|",
    ...r.linhas.map((x) => `| ${x.dataset} | ${x.row_count} | ${fmt(x.accounting_total)} | ${fmt(x.position_total)} | ${fmt(x.delta)} | ${x.classification} | ${x.confidence} | ${x.notes.join("; ").replace(/\|/g, "/")} |`),
  ];
  return l.join("\n") + "\n";
}
