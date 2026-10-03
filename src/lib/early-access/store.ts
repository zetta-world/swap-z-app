import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import type { DadosInscricao } from "./validate";
import type { Estado } from "./estados";

/**
 * ACESSO AO BANCO DO EARLY ACCESS — só servidor.
 *
 * ⚠️ AS TABELAS FICAM FORA DO `Database` de `supabase/types.ts` de propósito.
 * O genérico do supabase-js tem teto de profundidade e, passado dele, devolve
 * `never` em OUTRAS tabelas (docs/ESTADO-ATUAL.md §5.3). O contorno da casa é o
 * de `ulfhednar/mensagens.ts` e `cex/conexoes.ts`: cliente cru, nome de tabela
 * `as never`, e as linhas tipadas aqui.
 *
 * ⚠️ NADA AQUI ESCREVE DIRETO NAS TABELAS DO EARLY ACCESS. A migration 0068 dá
 * ao `service_role` só SELECT em `early_access_signups`; toda escrita passa por
 * `early_access_inscrever` / `early_access_transicionar` (e, na Fase 2, as RPCs
 * de verificação da 0069), que fazem a mudança e o evento de audit na MESMA
 * transação. O token de verificação chega aqui só como HASH.
 *
 * ⚠️ NUNCA importar de componente cliente (trava `nao-vaza-para-o-cliente`).
 */

interface Resp<T = unknown> {
  data:   T | null;
  error:  { message: string; code?: string } | null;
  count?: number | null;
}
interface Consulta extends PromiseLike<Resp> {
  eq:     (c: string, v: unknown) => Consulta;
  is:     (c: string, v: null) => Consulta;
  not:    (c: string, op: string, v: unknown) => Consulta;
  like:   (c: string, padrao: string) => Consulta;
  gte:    (c: string, v: unknown) => Consulta;
  order:  (c: string, o?: { ascending?: boolean }) => Consulta;
  range:  (de: number, ate: number) => Consulta;
  limit:  (n: number) => Consulta;
  maybeSingle: () => PromiseLike<Resp>;
}
type ClienteCru = {
  from: (t: never) => {
    select: (c: string, o?: { count?: "exact"; head?: boolean }) => Consulta;
    insert: (v: unknown) => PromiseLike<Resp>;
  };
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<Resp>;
};

const SIGNUPS  = "early_access_signups"  as never;
const EVENTS   = "early_access_events"   as never;
const CONSENTS = "early_access_consents" as never;
const AUDIT    = "admin_audit_log"       as never;

function cru(): ClienteCru | null {
  return getSupabaseAdmin() as unknown as ClienteCru | null;
}

// ── inscrição ──────────────────────────────────────────────────────────────

export type ResultadoInscricao =
  | { ok: true; resultado: "criado" | "existente"; envio: boolean }
  | { ok: false; erro: "sem_banco" | "erro_banco" };

/**
 * Chama a RPC. O RESULTADO É PARA USO INTERNO: a rota pública responde igual
 * para "criado" e "existente" (anti-enumeração). `envio` diz só se o banco
 * aceitou o hash do token — e portanto se a rota deve mandar o email com o
 * token cru que tem em memória (0069: cooldown, cap, verificado, bloqueado e
 * suprimido devolvem `false`).
 */
export async function inscrever(
  d: DadosInscricao, ipHmac: string | null, candidatos: string[], tokenHash: string | null,
): Promise<ResultadoInscricao> {
  const db = cru();
  if (!db) return { ok: false, erro: "sem_banco" };
  try {
    const { data, error } = await db.rpc("early_access_inscrever", {
      p_email:              d.email,
      p_display_name:       d.displayName,
      p_country:            d.country,
      p_wallet_address:     d.walletAddress,
      p_wallet_chain:       d.walletChain,
      p_telegram_handle:    d.telegram,
      p_x_handle:           d.x,
      p_referral_code_in:   d.referralCode,
      p_codigos_candidatos: candidatos,
      p_utm_source:         d.utmSource,
      p_utm_medium:         d.utmMedium,
      p_utm_campaign:       d.utmCampaign,
      p_utm_content:        d.utmContent,
      p_utm_term:           d.utmTerm,
      p_landing_path:       d.landingPath,
      p_referrer_host:      d.referrerHost,
      p_source:             d.source,
      p_terms_version:      d.termsVersion,
      p_privacy_version:    d.privacyVersion,
      p_marketing_opt_in:   d.marketingOptIn,
      p_ip_hmac:            ipHmac,
      p_locale:             d.locale,
      p_token_hash:         tokenHash,
    });
    const r = data as { resultado?: unknown; envio?: unknown } | null;
    if (error || !r || (r.resultado !== "criado" && r.resultado !== "existente") || typeof r.envio !== "boolean") {
      return { ok: false, erro: "erro_banco" };
    }
    return { ok: true, resultado: r.resultado, envio: r.envio };
  } catch {
    return { ok: false, erro: "erro_banco" };
  }
}

