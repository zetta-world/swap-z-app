import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { assinaturaValidaFormato } from "@/lib/solana/transmissao";
import { colunasDaVerificacao, verificarOperacaoSolana } from "@/lib/solana/reconciliacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Generous — the browser may sync a backlog of operations on first load.
const RL_OPTS = { windowMs: 60_000, max: 120 };

interface Body {
  ref?:        string;
  wallet?:     string;
  kind?:       string;
  chain?:      string;
  pair?:       string;
  side?:       string;
  volumeUsd?:  number;
  pnlUsd?:     number;
  /** O que a plataforma RECEBEU nesta operação — ver a migração 0024. */
  platformFeeUsd?:    number;
  platformFeeAmount?: string;
  platformFeeToken?:  string;
  platformFeeBps?:    number;
  status?:     string;
  route?:      string;
  /** Real trade timestamp (unix ms) from the client tx-history entry. Drives
   *  created_at so 24h/7d aggregations reflect when the trade actually
   *  happened — NOT when the browser first synced its backlog. */
  ts?:         number;
  /** Assinatura pública da transação (Solana) — W3-D: o servidor reconcilia na rede. */
  txHash?:     string;
}

/**
 * POST /api/operations/record — the browser syncs each completed operation
 * here (idempotent on `ref`). Analytics-grade capture for ZION learning, NOT
 * an execution path: it places nothing, moves nothing. Best-effort.
 *
 * ⚠ CORREÇÃO 30/07 — ATRIBUIÇÃO VINHA DO CLIENTE.
 *
 * A carteira era lida de `body.wallet`, sem checar sessão, justificada por
 * "isto é analytics, não auth". Só que esta tabela alimenta o painel RECEITA e
 * o livro de operações: qualquer um podia inflar o volume da plataforma ou
 * atribuir um trade forjado à carteira de outra pessoa. Não move fundo — mas
 * corrompe exatamente os números que passamos a sessão inteira tornando
 * honestos, e um número forjável tem valor zero para decidir qualquer coisa.
 *
 * Agora a carteira vem da SESSÃO. Sem sessão, o registro entra ANÔNIMO em vez
 * de aceitar a alegação do cliente.
 *
 * ⚠️⚠️ MAS "PERDE-SE ATRIBUIÇÃO, NÃO INTEGRIDADE" ERA FALSO — achado A07.
 *
 * Esta frase estava aqui e sustentava o resto. A linha anônima entra com
 * `status: "confirmed"` e `platformFeeUsd` DECLARADOS por um chamador sem
 * sessão nenhuma, e o painel RECEITA soma `platform_fee_usd` de tudo que está
 * confirmado. Medido em produção hoje: 4 das 18 operações confirmadas são
 * anônimas, e a ÚNICA linha que carrega arrecadação — 100% do que o painel
 * exibe — é uma delas.
 *
 * Recusar o registro anônimo seria pior: as quatro linhas de hoje são trocas
 * BSC de verdade, feitas sem sessão assinada, e jogá-las fora abriria um buraco
 * no livro para consertar um buraco no painel. A honestidade é RIO ABAIXO —
 * quem soma separa o que tem identidade assinada do que é só alegação.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`ops_record:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  let body: Body;
  try { body = await req.json() as Body; }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  if (!body.kind || !body.status) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }

  // A carteira NUNCA vem do corpo: quem diz quem você é é o cookie assinado.
  const session = await getSession();
  const sessionWallet = session?.sub ?? null;

  /**
   * ⚠️ W3 (21/10) — ISOLAMENTO DE IDENTIDADE. A sessão sozinha não basta: o registro é de quem
   * OPEROU, e o navegador pode estar com a sessão de outra carteira na hora de sincronizar.
   *   · registro com carteira de origem ≠ sessão → NÃO grava (409; o cliente tenta de novo quando a
   *     sessão for a dessa carteira) — nunca atribui a operação de A à sessão de B;
   *   · registro SEM carteira de origem (legado, CEX, Autopilot) → grava SEM atribuição
   *     (`wallet_address` nulo): conta no total, nunca vira identidade assinada de ninguém.
   */
  const origem = typeof body.wallet === "string" && body.wallet.trim() ? body.wallet.trim() : null;
  if (origem && sessionWallet && origem.toLowerCase() !== sessionWallet.toLowerCase()) {
    return NextResponse.json({ ok: false, error: "wallet_divergente" }, { status: 409 });
  }
  const atribuida = origem && sessionWallet ? sessionWallet : null;

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 503 });

  // Light sanitation — this is analytics, not auth, but keep it bounded.
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  // Real trade time → created_at. Only trust a sane unix-ms value in the past
  // (no future dates, nothing before 2020); otherwise fall back to the DB
  // default now(). This is what keeps the admin's 24h volume honest.
  const MIN_TS = 1_577_836_800_000; // 2020-01-01
  const tsMs = num(body.ts);
  const createdAt =
    tsMs !== null && tsMs >= MIN_TS && tsMs <= Date.now() + 60_000
      ? new Date(tsMs).toISOString()
      : null;

  /**
   * ⚠️⚠️ O `try/catch` AQUI NÃO PEGAVA NADA — achado A07 da auditoria externa.
   *
   * `supabase-js` RESOLVE com `{ error }`; ele não lança. O `catch` nunca rodou
   * uma vez, e a rota devolvia `{ ok: true }` para toda falha de banco.
   *
   * ⚠️ E ISSO PERDIA A OPERAÇÃO DE VEZ. `useOperationSync` só repete o que
   * NÃO deu certo: `if (ok) synced.add(e.id)`, e o conjunto é persistido. Um
   * `ok: true` mentiroso marcava a operação como sincronizada para sempre — ela
   * nunca mais seria reenviada, e o livro ficava com o buraco sem ninguém ver.
   */
  /**
   * ⚠️ W3-D: swap Solana (Jupiter) com assinatura pública → a VERIFICAÇÃO é do servidor, na rede.
   * O `status`/taxa declarados continuam gravados como alegação; o estado financeiro nasce
   * `aguardando` (declarado confirmado) ou `declarada` (outros estados), nunca verificado.
   */
  const chainDecl = str(body.chain, 40);
  const assinatura = chainDecl === "solana" && body.route === "jupiter" && assinaturaValidaFormato(body.txHash) ? body.txHash : null;
  const aguardando = assinatura !== null && body.status === "confirmed";
  {
    const { error } = await db.from("operations").upsert({
      tx_signature:    assinatura,
      carteira_origem: assinatura ? origem : null,
      verificacao:     aguardando ? "aguardando" : "declarada",
      ref:            str(body.ref, 120),
      wallet_address: atribuida,   // só quando origem do registro == sessão (W3)
      kind:           str(body.kind, 40)!,
      chain:          str(body.chain, 40),
      pair:           str(body.pair, 40),
      side:           str(body.side, 8),
      volume_usd:     num(body.volumeUsd),
      pnl_usd:        num(body.pnlUsd),
      /**
       * ⚠️ A ARRECADAÇÃO VEM DO CLIENTE, e o CHECK do banco é a trava.
       *
       * Este corpo é enviado pelo navegador, então o número é declarado por
       * quem opera — igual ao volume. A migração 0024 recusa valor NEGATIVO,
       * que é a forma de alguém transformar custo em receita com sinal
       * trocado. Valor inflado continua possível e é problema de outra ordem:
       * o painel confere a retenção contra os bps do plano, e o explorador
       * confere contra a cadeia.
       */
      platform_fee_usd:    num(body.platformFeeUsd),
      platform_fee_amount: str(body.platformFeeAmount, 80),
      platform_fee_token:  str(body.platformFeeToken, 64),
      platform_fee_bps:    num(body.platformFeeBps),
      status:         str(body.status, 24)!,
      route:          str(body.route, 24),
      // Only set when we have a trustworthy trade time; otherwise omit so the
      // DB default now() applies.
      ...(createdAt ? { created_at: createdAt } : {}),
    }, { onConflict: "ref", ignoreDuplicates: true });
    // Devolver 500 faz o navegador REPETIR no próximo ciclo, que é o ponto.
    if (error) {
      return NextResponse.json({ ok: false, error: error.message.slice(0, 160) }, { status: 500 });
    }
  }
  // Reconciliação imediata (best-effort AQUI porque a rotina `/api/operations/reconciliar` repete
  // tudo que ficar `aguardando` — o registro já está gravado e nada é dado como verificado sem medir).
  if (aguardando && assinatura) {
    const fee = num(body.platformFeeUsd), bps = num(body.platformFeeBps);
    const v = await verificarOperacaoSolana(assinatura, {
      carteira: origem, taxaDeclarada: (fee !== null && fee > 0) || (bps !== null && bps > 0),
    });
    if (v.verificacao !== "aguardando") {
      await db.from("operations").update(colunasDaVerificacao(v))
        .eq("ref", str(body.ref, 120)!).eq("tx_signature", assinatura).eq("verificacao", "aguardando");
    }
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
