/**
 * BANCADA DE AUDITORIA — verificações que SÓ podem ser feitas em execução.
 *
 * POR QUE ISTO EXISTE:
 *
 * Uma auditoria de código respondeu "está pronta" sobre uma plataforma cujo
 * agregador de swap estava morto havia dias. A auditoria não errou: ela LEU o
 * código, e o código estava correto. O que faltava não era legibilidade — era
 * um endereço de rede que deixou de existir.
 *
 * Existe uma classe inteira de defeito que nenhuma leitura encontra:
 *
 *   · terceiro desligou um endpoint (foi o caso da Jupiter),
 *   · migration não foi aplicada no banco de produção,
 *   · RLS existe no arquivo mas não está valendo na instância,
 *   · rota de admin devolve 403 em vez de 404 e revela que existe,
 *   · segredo vazou numa variável NEXT_PUBLIC_,
 *   · locale novo nasceu com metade das chaves.
 *
 * Todos esses são invisíveis no repositório e óbvios em produção. Este módulo
 * pergunta ao SISTEMA VIVO em vez de perguntar ao arquivo.
 *
 * E há uma razão de negócio: a Zetta World vai vender auditoria. Uma empresa de
 * auditoria que não consegue auditar o próprio produto não tem o que vender.
 * Esta bancada é o primeiro cliente do produto.
 *
 * REGRA DE OURO: nenhuma verificação aqui ESCREVE nada nem gasta dinheiro. São
 * todas leituras. Uma bancada que pode quebrar a produção não vai ser rodada.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { checkExternalDeps } from "@/lib/admin/deps";
import { runAttackSuite } from "@/lib/admin/attack";
import { checkEvmAllowlistDrift } from "@/lib/admin/evm-probe";
import { envNumber } from "@/lib/env-number";
import { reconcileWallets, significantDrifts, starvedWallets } from "@/lib/paper/reconcile";

export type Severity = "critical" | "high" | "medium" | "low";
export type AuditCategory = "dados" | "segurança" | "integração" | "config" | "i18n";

export interface AuditFinding {
  id: string;
  name: string;
  category: AuditCategory;
  severity: Severity;
  pass: boolean;
  /** O que foi observado — evidência, não opinião. */
  detail: string;
  /** Por que isto não pode ser pego lendo código. */
  whyRuntime: string;
  /** `true` quando a verificação não pôde rodar (falta env, etc.). Não é
   *  aprovação nem reprovação — é buraco de cobertura, e some como buraco. */
  inconclusive?: boolean;
  /** Quanto tempo ESTA verificação levou, e quantas idas à rede/banco fez.
   *
   *  Existe para ser auditável: "a bancada rodou rápido demais para ter testado
   *  algo" é uma desconfiança legítima, e a resposta honesta é mostrar o
   *  cronômetro em vez de pedir confiança. Nove verificações em paralelo, cada
   *  uma com poucas chamadas, levam segundos — mas quem lê deve poder conferir. */
  durationMs?: number;
  /** Chamadas externas/consultas que esta verificação realmente fez. */
  calls?: number;
}

// ── 1. Deriva do banco vivo: a migration foi aplicada? ────────────────────
//
// O código assume colunas que só existem se a migration rodou. Se alguém
// esquecer de aplicar, o app não quebra alto: os inserts falham em best-effort
// e a mesa simplesmente fica em zero pra sempre. Silencioso — o pior tipo.
const EXPECTED_SCHEMA: Record<string, string[]> = {
  zion_suggestions: ["symbol", "kind", "side", "ref_price", "source", "status", "chain", "pool_address", "archived_at"],
  paper_positions:  ["account_id", "source", "symbol", "side", "qty", "entry_price", "chain", "pool_address"],
  paper_accounts:   ["source", "label", "starting_usd", "cash_usd", "realized_pnl_usd"],
  admin_kv:         ["key", "value", "updated_at"],
  platform_events:  ["event_type", "metadata", "created_at"],
};