// ── verificação de email (Fase 2, 0069) ─────────────────────────────────────
//
// ⚠️ Toda decisão (validade, TTL, uso único, um ativo por inscrição, cooldown,
// purga) é da RPC. Aqui só há transporte e a conferência do FORMATO da
// resposta: resposta inesperada vira erro, nunca "deu certo".

/** Uma RPC que devolve um valor; exceção e erro viram `null` + `erro`. */
async function rpc(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false }> {
  const db = cru();
  if (!db) return { ok: false };
  try {
    const { data, error } = await db.rpc(fn, args);
    return error ? { ok: false } : { ok: true, data };
  } catch {
    return { ok: false };
  }
}

/**
 * EA2-IA01: falha leva a classificação EXPLÍCITA do adaptador. `transitorio:
 * false` vira 'dead' no banco — terminal, nunca volta à fila de retry.
 */
export async function registrarEnvio(
  tokenHash: string, ok: boolean, erro: string | null, providerId: string | null, transitorio: boolean | null,
): Promise<boolean> {
  const r = await rpc("early_access_registrar_envio", {
    p_token_hash: tokenHash, p_ok: ok, p_erro: erro, p_provider_id: providerId, p_transitorio: transitorio,
  });
  return r.ok && r.data === true;
}

export async function pendentesDeEnvio(limite: number): Promise<string[] | null> {
  const r = await rpc("early_access_pendentes_de_envio", { p_limite: limite });
  if (!r.ok || !Array.isArray(r.data)) return null;
  return r.data.filter((x): x is string => typeof x === "string");
}

/** Revoga o token que não chegou e grava o hash do próximo. Devolve para onde mandar. */
export async function reemitir(id: string, tokenHash: string): Promise<{ email: string; locale: string } | null> {
  const r = await rpc("early_access_reemitir", { p_id: id, p_token_hash: tokenHash });
  const d = (r.ok ? r.data : null) as { email?: unknown; locale?: unknown } | null;
  if (!d || typeof d.email !== "string" || typeof d.locale !== "string") return null;
  return { email: d.email, locale: d.locale };
}

export interface PreviewToken {
  display_name: string; country: string; terms_version: string; privacy_version: string;
}

export async function previewToken(tokenHash: string): Promise<{ ok: true; preview: PreviewToken | null } | { ok: false }> {
  const r = await rpc("early_access_token_preview", { p_token_hash: tokenHash });
  if (!r.ok) return { ok: false };
  const p = r.data as Partial<PreviewToken> | null;
  if (p === null) return { ok: true, preview: null };
  if (typeof p !== "object" || typeof p.display_name !== "string" || typeof p.country !== "string"
      || typeof p.terms_version !== "string" || typeof p.privacy_version !== "string") return { ok: false };
  return { ok: true, preview: p as PreviewToken };
}

export type ResultadoConfirmacao =
  | { ok: true; resultado: "confirmado"; referralCode: string }
  | { ok: true; resultado: "ja_confirmado" | "invalido" }
  | { ok: false; erro: "correcao_invalida" | "versao_divergente" | "erro_banco" };

/**
 * EA2-A02: `marketingOptIn` é a escolha EXPLÍCITA do titular na confirmação;
 * `null` (sem escolha) = OPT-OUT no banco. A declaração do formulário nunca
 * chega aqui.
 */
