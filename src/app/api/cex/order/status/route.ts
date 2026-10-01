import { NextRequest, NextResponse } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { fetchCexOrderStatus } from "@/lib/cex/server";
import { classifyCexError, sanitizeUpstreamMessage, statusForError } from "@/lib/cex/errors";
import { type CexId, type CexCredentials, SUPPORTED_CEX_IDS, CEX_META } from "@/lib/cex/types";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { intentPorId } from "@/lib/cex/execucao/intents";
import { reconciliarIntent } from "@/lib/cex/execucao/reconciliador";
import { ehTerminal } from "@/lib/cex/execucao/estados";
import { impressaoDaCredencial, impressaoConfere } from "@/lib/cex/fingerprint";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const VALID_EXCHANGES = new Set<CexId>(SUPPORTED_CEX_IDS);
// The autopilot polls one order every 5-10 s until it closes. Generous
// burst limit so two cross-CEX legs polling in parallel never trip 429.
const RL_OPTS = { windowMs: 60_000, max: 60 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BodyShape {
  exchange?:  string;
  orderId?:   string;
  symbol?:    string;
  /** Modo RECOVERY (A80/A102): reconciliar um intent durável pelo id. */
  intentId?:  string;
  apiKey:     string;
  apiSecret:  string;
  passphrase?: string;
}

/**
 * POST /api/cex/order/status
 *
 * Dois modos, ambos SOMENTE LEITURA — nenhum dinheiro se move aqui:
 *
 * 1. `{exchange, orderId, symbol, credenciais}` — proxy de leitura ccxt por
 *    id+symbol. Usado pelo poller do loss-stop do autopilot.
 *
 * 2. `{intentId, credenciais}` — RECOVERY REAL (achados A80/A102): reconcilia
 *    o intent durável contra a corretora (a mesma máquina do reconciliador do
 *    cron) e responde com o que ficou gravado no livro. A autoridade sobre
 *    venue/símbolo/ordem é o INTENT, não o body. A credencial do body é usada
 *    EXCLUSIVAMENTE para leitura — este caminho nunca envia ordem.
 */
export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const rl = await rateLimitDurable(`cex_order_status:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: BodyShape;
  try {
    body = await req.json() as BodyShape;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (body.intentId != null) return recoveryPorIntent(body);
  return statusPorOrderId(body);
}

/** Validação da credencial de leitura, comum aos dois modos. */
function credenciaisValidas(body: BodyShape, exchange?: CexId):
  { ok: true; creds: CexCredentials } | { ok: false; res: NextResponse } {
  const ruim = (error: string) => ({ ok: false as const,
    res: NextResponse.json({ ok: false, error }, { status: 400 }) });
  if (typeof body.apiKey !== "string" || body.apiKey.length < 8 || body.apiKey.length > 200) {
    return ruim("invalid_api_key");
  }
  if (typeof body.apiSecret !== "string" || body.apiSecret.length < 8 || body.apiSecret.length > 600) {
    return ruim("invalid_api_secret");
  }
  if (exchange && CEX_META[exchange].needsPassphrase
      && (!body.passphrase || typeof body.passphrase !== "string")) {
    return ruim(`passphrase_required_for_${exchange}`);
  }
  return { ok: true, creds: {
    apiKey: body.apiKey, apiSecret: body.apiSecret, passphrase: body.passphrase,
  } };
}

/** Modo 1 — o proxy de leitura por orderId + symbol (inalterado). */
async function statusPorOrderId(body: BodyShape): Promise<NextResponse> {
  const exchange = body.exchange?.toLowerCase?.() as CexId;
  if (!VALID_EXCHANGES.has(exchange)) {
    return NextResponse.json({ ok: false, error: "invalid_exchange" }, { status: 400 });
  }
  if (typeof body.orderId !== "string" || body.orderId.length < 1 || body.orderId.length > 120) {
    return NextResponse.json({ ok: false, error: "invalid_order_id" }, { status: 400 });
  }
  if (typeof body.symbol !== "string" || !/^[A-Z0-9]{2,20}[\/\-][A-Z0-9]{2,20}$/i.test(body.symbol)) {
    return NextResponse.json({ ok: false, error: "invalid_symbol" }, { status: 400 });
  }
  const v = credenciaisValidas(body, exchange);
  if (!v.ok) return v.res;
  const creds = v.creds;

  try {
    const order = await fetchCexOrderStatus(exchange, creds, body.orderId!, body.symbol!);
    return NextResponse.json(
      { ok: true, exchange, order, fetchedAt: Date.now() },
      { headers: { "Cache-Control": "no-store, no-transform" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[cex/order/status]", exchange, body.symbol, body.orderId, "failed:", msg.slice(0, 120));
    const code = classifyCexError(msg);
    const detail = sanitizeUpstreamMessage(msg, body.apiKey!);
    return NextResponse.json(
      { ok: false, error: code, detail },
      { status: statusForError(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}

/**
 * Modo 2 — ⚠️⚠️ O RECOVERY REAL POR INTENT (A80/A102).
 *
 * O que este caminho substitui: depois de um timeout, o cliente ficava sem
 * nenhuma resposta — "a ordem existe?" não tinha onde ser perguntada, e a
 * saída insegura era REENVIAR (compra dobrada) ou desistir (venda perdida).
 *
 * A sequência é a do reconciliador, com a autoridade no LIVRO:
 *
 *   1. o intent existe? Não → 404. Não deu para ler → erro honesto;
 *   2. venue/símbolo/ordem vêm do INTENT — o body não sobrepõe nada. Intent de
 *      piloto (session_id/conexao_id) é recusado aqui: o caminho dele é a
 *      sessão, que tem a credencial no cofre;
 *   3. a credencial do body só LÊ: `reconciliarIntent` nunca envia ordem;
 *   4. relê-se o intent e responde-se o estado do LIVRO: FILLED com os
 *      números reais, terminal com o estado, dúvida com 202 "não reenvie";
 *   5. credencial recusada/leitura falha → ERRO honesto. NUNCA se marca
 *      FAILED e NUNCA se diz "a ordem não existe" — não se sabe;
 *   6. a resposta é mínima: estado e números DESTE intent. Nada de secrets,
 *      carteiras ou intents alheios.
 */
async function recoveryPorIntent(body: BodyShape): Promise<NextResponse> {
  const intentId = String(body.intentId);
  if (!UUID_RE.test(intentId)) {
    return NextResponse.json({ ok: false, error: "invalid_intent_id" }, { status: 400 });
  }
  const v = credenciaisValidas(body);
  if (!v.ok) return v.res;
  const creds = v.creds;

  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ ok: false, error: "banco_indisponivel" }, { status: 503 });
  }

  // ── 1. O intent ──
  const intent = await intentPorId(db, intentId);
  if (intent === undefined) {
    // ⚠️ Falha de leitura NÃO é "não existe".
    return NextResponse.json({ ok: false, error: "leitura_do_livro_falhou" }, { status: 502 });
  }
  if (intent === null) {
    return NextResponse.json({ ok: false, error: "intent_nao_encontrado" }, { status: 404 });
  }

  // ── 2. A autoridade é o intent ──
  if (intent.session_id || intent.conexao_id) {
    return NextResponse.json({ ok: false, error: "use_a_sessao",
      detail: "este intent pertence a uma sessao/conexao — a reconciliacao dele "
        + "acontece pela sessao, com a credencial guardada no cofre",
    }, { status: 409 });
  }
  const exchange = intent.exchange_id.toLowerCase() as CexId;
  if (!VALID_EXCHANGES.has(exchange)) {
    return NextResponse.json({ ok: false, error: "exchange_do_intent_invalida" }, { status: 409 });
  }
  if (body.exchange && body.exchange.toLowerCase() !== exchange) {
    // ⚠️ O body não sobrepõe o livro: divergência é recusa, não correção.
    return NextResponse.json({ ok: false, error: "exchange_divergente",
      detail: "a exchange informada diverge da registrada no intent",
    }, { status: 409 });
  }
  if (CEX_META[exchange].needsPassphrase
      && (!body.passphrase || typeof body.passphrase !== "string")) {
    return NextResponse.json({ ok: false, error: `passphrase_required_for_${exchange}` }, { status: 400 });
  }

  /**
   * ── 2.5. ⚠️⚠️ O VÍNCULO CREDENCIAL ↔ INTENT (A120) — ANTES DE TUDO ──
   *
   * Até aqui NADA tocou na venue nem no livro, e é exatamente aqui que o
   * gate mora: o recovery reconciliava o intent com QUALQUER credencial
   * válida apresentada — quem soubesse o `intentId` reconciliava (e mutava)
   * o livro alheio com a PRÓPRIA chave.
   *
   *   · intent sem fingerprint (histórico, ou autopilot/DCA — esses já saíram
   *     no `use_a_sessao` acima) → 409 `recovery_not_bound`: fail-closed, o
   *     legado não reconcilia às cegas;
   *   · fingerprint não confere → 403 `credential_mismatch`: ZERO fetchOrder,
   *     ZERO fetchMyTrades, ZERO reconciliarIntent, ZERO UPDATE e ZERO
   *     reconcile_attempt — o intent fica byte a byte como estava;
   *   · confere → o fluxo do Round 3 segue INALTERADO.
   *
   * ⚠️ O fingerprint NUNCA é lido do body (`body.credentialFingerprint` não
   * existe para este código): quem apresenta o próprio fingerprint estaria se
   * autoautorizando. E ele NUNCA aparece na resposta.
   */
  if (intent.credential_fingerprint == null) {
    return NextResponse.json(
      { ok: false, error: "recovery_not_bound",
        detail: "este intent nao tem vinculo de credencial (anterior ao A120 "
          + "ou de sessao/cofre) — o recovery por intentId nao reconcilia sem "
          + "prova de que a credencial e a mesma que criou a ordem" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  let impressaoApresentada: string;
  try {
    impressaoApresentada = impressaoDaCredencial(intent.exchange_id, body.apiKey);
  } catch {
    // ⚠️ Env de HMAC ausente no SERVIDOR: configuração quebrada não é
    // credencial errada — fail-closed, sem tocar na venue.
    return NextResponse.json({ ok: false, error: "server_configuration_error" },
      { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  if (!impressaoConfere(impressaoApresentada, intent.credential_fingerprint)) {
    return NextResponse.json(
      { ok: false, error: "credential_mismatch",
        detail: "a credencial apresentada nao e a mesma que criou esta ordem" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  // ── 3. Reconcilia — a credencial só lê; este caminho NUNCA envia ordem ──
  let rec;
  try {
    rec = await reconciliarIntent({ db, credenciais: async () => creds }, intent);
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    return NextResponse.json(
      { ok: false, error: "reconciliacao_falhou",
        detail: sanitizeUpstreamMessage(msg, creds.apiKey) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  // ── 5. Leitura falhou = erro honesto, nunca "a ordem não existe" ──
  if (rec.leituraFalhou) {
    const code = classifyCexError(rec.detalhe);
    const status = statusForError(code);
    return NextResponse.json(
      { ok: false, error: code === "order_not_found" ? "leitura_na_venue_falhou" : code,
        detail: sanitizeUpstreamMessage(rec.detalhe, creds.apiKey),
        // ⚠️ Nada foi concluído sobre a ordem — e o intent NÃO foi marcado FAILED.
        mensagem: "nao foi possivel ler a corretora; o estado do intent nao mudou. "
          + "Confira a credencial e tente novamente — NAO reenvie a ordem.",
      },
      // 401 aqui significaria "a NOSSA auth falhou" — a recusada foi a
      // credencial da venue, então o honesto é 400; o resto segue a classe.
      { status: status === 401 ? 400 : status, headers: { "Cache-Control": "no-store" } },
    );
  }

  // ── 4. Relê e responde o que o LIVRO tem ──
  const atual = await intentPorId(db, intentId);
  if (!atual) {
    return NextResponse.json({ ok: false, error: "releitura_do_livro_falhou" }, { status: 502 });
  }
  if (atual.state === "FILLED") {
    return NextResponse.json({
      ok: true, state: "FILLED",
      filledQty: Number(atual.filled_qty),
      filledQuote: Number(atual.filled_quote),
      feeTotal: atual.fee_total, feeCurrency: atual.fee_currency,
    }, { headers: { "Cache-Control": "no-store" } });
  }
  if (ehTerminal(atual.state) || atual.state === "QUARANTINED") {
    return NextResponse.json({ ok: true, state: atual.state },
      { headers: { "Cache-Control": "no-store" } });
  }
  // ⚠️ AINDA EM DÚVIDA. A resposta honesta é 202 + a proibição explícita de
  // reenvio — reenviar sobre dúvida é a compra dobrada do A80.
  return NextResponse.json({
    ok: true, state: atual.state,
    mensagem: "a corretora ainda nao respondeu de forma conclusiva — "
      + "NAO reenvie a ordem; tente novamente em instantes",
  }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