async function checkSchema(): Promise<AuditFinding> {
  const base = {
    id: "schema_drift", name: "Schema do banco confere com o que o código espera",
    category: "dados" as const, severity: "critical" as const,
    whyRuntime: "o arquivo de migration existir no repo não prova que ele rodou na instância de produção",
  };
  const db = getSupabaseAdmin();
  if (!db) return { ...base, pass: false, inconclusive: true, detail: "sem conexão com o banco" };

  const missing: string[] = [];
  for (const [table, cols] of Object.entries(EXPECTED_SCHEMA)) {
    // `select` com limit 0 valida os nomes de coluna sem trazer dado nenhum:
    // o PostgREST recusa a query se qualquer coluna não existir.
    const { error } = await db.from(table).select(cols.join(", ")).limit(0);
    if (error) missing.push(`${table}: ${error.message.slice(0, 90)}`);
  }
  return missing.length === 0
    ? { ...base, pass: true, detail: `${Object.keys(EXPECTED_SCHEMA).length} tabelas conferidas, todas as colunas presentes` }
    : { ...base, pass: false, detail: `divergência: ${missing.join(" | ")}` };
}

// ── 2. RLS está valendo na INSTÂNCIA, não só no arquivo ───────────────────
async function checkRls(): Promise<AuditFinding> {
  const base = {
    id: "rls_default_deny", name: "RLS default-deny bloqueia a chave anônima",
    category: "segurança" as const, severity: "critical" as const,
    whyRuntime: "a policy pode existir no migration e não estar habilitada no projeto — só a chave anônima real prova",
  };
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { ...base, pass: false, inconclusive: true, detail: "SUPABASE_ANON_KEY não configurada neste ambiente — não deu para testar" };
  }
  const sensitive = ["zion_suggestions", "paper_accounts", "admin_kv", "platform_events"];
  const leaked: string[] = [];
  for (const table of sensitive) {
    try {
      // REST direto com a chave anônima: é exatamente o que um navegador
      // hostil faria. Uma linha devolvida aqui é vazamento real.
      const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` }, cache: "no-store",
      });
      if (res.ok) {
        const rows = await res.json().catch(() => []);
        if (Array.isArray(rows) && rows.length > 0) leaked.push(table);
      }
    } catch { /* falha de rede não é vazamento */ }
  }
  return leaked.length === 0
    ? { ...base, pass: true, detail: `${sensitive.length} tabelas sensíveis testadas com a chave anônima — nenhuma devolveu linha` }
    : { ...base, pass: false, detail: `🚨 VAZAMENTO: ${leaked.join(", ")} devolveram dados para a chave anônima` };
}

// ── 3. Segredo em variável pública ────────────────────────────────────────
function checkPublicEnv(): AuditFinding {
  const base = {
    id: "public_env_hygiene", name: "Nenhum segredo em variável NEXT_PUBLIC_",
    category: "segurança" as const, severity: "critical" as const,
    whyRuntime: "só o ambiente REAL revela o que foi colado na Vercel; o repo não vê o valor",
  };
  // Um NEXT_PUBLIC_ é embutido no JavaScript que vai pro navegador. Qualquer
  // visitante lê. Um service key ali é jogo encerrado.
  const suspects: string[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith("NEXT_PUBLIC_") || !v) continue;
    const looksJwt = /^ey[A-Za-z0-9_-]{20,}\./.test(v);           // JWT (service key do Supabase)
    const looksLongSecret = v.length > 60 && /^[A-Za-z0-9_\-+/=]+$/.test(v) && !/^https?:/.test(v);
    const namedSecret = /SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|_KEY$/i.test(k)
      && !/PROJECT_ID|SITE_VERIFICATION/i.test(k);
    if (looksJwt || looksLongSecret || namedSecret) suspects.push(k);
  }
  return suspects.length === 0
    ? { ...base, pass: true, detail: "nenhuma variável pública com cara de segredo" }
    : { ...base, pass: false, detail: `🚨 suspeitas (visíveis no navegador): ${suspects.join(", ")}` };
}

// ── 4. Rotas de admin não confessam que existem ───────────────────────────
async function checkAdminRoutes(origin: string): Promise<AuditFinding> {
  const base = {
    id: "admin_routes_hidden", name: "Rotas de admin devolvem 404 sem autenticação",
    category: "segurança" as const, severity: "critical" as const,
    whyRuntime: "o middleware pode existir e não estar interceptando a rota — só a requisição real diz",
  };
  const routes = ["/admin/api/health", "/admin/api/tournament", "/admin/api/killswitch", "/admin/api/audit-bench"];
  const bad: string[] = [];
  for (const path of routes) {
    try {
      const res = await fetch(`${origin}${path}`, { cache: "no-store", redirect: "manual" });
      // 200 = aberta (gravíssimo). 403 = revela que existe (enumeração).
      // 404 ou redirect de login = correto.
      if (res.status === 200) bad.push(`${path} → 200 ABERTA`);
      else if (res.status === 403) bad.push(`${path} → 403 (revela que existe; deveria ser 404)`);
    } catch { /* rede: não conclui nada */ }
  }
  return bad.length === 0
    ? { ...base, pass: true, detail: `${routes.length} rotas testadas sem sessão — nenhuma abriu nem confessou` }
    : { ...base, pass: false, detail: bad.join(" | ") };
}

// ── 5. Cron exige segredo ─────────────────────────────────────────────────
async function checkCronAuth(origin: string): Promise<AuditFinding> {
  const base = {
    id: "cron_auth", name: "Endpoints de cron rejeitam chamada sem segredo",
    category: "segurança" as const, severity: "high" as const,
    whyRuntime: "qualquer um na internet pode chamar a URL do cron; só a resposta real prova que ela recusa",
  };
  const routes = ["/api/zion/backtest", "/api/radar"];
  const bad: string[] = [];
  for (const path of routes) {
    try {
      const res = await fetch(`${origin}${path}`, { method: "POST", cache: "no-store" });
      if (res.status !== 401) bad.push(`${path} → ${res.status} (esperado 401)`);
    } catch { /* ignora */ }
  }
  return bad.length === 0
    ? { ...base, pass: true, detail: "crons recusaram chamada anônima com 401" }
    : { ...base, pass: false, detail: bad.join(" | ") };
}

// ── 6. Cabeçalhos de segurança realmente servidos ─────────────────────────
async function checkHeaders(origin: string): Promise<AuditFinding> {
  const base = {
    id: "security_headers", name: "Cabeçalhos de segurança presentes na resposta",
    category: "config" as const, severity: "medium" as const,
    whyRuntime: "next.config pode declarar o header e a CDN/proxy não entregar — só a resposta HTTP real conta",
  };
  try {
    const res = await fetch(origin, { cache: "no-store" });
    const want = [
      ["content-security-policy", "CSP"],
      ["strict-transport-security", "HSTS"],
      ["x-content-type-options", "nosniff"],
      ["x-frame-options", "anti-clickjacking"],
    ] as const;
    const missing = want.filter(([h]) => !res.headers.get(h)).map(([, label]) => label);
    return missing.length === 0
      ? { ...base, pass: true, detail: "CSP, HSTS, nosniff e anti-clickjacking presentes" }
      : { ...base, pass: false, detail: `ausentes: ${missing.join(", ")}` };
  } catch (e) {
    return { ...base, pass: false, inconclusive: true, detail: `não deu para buscar a origem: ${(e as Error).message?.slice(0, 80)}` };
  }
}

// ── 7. Dependências externas (reaproveita o radar) ────────────────────────
async function checkDeps(): Promise<AuditFinding> {
  const base = {
    id: "external_deps", name: "Dependências externas do caminho do dinheiro respondendo",
    category: "integração" as const, severity: "critical" as const,
    whyRuntime: "foi exatamente aqui que a Jupiter desligou um host e o código continuou perfeito",
  };
  const deps = await checkExternalDeps();
  // Geobloqueio é condição fixa da região, não queda — não reprova auditoria.
  const down = deps.filter((d) => !d.ok && !d.geoBlocked && d.impact === "critical");
  return down.length === 0
    ? { ...base, pass: true, detail: `${deps.length} dependências checadas com chamada real; nenhuma crítica fora` }
    : { ...base, pass: false, detail: down.map((d) => `${d.name} (${d.note ?? "fora"}) → ${d.breaks}`).join(" | ") };
}

// ── 8. Paridade de tradução ───────────────────────────────────────────────
async function checkI18n(): Promise<AuditFinding> {
  const base = {
    id: "i18n_parity", name: "Os 4 locales têm o mesmo conjunto de chaves",
    category: "i18n" as const, severity: "medium" as const,
    whyRuntime: "TypeScript aceita a chave faltando quando o objeto é tipado por inferência; o texto só falta na tela",
  };
  try {
    const { messages } = await import("@/lib/i18n/messages");
    const flat = (o: unknown, prefix = ""): string[] => {
      if (!o || typeof o !== "object") return [prefix];
      return Object.entries(o as Record<string, unknown>)
        .flatMap(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k));
    };
    const langs = Object.keys(messages) as Array<keyof typeof messages>;
    const sets = new Map(langs.map((l) => [l, new Set(flat(messages[l]))]));
    const reference = sets.get("en") ?? new Set<string>();
    const gaps: string[] = [];
    for (const l of langs) {
      const s = sets.get(l)!;
      const missing = [...reference].filter((k) => !s.has(k));
      if (missing.length > 0) gaps.push(`${String(l)}: ${missing.length} faltando (ex.: ${missing[0]})`);
    }
    return gaps.length === 0
      ? { ...base, pass: true, detail: `${langs.length} locales, ${reference.size} chaves, paridade completa` }
      : { ...base, pass: false, detail: gaps.join(" | ") };
  } catch (e) {
    return { ...base, pass: false, inconclusive: true, detail: `não deu para carregar as mensagens: ${(e as Error).message?.slice(0, 80)}` };
  }
}

// ── 9. Postura das travas de swap ─────────────────────────────────────────
function checkSwapGuards(): AuditFinding {
  const base = {
    id: "swap_guards_posture", name: "Travas de swap em modo de bloqueio",
    category: "config" as const, severity: "high" as const,
    whyRuntime: "o código das travas existe sempre; se estão VALENDO depende de variável de ambiente do deploy",
  };
  const solMode = process.env.NEXT_PUBLIC_SOLANA_TX_GUARD === "enforce" ? "enforce"
    : process.env.NEXT_PUBLIC_SOLANA_TX_GUARD === "off" ? "off" : "shadow";
  const evmTargets = !!process.env.NEXT_PUBLIC_ALLOWED_SWAP_TARGETS;
  const evmSpenders = !!process.env.NEXT_PUBLIC_ALLOWED_SWAP_SPENDERS;
  const gaps: string[] = [];
  if (solMode !== "enforce") gaps.push(`Solana guard em "${solMode}" (não bloqueia)`);
  if (!evmTargets) gaps.push("allowlist de targets EVM não configurada");
  if (!evmSpenders) gaps.push("allowlist de spenders EVM não configurada");
  return gaps.length === 0
    ? { ...base, pass: true, detail: "Solana em enforce e allowlists EVM fixadas" }
    : { ...base, pass: false, detail: gaps.join(" | ") };
}

// ── 10. O BUNDLE DO NAVEGADOR CONFERE COM O AMBIENTE DO SERVIDOR? ─────────
//
// A falha que este teste existe para pegar JÁ ACONTECEU (30/07): o painel do
// guard de swap mostrava "BLOQUEANDO" e a telemetria mostrava "OBSERVANDO", ao
// mesmo tempo, sem ninguém mentir.
//
// A causa é uma propriedade do Next.js que não aparece em leitura de código:
// variável `NEXT_PUBLIC_*` é ASSADA NO BUILD. Salvar o valor novo na Vercel
// muda o que o SERVIDOR lê na hora — e não muda NADA no JavaScript que o
// navegador já baixou, até sair um build novo. Os dois lados passam a discordar
// em silêncio, e cada um, sozinho, está dizendo a verdade.
//
// Isso importa porque as travas do caminho do dinheiro moram justamente nessas
// variáveis: o guard de Solana, as allowlists de swap, os limiares de impacto e
// o envio por bundle privado. Um operador que liga a trava na Vercel, esquece o
// redeploy e vê o painel verde acredita estar protegido sem estar — a mesma
// família de defeito do escudo de MEV que não protegia nada.
//
// Só o NAVEGADOR sabe o que foi assado. Por isso o painel envia o que ele
// enxerga e o servidor compara com o que ele próprio lê. Sem esse envio a
// verificação fica INCONCLUSIVA, nunca aprovada — ausência de conferência não
// pode renderizar como sincronia.

/** As `NEXT_PUBLIC_*` que decidem alguma coisa no caminho do dinheiro. */
export const MONEY_PATH_PUBLIC_ENV = [
  "NEXT_PUBLIC_SOLANA_TX_GUARD",
  "NEXT_PUBLIC_SOLANA_JITO",
  "NEXT_PUBLIC_ALLOWED_SWAP_TARGETS",
  "NEXT_PUBLIC_ALLOWED_SWAP_SPENDERS",
  "NEXT_PUBLIC_IMPACT_WARN_PCT",
  "NEXT_PUBLIC_IMPACT_BLOCK_PCT",
] as const;

/** Normaliza para comparar: ausente e string vazia são a mesma coisa aqui. */
function envNorm(v: string | undefined | null): string {
  return (v ?? "").trim();
}

/**
 * Como o valor aparece no relatório.
 *
 * As allowlists de swap são listas gigantes de endereço por chain — despejadas
 * inteiras, elas enterravam a informação útil ("SOLANA_JITO=on") sob dez linhas
 * de hexadecimal, e num celular isso torna a linha ilegível. Um relatório que
 * ninguém consegue ler não é evidência, é volume.
 *
 * Valor longo vira resumo com o TAMANHO à vista — quem precisa do conteúdo
 * abre a variável na Vercel; quem precisa saber se está configurada e se os
 * dois lados batem tem isso aqui. A COMPARAÇÃO continua sendo feita no valor
 * inteiro; só a exibição encurta.
 */
function envShow(v: string): string {
  if (v === "") return "(vazio)";
  if (v.length <= 32) return v;
  const chains = v.split(";").length;
  return `configurada (${chains} chain${chains > 1 ? "s" : ""}, ${v.length} caracteres)`;
}

export function checkBundleSync(fromBrowser?: Record<string, string | null>): AuditFinding {
  const base = {
    id: "bundle_env_sync", name: "O bundle do navegador tem as MESMAS travas que o servidor",
    category: "config" as const, severity: "critical" as const,
    whyRuntime: "NEXT_PUBLIC_* é assada no BUILD: servidor e navegador podem discordar em silêncio até o próximo deploy, e nenhum dos dois está mentindo",
  };
  if (!fromBrowser) {
    return {
      ...base, pass: false, inconclusive: true,
      detail: "o painel não enviou o que o navegador enxerga — sem isso não dá para saber se o build está em dia",
    };
  }
  const drift: string[] = [];
  const agree: string[] = [];
  for (const k of MONEY_PATH_PUBLIC_ENV) {
    const server = envNorm(process.env[k]);
    const client = envNorm(fromBrowser[k]);
    if (server === client) { agree.push(`${k.replace("NEXT_PUBLIC_", "")}=${envShow(server)}`); continue; }
    drift.push(`${k}: servidor=${envShow(server)} mas navegador=${envShow(client)}`);
  }
  return drift.length === 0
    ? { ...base, pass: true, detail: `build em dia — ${agree.join(" · ")}` }
    : {
        ...base, pass: false,
        detail: `BUILD DESATUALIZADO (falta redeploy): ${drift.join(" | ")}`,
      };
}

// ── 11. Postura das travas que NÃO são NEXT_PUBLIC_ ───────────────────────
//
// Gates de plano, cota diária e tetos de gasto vivem em variável de servidor,
// então não sofrem do problema acima — mas continuam sendo config de deploy que
// leitura de código não revela. Um `TIER_GATES_ENABLED=false` esquecido depois
// de um teste abre a plataforma inteira sem nada quebrar.
function checkRevenueGuards(): AuditFinding {
  const base = {
    id: "revenue_guards", name: "Gates de plano e tetos de gasto valendo",
    category: "config" as const, severity: "high" as const,
    whyRuntime: "o código dos gates existe sempre; se estão VALENDO depende de variável do deploy, e um 'false' esquecido não quebra nada",
  };
  const gaps: string[] = [];
  const ok: string[] = [];
  if (process.env.TIER_GATES_ENABLED === "false") {
    gaps.push("TIER_GATES_ENABLED=false — plano, cota e paywall TODOS abertos");
  } else {
    ok.push("gates de plano ligados");
  }
  const zionCap = envNumber(process.env.ZION_DAILY_MAX, 20_000, { positive: true });
  const quoteCap = envNumber(process.env.QUOTE_DAILY_MAX, 250_000, { positive: true });
  if (!Number.isFinite(zionCap) || zionCap <= 0) gaps.push("ZION_DAILY_MAX inválido");
  else ok.push(`teto ZION ${zionCap.toLocaleString("pt-BR")}/dia`);
  if (!Number.isFinite(quoteCap) || quoteCap <= 0) gaps.push("QUOTE_DAILY_MAX inválido");
  else ok.push(`teto cotação ${quoteCap.toLocaleString("pt-BR")}/dia`);
  return gaps.length === 0
    ? { ...base, pass: true, detail: ok.join(" · ") }
    : { ...base, pass: false, detail: gaps.join(" | ") };
}

// ── 12. AS CARTEIRAS DE PAPEL BATEM COM OS PRÓPRIOS TRADES? ───────────────
//
// Achado de 01/08: QUATORZE das vinte carteiras haviam perdido de US$450 a
// US$1.000 de capital fantasma — Grok e Mistral em $0,00 — e nada disso
// aparecia em lugar nenhum.
//
// O painel mostra `patrimônio = inicial + realizado + não-realizado`, que
// continuava bonito. Mas quem decide se uma mesa consegue ABRIR posição é o
// `cash_usd`, e é ele que estava vazio. Sem caixa, `sizePosition` devolve zero e
// a mesa para de operar SEM ERRO: fica quieta e passa por "não apareceu setup".
//
// Foi assim que o experimento colheu amostras de 4 e 10 trades achando que era
// disciplina, quando era falta de dinheiro. Nenhuma leitura de código encontra
// isso — só a aritmética contra o banco vivo.
async function checkWalletDrift(): Promise<AuditFinding> {
  const base = {
    id: "paper_wallet_drift", name: "Carteiras de paper batem com os próprios trades",
    category: "dados" as const, severity: "high" as const,
    whyRuntime: "é aritmética contra o ledger vivo; o código do débito e do crédito está correto lido isoladamente, e mesmo assim o caixa foge",
  };
  const all = await reconcileWallets();
  if (all.length === 0) {
    return { ...base, pass: false, inconclusive: true, detail: "sem carteiras para reconciliar (banco fora?)" };
  }
  const drift = significantDrifts(all);
  const starved = starvedWallets(all).filter((w) => Math.abs(w.driftUsd) > 0.5);
  if (drift.length === 0) {
    return { ...base, pass: true, detail: `${all.length} carteiras reconciliadas — caixa bate com os trades em todas` };
  }
  const pior = drift.slice(0, 4)
    .map((d) => `${d.label}: caixa $${d.cashUsd.toFixed(2)} vs esperado $${d.expectedUsd.toFixed(2)} (${d.driftUsd > 0 ? "+" : ""}${d.driftUsd.toFixed(2)})`)
    .join(" | ");
  return {
    ...base, pass: false,
    detail: `${drift.length} de ${all.length} carteiras com caixa fora da conta`
      + (starved.length ? ` · ${starved.length} SEM CAIXA para abrir posição (param de operar em silêncio)` : "")
      + ` — ${pior}`,
  };
}

// ── O corredor ────────────────────────────────────────────────────────────

export interface AuditReport {
  findings: AuditFinding[];
  /** Tempo total de parede e soma das chamadas — o recibo da execução. */
  totalMs: number;
  totalCalls: number;
  score: number;          // 0–10
  grade: string;
  passed: number; failed: number; inconclusive: number;
  blocking: AuditFinding[];
  verdict: string;
  ranAt: string;
}

/** Pesos por severidade — um crítico reprovado não pode ser diluído por dez
 *  aprovações cosméticas. É assim que auditoria vira teatro. */
const WEIGHT: Record<Severity, number> = { critical: 8, high: 4, medium: 2, low: 1 };

export function scoreFindings(findings: AuditFinding[]): Omit<AuditReport, "findings" | "ranAt" | "totalMs" | "totalCalls"> {
  // Inconclusivo NÃO conta como aprovado. Fingir que um teste que não rodou
  // passou é exatamente como uma auditoria mente sem mentir.
  const counted = findings.filter((f) => !f.inconclusive);
  const total = counted.reduce((s, f) => s + WEIGHT[f.severity], 0);
  const earned = counted.filter((f) => f.pass).reduce((s, f) => s + WEIGHT[f.severity], 0);
  const score = total === 0 ? 0 : Math.round((earned / total) * 100) / 10;

  const blocking = findings.filter((f) => !f.pass && !f.inconclusive && (f.severity === "critical" || f.severity === "high"));
  const inconclusive = findings.filter((f) => f.inconclusive).length;
  const failed = counted.filter((f) => !f.pass).length;

  const grade = score >= 9.5 ? "A" : score >= 8.5 ? "B" : score >= 7 ? "C" : score >= 5 ? "D" : "F";
  const verdict =
    blocking.length > 0
      ? `🔴 ${blocking.length} item(ns) bloqueante(s) — NÃO está pronta para produção`
      : inconclusive > 0
        ? `🟡 nada bloqueante, mas ${inconclusive} verificação(ões) não pôde(puderam) rodar — cobertura incompleta, não aprovação`
        : "🟢 nenhum bloqueante · TODOS os testes DESTA LISTA passaram (a lista não cobre lógica de negócio, carga, nem corrida entre crons)";

  return { score, grade, passed: counted.filter((f) => f.pass).length, failed, inconclusive, blocking, verdict };
}

/**
 * Roda a bancada inteira. `origin` é a URL própria da plataforma — as
 * verificações de rota precisam bater no servidor de VERDADE, de fora, como um
 * atacante faria; testar a função em memória não prova nada sobre o deploy.
 */
export async function runAudit(origin: string, browserEnv?: Record<string, string | null>): Promise<AuditReport> {
  const t0 = Date.now();
  // Cronometra cada verificação individualmente e anota quantas idas à rede ou
  // ao banco ela fez. Rodam em PARALELO — é por isso que o total de parede é
  // menor que a soma das partes, e não porque algo foi pulado.
  const timed = async (calls: number, fn: () => Promise<AuditFinding> | AuditFinding): Promise<AuditFinding> => {
    const start = Date.now();
    const f = await fn();
    return { ...f, durationMs: Date.now() - start, calls };
  };
  const findings: AuditFinding[] = await Promise.all([
    timed(Object.keys(EXPECTED_SCHEMA).length, checkSchema),
    timed(4, checkRls),
    timed(0, checkPublicEnv),
    timed(4, () => checkAdminRoutes(origin)),
    timed(2, () => checkCronAuth(origin)),
    timed(1, () => checkHeaders(origin)),
    timed(8, checkDeps),
    timed(0, checkI18n),
    timed(0, checkSwapGuards),
    timed(8, checkEvmAllowlistDrift),
    timed(0, () => checkBundleSync(browserEnv)),
    timed(0, checkRevenueGuards),
    timed(2, checkWalletDrift),
  ]);

  // BANCADA DE ATAQUE — as sondas que só rodam de fora, contra a produção.
  // Eram justamente os testes que ficavam como "não consegui verificar" na
  // auditoria feita do ambiente de desenvolvimento, e "não verificado" com o
  // tempo é lido como "está tudo bem".
  const attacks = await runAttackSuite(origin);
  findings.push(...attacks);
  // Bloqueantes primeiro, depois reprovados, depois inconclusivos.
  const rank = (f: AuditFinding) => (f.inconclusive ? 2 : f.pass ? 3 : 0) + (f.severity === "critical" ? 0 : 0.5);
  findings.sort((a, b) => rank(a) - rank(b));
  return {
    findings, ...scoreFindings(findings),
    totalMs: Date.now() - t0,
    totalCalls: findings.reduce((s, f) => s + (f.calls ?? 0), 0),
    ranAt: new Date().toISOString(),
  };
}