export async function confirmarEmail(
  tokenHash: string,
  /** EA2-IA05: as versões que a tela APRESENTOU (vindas da preview); o banco confere. */
  versoes: { termos: string; privacidade: string },
  displayName: string | null, country: string | null, ipHmac: string | null,
  marketingOptIn: boolean | null,
): Promise<ResultadoConfirmacao> {
  const db = cru();
  if (!db) return { ok: false, erro: "erro_banco" };
  try {
    const { data, error } = await db.rpc("early_access_confirmar_email", {
      p_token_hash: tokenHash, p_versao_termos: versoes.termos, p_versao_privacidade: versoes.privacidade,
      p_display_name: displayName, p_country: country, p_ip_hmac: ipHmac,
      p_marketing_opt_in: marketingOptIn,
    });
    if (error) {
      if (error.message.includes("early_access_correcao_invalida")) return { ok: false, erro: "correcao_invalida" };
      if (error.message.includes("early_access_versao_divergente")) return { ok: false, erro: "versao_divergente" };
      return { ok: false, erro: "erro_banco" };
    }
    const r = data as { resultado?: unknown; referral_code?: unknown } | null;
    if (r?.resultado === "confirmado" && typeof r.referral_code === "string") {
      return { ok: true, resultado: "confirmado", referralCode: r.referral_code };
    }
    if (r?.resultado === "ja_confirmado" || r?.resultado === "invalido") return { ok: true, resultado: r.resultado };
    return { ok: false, erro: "erro_banco" };
  } catch {
    return { ok: false, erro: "erro_banco" };
  }
}

export async function recusarEmail(tokenHash: string): Promise<"recusado" | "invalido" | null> {
  const r = await rpc("early_access_recusar_email", { p_token_hash: tokenHash });
  return r.ok && (r.data === "recusado" || r.data === "invalido") ? r.data : null;
}

export async function purgarNaoVerificados(limite: number): Promise<number | null> {
  const r = await rpc("early_access_purgar_nao_verificados", { p_limite: limite });
  return r.ok && typeof r.data === "number" && Number.isInteger(r.data) ? r.data : null;
}

export type ResultadoWebhook = "processado" | "duplicado" | "sem_alvo" | "ignorado";

export async function registrarWebhook(
  eventoId: string, tipo: string, providerMessageId: string | null,
): Promise<ResultadoWebhook | null> {
  const r = await rpc("early_access_registrar_webhook", {
    p_evento_id: eventoId, p_tipo: tipo, p_provider_message_id: providerMessageId,
  });
  const ok = ["processado", "duplicado", "sem_alvo", "ignorado"];
  return r.ok && typeof r.data === "string" && ok.includes(r.data) ? (r.data as ResultadoWebhook) : null;
}

// ── leitura (admin) ────────────────────────────────────────────────────────

/** Colunas da LISTA. Sem ip_hmac: pseudônimo de abuso não é dado de triagem. */
export const COLUNAS_LISTA =
  "id, email_normalized, display_name, country, status, status_reason, wallet_address, wallet_chain, "
  + "wallet_verified_at, email_verified_at, converted_at, referral_code, referred_by_signup_id, "
  + "referral_flag, utm_source, utm_medium, utm_campaign, source, marketing_opt_in, created_at, updated_at, "
  + "email_suppressed_at, email_suppression_reason, marketing_efetivo, marketing_escolhido_em, marketing_elegivel";

export interface LinhaInscricao {
  id: string; email_normalized: string; display_name: string; country: string;
  status: Estado; status_reason: string | null;
  wallet_address: string | null; wallet_chain: "evm" | "solana" | null;
  wallet_verified_at: string | null; email_verified_at: string | null; converted_at: string | null;
  referral_code: string; referred_by_signup_id: string | null; referral_flag: string | null;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
  source: string; marketing_opt_in: boolean; created_at: string; updated_at: string;
  email_suppressed_at: string | null; email_suppression_reason: "bounced" | "complained" | null;
  /**
   * EA2-A02: `marketing_opt_in` acima é só a DECLARAÇÃO PROVISÓRIA do formulário
   * — nunca base para envio. Consentimento de marketing que vale = `marketing_efetivo`
   * (escolha explícita do titular verificado; sem escolha = false).
   */
  marketing_efetivo: boolean; marketing_escolhido_em: string | null;
  /**
   * EA2-IA04: o ÚNICO campo que autoriza marketing — consentimento efetivo E
   * endereço não suprimido (bounce/complaint). Gerado pelo banco.
   */
  marketing_elegivel: boolean;
}

export interface Filtros {
  status?:    Estado;
  country?:   string;
  hasWallet?: boolean;
  /** Email verificado (Fase 2). */
  verified?:  boolean;
  /** Prefixo do email NORMALIZADO, já validado pela rota. */
  q?:         string;
  limit:      number;
  offset:     number;
}

/** `%`, `_` e `\` são curingas do LIKE — escapados para buscar literal. */
export function escaparLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function aplicarFiltros(c: Consulta, f: Omit<Filtros, "limit" | "offset">): Consulta {
  let q = c;
  if (f.status) q = q.eq("status", f.status);
  if (f.country) q = q.eq("country", f.country);
  if (f.hasWallet === true) q = q.not("wallet_address", "is", null);
  if (f.hasWallet === false) q = q.is("wallet_address", null);
  if (f.verified === true) q = q.not("email_verified_at", "is", null);
  if (f.verified === false) q = q.is("email_verified_at", null);
  if (f.q) q = q.like("email_normalized", `${escaparLike(f.q)}%`);
  return q;
}

export async function listar(f: Filtros): Promise<
  { ok: true; linhas: LinhaInscricao[]; total: number } | { ok: false; erro: string }
> {
  const db = cru();
  if (!db) return { ok: false, erro: "sem_banco" };
  const { data, error, count } = await aplicarFiltros(
    db.from(SIGNUPS).select(COLUNAS_LISTA, { count: "exact" }), f,
  ).order("created_at", { ascending: false }).range(f.offset, f.offset + f.limit - 1);
  if (error) return { ok: false, erro: "erro_banco" };
  return { ok: true, linhas: (data ?? []) as LinhaInscricao[], total: count ?? 0 };
}

export async function detalhe(id: string): Promise<
  { ok: true; linha: LinhaInscricao | null; eventos: unknown[]; consentimentos: unknown[] } | { ok: false; erro: string }
> {
  const db = cru();
  if (!db) return { ok: false, erro: "sem_banco" };
  const [l, e, c] = await Promise.all([
    db.from(SIGNUPS).select(`${COLUNAS_LISTA}, telegram_handle, x_handle, utm_content, utm_term, landing_path, `
      + "referrer_host, terms_version, privacy_version, accepted_at").eq("id", id).maybeSingle(),
    db.from(EVENTS).select("id, kind, from_status, to_status, actor, reason, created_at")
      .eq("signup_id", id).order("created_at", { ascending: true }).limit(500),
    db.from(CONSENTS).select("id, kind, version, granted, source, created_at")
      .eq("signup_id", id).order("created_at", { ascending: true }).limit(100),
  ]);
  if (l.error || e.error || c.error) return { ok: false, erro: "erro_banco" };
  return { ok: true, linha: (l.data ?? null) as LinhaInscricao | null, eventos: e.data as unknown[] ?? [], consentimentos: c.data as unknown[] ?? [] };
}

export interface Metricas {
  total: number; ultimas24h: number; ultimos7d: number;
  porStatus: Record<Estado, number>;
  /** Fase 2: com posse de email provada / com envio suprimido (bounce/complaint). */
  verificados: number; suprimidos: number;
}

export async function metricas(): Promise<{ ok: true; m: Metricas } | { ok: false; erro: string }> {
  const db = cru();
  if (!db) return { ok: false, erro: "sem_banco" };
  const contar = (f?: (c: Consulta) => Consulta) => {
    const base = db.from(SIGNUPS).select("id", { count: "exact", head: true });
    return f ? f(base) : base;
  };
  const agora = Date.now();
  const r = await Promise.all([
    contar(),
    contar((c) => c.gte("created_at", new Date(agora - 86_400_000).toISOString())),
    contar((c) => c.gte("created_at", new Date(agora - 7 * 86_400_000).toISOString())),
    contar((c) => c.eq("status", "pending")),
    contar((c) => c.eq("status", "approved")),
    contar((c) => c.eq("status", "rejected")),
    contar((c) => c.eq("status", "blocked")),
    contar((c) => c.not("email_verified_at", "is", null)),
    contar((c) => c.not("email_suppressed_at", "is", null)),
  ]);
  // ⚠️ Uma contagem que falhou NÃO vira zero: zero é informação, erro é falta dela.
  if (r.some((x) => x.error || typeof x.count !== "number")) return { ok: false, erro: "erro_banco" };
  const n = r.map((x) => x.count as number);
  return {
    ok: true,
    m: {
      total: n[0], ultimas24h: n[1], ultimos7d: n[2],
      porStatus: { pending: n[3], approved: n[4], rejected: n[5], blocked: n[6] },
      verificados: n[7], suprimidos: n[8],
    },
  };
}

// ── transição (admin) ──────────────────────────────────────────────────────

export const ERROS_TRANSICAO = [
  "early_access_nao_encontrado", "early_access_transicao_proibida",
  "early_access_motivo_obrigatorio", "early_access_ja_convertido", "early_access_ator_obrigatorio",
  // 0069 / D-4: aprovar exige email verificado
  "early_access_email_nao_verificado",
] as const;
export type ErroTransicao = (typeof ERROS_TRANSICAO)[number] | "sem_banco" | "erro_banco";

/**
 * ⚠️ O AUDIT É A RPC, NÃO ESTA FUNÇÃO. `early_access_transicionar` trava a
 * linha, valida, atualiza e grava o evento numa transação só: se o evento não
 * for gravado, o status não muda. `ok: true` aqui só sai quando a RPC
 * devolveu o par de/para — e é DEPOIS disso que a rota espelha no
 * `admin_audit_log`.
 */
export async function transicionar(
  id: string, para: Estado, ator: string, motivo: string | null,
): Promise<{ ok: true; de: Estado; para: Estado } | { ok: false; erro: ErroTransicao }> {
  const db = cru();
  if (!db) return { ok: false, erro: "sem_banco" };
  try {
    const { data, error } = await db.rpc("early_access_transicionar", {
      p_id: id, p_para: para, p_ator: ator, p_motivo: motivo,
    });
    if (error) {
      const conhecido = ERROS_TRANSICAO.find((c) => error.message.includes(c));
      return { ok: false, erro: conhecido ?? "erro_banco" };
    }
    const r = data as { de?: unknown; para?: unknown } | null;
    if (!r || typeof r.de !== "string" || r.para !== para) return { ok: false, erro: "erro_banco" };
    return { ok: true, de: r.de as Estado, para };
  } catch {
    return { ok: false, erro: "erro_banco" };
  }
}

// ── export (admin) ─────────────────────────────────────────────────────────

/** Contagem EXATA de inscrições (o conjunto que o export entrega). */
export async function contarInscricoes(): Promise<{ ok: true; total: number } | { ok: false }> {
  const db = cru();
  if (!db) return { ok: false };
  try {
    const { error, count } = await db.from(SIGNUPS).select("id", { count: "exact", head: true });
    if (error || typeof count !== "number") return { ok: false };
    return { ok: true, total: count };
  } catch {
    return { ok: false };
  }
}

/**
 * Lê até `maxLinhas` linhas.
 *
 * ⚠️ F-08: `selectAllRows` PARA em silêncio no `maxRows` dele (100 000). Quem
 * chama passa `teto + 1` e confere: se voltar mais que o teto, o conjunto não
 * cabe e o export é RECUSADO — nunca entregue pela metade.
 * `selectAllRows` também LANÇA em falha de página em vez de devolver parcial.
 */
export async function lerTudoParaExport(maxLinhas: number): Promise<LinhaInscricao[]> {
  const db = cru();
  if (!db) throw new Error("sem_banco");
  return selectAllRows<LinhaInscricao>((de, ate) =>
    db.from(SIGNUPS).select(COLUNAS_LISTA)
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .range(de, ate) as unknown as PromiseLike<{ data: LinhaInscricao[] | null; error?: { message?: string } | null }>,
    1000, maxLinhas,
  );
}

/**
 * Registra o export NO LOG DE ADMIN e diz se gravou.
 *
 * ⚠️ NÃO É `logAdminAction`: aquele engole o erro (é best-effort de
 * propósito). Export de dado pessoal sem registro não pode acontecer, então
 * aqui o resultado do insert é conferido e a rota recusa o arquivo se falhar.
 */
export async function registrarExport(
  ator: string, linhas: number, opcoes: { email: boolean; identidade: boolean },
): Promise<boolean> {
  const db = cru();
  if (!db) return false;
  try {
    const { error } = await db.from(AUDIT).insert({
      actor_wallet: ator, action: "early_access.export", target: null,
      payload: { linhas, com_email: opcoes.email, com_identidade: opcoes.identidade },
    });
    return !error;
  } catch {
    return false;
  }
}
