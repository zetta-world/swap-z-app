import { NextRequest, NextResponse } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { executarOrdemCex } from "@/lib/cex/execucao/executor";
import { reconciliarIntent } from "@/lib/cex/execucao/reconciliador";
import { intentPorId } from "@/lib/cex/execucao/intents";
import { ehTerminal } from "@/lib/cex/execucao/estados";
import { avaliarDecisaoDeEstrategia } from "@/lib/autopilot/politica";
import { certificadoVivo } from "@/lib/autopilot/certificado";
import { regimeDaBase } from "@/lib/autopilot/regime";
import { getSessionStatus, utcDayKey } from "@/lib/autopilot/sessions";
import { markServerExitArmed } from "@/lib/autopilot/positions-server";
import { taxaEmUsd } from "@/lib/cex/taxa";
import {
  tetoDeExposicaoDoRisco, avaliarExposicaoParaEntrada, avaliarVendaAutonoma,
} from "@/lib/autopilot/inventario";
import {
  reservarVendaDoBot, reservarExposicaoDoBot, liberarReservaDoIntent,
} from "@/lib/autopilot/reserva-de-inventario";
import { lerPosicaoDoBot, getOpenServerPositions } from "@/lib/autopilot/positions-server";
import { projetarEfeitoDoIntent } from "@/lib/autopilot/projecao-de-posicao";
import { reservaDaVagaDiaria } from "@/lib/autopilot/reserva-de-vaga";
import {
  avaliarAutorizacaoDaSessaoParaExecucao, entradaAutorizadaNaSessao, tetoEfetivoDaOrdem,
} from "@/lib/autopilot/autorizacao-de-execucao";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getReferencePriceUsd, checkRealNotional } from "@/lib/autopilot/price-guard";
import { podeAutomatizar } from "@/lib/autopilot/liberacao";
import { checarKillSwitches } from "@/lib/admin/kill-switches";
import { getSession } from "@/lib/auth/session";
import { logSecurity, logError } from "@/lib/admin/track";
import { recordEvent } from "@/lib/admin/track";
import { classifyCexError, sanitizeUpstreamMessage, statusForError } from "@/lib/cex/errors";
import { impressaoDaCredencial } from "@/lib/cex/fingerprint";
import { conexaoParaExecucao, decifrarConexao } from "@/lib/cex/conexoes";
import { checkFeatureTier, denialResponse } from "@/lib/tier/enforce";
import {
  type CexId, type CexCredentials, type CexOrder, type CexOrderResponse,
  type CexOrderSide, type CexOrderType,
  SUPPORTED_CEX_IDS, CEX_META,
} from "@/lib/cex/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_EXCHANGES = new Set<CexId>(SUPPORTED_CEX_IDS);

// Tight rate limit — placing real orders is intentionally slow. The user
// must wait between submissions; bursts trigger a 429 we let through.
const RL_OPTS = { windowMs: 60_000, max: 8 };

interface OrderRequestBody {
  exchange:    string;
  symbol:      string;
  side:        string;
  type:        string;
  amount:      number;
  price?:      number;
  /** Magic string the client must send. Defense in depth against accidental
   *  calls — the UI sets this only after the user passed the confirmation
   *  modal + 3-second cooldown. */
  confirm:     string;
  apiKey:      string;
  apiSecret:   string;
  passphrase?: string;
  /** Set true by the autopilot bridge. Triggers the real-price notional
   *  guard below — the amount/price came from LLM text and must be checked
   *  against a fresh reference price, not trusted as-is. */
  autopilot?:  boolean;
  /** The user's per-trade USD cap, forwarded so the server can reject an
   *  order whose REAL notional (baseAmount × reference price) blows past it.
   *  Defense in depth: a buggy client cannot place a catastrophic order. */
  maxNotionalUsd?: number;
}

/**
 * POST /api/cex/order — place a market or limit order on the user's CEX.
 *
 * REAL FUNDS MOVE WHEN THIS SUCCEEDS. Manual credentials arrive in the body
 * and are used exactly once; autopilot_browser uses the session vault connection
 * (A127 binding) and never lets body credentials redefine that account. The server does not log the body,
 * does not echo the credentials in any error path, and does not persist
 * the order anywhere except as the response back to the client (the user's
 * own browser carries any order-history retention).
 *
 * Body: {
 *   exchange,         // 'binance' | 'coinbase' | 'okx'
 *   symbol,           // ccxt format e.g. "BTC/USDT"
 *   side,             // 'buy' | 'sell'
 *   type,             // 'market' | 'limit'
 *   amount,           // base-asset quantity (BTC for BTC/USDT)
 *   price?,           // required for limit
 *   confirm,          // must equal "I-CONFIRM-REAL-ORDER"
 *   apiKey, apiSecret, passphrase?
 * }
 */
export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const rl = await rateLimitDurable(`cex_order:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    logSecurity("rate_limited", { route: "cex/order" }, "low");
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // GATE DE PLANO (auditoria 01/08). `FEATURE_TIER.cexAutopilot = "pro"` estava
  // declarado desde sempre e NUNCA era verificado no servidor: o controle vivia
  // só no `TierGate`, componente de cliente que ESCONDE a interface. Esconder
  // botão não é controle de acesso — um `curl` nesta rota entregava igual, e a
  // rota nem precisava ser descoberta, porque o código dela vai no bundle.
  // Dormente com TIER_GATES_ENABLED=false, igual à UI.
  const gate = await checkFeatureTier("cexAutopilot");
  if (gate) return denialResponse(gate);

  /**
   * ⚠️ OS KILL-SWITCHES, agora lidos (Fase 7.3). Vale para ordem MANUAL também:
   * `disable_cex` e `maintenance_mode` existem para parar o dinheiro, não para
   * parar só o robô. Esta rota é dinheiro que SAI da conta do cliente, então
   * falha de leitura BLOQUEIA — ver a nota em `kill-switches.ts`.
   */
  const kill = await checarKillSwitches(["disable_cex", "maintenance_mode"], "dinheiro_sai");
  if (kill.bloqueado) {
    return NextResponse.json(
      { ok: false, error: "platform_disabled", detail: kill.motivo },
      { status: 503 },
    );
  }

  let body: OrderRequestBody;
  try {
    body = await req.json() as OrderRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // ─── Validation ─────────────────────────────────────────────────────

  // Confirmation guard — the client must pass this exact string. Default
  // catch for accidental scripted submissions.
  if (body.confirm !== "I-CONFIRM-REAL-ORDER") {
    // Calling the live-order endpoint without the exact token is a strong
    // abuse/probing signal — surface it loudly.
    logSecurity("invalid_confirmation", { route: "cex/order" }, "high");
    return NextResponse.json({ ok: false, error: "missing_confirmation" }, { status: 400 });
  }

  const exchange = body.exchange?.toLowerCase?.() as CexId;
  if (!VALID_EXCHANGES.has(exchange)) {
    return NextResponse.json({ ok: false, error: "invalid_exchange" }, { status: 400 });
  }

  if (typeof body.symbol !== "string" || !/^[A-Z0-9]{2,20}[\/\-][A-Z0-9]{2,20}$/i.test(body.symbol)) {
    return NextResponse.json({ ok: false, error: "invalid_symbol" }, { status: 400 });
  }

  const side = (body.side || "").toLowerCase() as CexOrderSide;
  if (side !== "buy" && side !== "sell") {
    return NextResponse.json({ ok: false, error: "invalid_side" }, { status: 400 });
  }

  const type = (body.type || "").toLowerCase() as CexOrderType;
  if (type !== "market" && type !== "limit") {
    return NextResponse.json({ ok: false, error: "invalid_type" }, { status: 400 });
  }

  if (typeof body.amount !== "number" || body.amount <= 0 || !Number.isFinite(body.amount)) {
    return NextResponse.json({ ok: false, error: "invalid_amount" }, { status: 400 });
  }

  if (type === "limit") {
    if (typeof body.price !== "number" || body.price <= 0 || !Number.isFinite(body.price)) {
      return NextResponse.json({ ok: false, error: "invalid_price" }, { status: 400 });
    }
  }

  // Server-side notional ceiling — defense in depth. The client enforces
  // per-trade caps, but a buggy client, a replayed request, or a direct
  // call must NOT be able to place a catastrophic order. When the notional
  // is computable (a price is present), hard-cap it well above any sane
  // single trade. Market orders carry no price so this can't bind them;
  // those still pass through the client cap + the confirm guard.
  const HARD_NOTIONAL_CEILING_USD = 100_000;
  if (typeof body.price === "number" && Number.isFinite(body.price) && body.price > 0) {
    const notional = body.amount * body.price;
    if (Number.isFinite(notional) && notional > HARD_NOTIONAL_CEILING_USD) {
      return NextResponse.json({ ok: false, error: "notional_too_large" }, { status: 400 });
    }
  }

  // Autopilot real-price notional guard (C1/C4). For autopilot orders the
  // amount came from LLM text; a market BUY carries no price so the ceiling
  // above can't bind it. Recompute the TRUE notional from a fresh reference
  // price and reject oversized buys (and any order over the hard ceiling).
  // Manual orders skip this — the user is present and accepted the trade.
  /** ⚠️ O canal: o piloto do navegador dispara por esta MESMA rota. */
  const ehAutopilot = body.autopilot === true;
  /** Preenchidos no ramo do piloto — o intent autônomo precisa deles (A110). */
  let certificadoDoPiloto: string | null = null;
  let estrategiaDoPiloto: { id: string | null; versao: number | null } = { id: null, versao: null };
  /** O hash vai ao executor: a autorização FINAL é no banco (A110, round 2). */
  let hashDoPiloto: string | null = null;
  /**
   * ⚠️ O NOCIONAL REAL medido no servidor (A110, round 3). Ordem MARKET do
   * piloto não tem `body.price` — sem repassar isto ao executor, o intent
   * ficava com `requested_notional_usd` nulo e a autorização final do banco
   * recusaria qualquer certificado com teto ("nocional não mensurável"), ou
   * pior: passaria sem medida onde não houvesse teto. Nulo só quando NEM o
   * preço de referência existe — nunca null=0.
   */
  let notionalRealDoPiloto: number | null = null;
  /**
   * ⚠️ O ID DA SESSÃO DO PILOTO — contexto operacional. A127: ele NÃO é mais
   * autoridade de recovery; a identidade histórica vem de `conexao_id` gravado
   * no próprio intent. A sessão pode ser rearmada para outra conexão.
   */
  /**
   * ⚠️⚠️ A QUANTIDADE QUE O SERVIDOR AUTORIZA — A131.
   *
   * Nasce igual ao pedido e pode ser REDUZIDA pela posse do bot numa venda
   * autônoma. Tudo daqui para baixo (guarda de nocional, política, executor,
   * resposta) usa ela — `body.amount` deixa de ser a quantidade da ordem.
   */
  let quantidadeAutorizada = body.amount;
  let sessaoDoPilotoId: string | null = null;
  /** A carteira do piloto, para a telemetria fora do ramo da sessão. */
  let walletDoPiloto: string | null = null;
  /**
   * ⚠️⚠️ O CAPITAL QUE ESTA ENTRADA VAI RESERVAR — A135/A137.
   *
   * O pré-voo mede; a reserva com dono acontece na costura do executor, com o
   * intent na mão. Este número é o que ela vai pedir.
   */
  let entradaReservavelUsd: number | null = null;
  /** O teto do modo de risco DESTA sessão, medido no pré-voo. */
  let tetoDeExposicaoUsd = 0;
  /**
   * ⚠️⚠️ O INTENT QUE PROMETEU ALGO E AINDA NÃO VIROU ORDEM — A137.
   *
   * Toda recusa depois da reserva tem de devolver o compromisso DELE (e de
   * nenhum outro). Só o desfecho INCERTO não devolve: a ordem pode estar viva,
   * e soltar a bolsa autorizaria uma segunda venda sobre o mesmo dinheiro.
   */
  let intentComReserva: string | null = null;

  const devolverReservasEmVoo = async () => {
    if (!intentComReserva) return;
    await liberarReservaDoIntent(intentComReserva);
    intentComReserva = null;
  };
  let conexaoDoPilotoId: string | null = null;
  /** ⚠️ O dia UTC usado na reserva — o MESMO da autorização, não recalculado. */
  let hojeDoPiloto: string | null = null;
  let credenciaisDoPiloto: CexCredentials | null = null;
  if (ehAutopilot) {
    /**
     * ⚠️ TRAVA DE LIBERAÇÃO (Fase 7.2), no canal do NAVEGADOR.
     *
     * Gatear só o cron deixaria a metade errada aberta: o piloto do navegador
     * (`AutopilotPilot`) dispara sozinho por esta rota quando a contagem
     * regressiva zera. "Fechado" com um dos dois canais operando seria meia
     * verdade — o defeito que a Fase 6 chamou de "mesmo defeito com outro nome".
     *
     * ⚠️ E ISTO NÃO É CONTROLE DE SEGURANÇA, é controle de PRODUTO: a flag
     * `autopilot` vem do cliente, então quem quiser pode chamar esta rota sem
     * ela. Não tem problema, e a distinção é deliberada — ordem MANUAL segue
     * aberta de propósito. O que a trava fecha é a automação, não o negociar.
     */
    /**
     * ⚠️ AQUI PRECISA DA CARTEIRA, e esta rota não tinha identidade nenhuma:
     * ela recebe a credencial da corretora no corpo e nunca leu sessão. Sem
     * ler a sessão, não há como distinguir o piloto autorizado do público — a
     * trava viraria tudo-ou-nada justamente no canal do navegador.
     *
     * Ler a sessão AQUI, dentro do ramo de autopilot, mantém a ordem MANUAL
     * exatamente como estava: sem exigir login, aberta de propósito.
     */
    const sessao = await getSession();
    walletDoPiloto = sessao?.sub ?? null;
    const automacao = await podeAutomatizar(sessao?.sub ?? "");
    if (!automacao.permitido) {
      return NextResponse.json(
        { ok: false, error: "automation_closed", causa: automacao.causa },
        { status: 403 },
      );
    }
    /**
     * ⚠️⚠️⚠️ A130 — A SESSÃO AUTORIZA, ANTES DE QUALQUER OUTRA COISA.
     *
     * Esta leitura acontecia mais abaixo, só para tirar `allowed_symbols` e a
     * estratégia — e NADA conferia `is_active`, `expires_at` ou congelamento.
     * O botão PARAR grava `is_active = false` e a LINHA fica; a rota seguia
     * para `sessao.conexao_id` → conexão CURRENT → credencial do cofre → ordem.
     * Sessão parada continuava comprando.
     *
     * ⚠️ E ELA VEM AGORA ANTES DO COFRE DE PROPÓSITO (§20): numa sessão sem
     * autorização a credencial NEM CHEGA A SER DECIFRADA. Recusar depois de
     * abrir o cofre seria recusar tarde.
     */
    let sessaoDoPiloto: Awaited<ReturnType<typeof getSessionStatus>> = null;
    try {
      sessaoDoPiloto = sessao?.sub ? await getSessionStatus(sessao.sub, exchange) : null;
    } catch (e) {
      /**
       * ⚠️ FALHA DE LEITURA É RECUSA, não "sem sessão". `getSessionStatus`
       * LANÇA quando o banco não responde (correção de 14/09). Engolir isso
       * faria um Postgres intermitente virar licença para operar sem teto,
       * sem lista de símbolos e sem certificado.
       */
      logSecurity("politica_sem_sessao_legivel", { route: "cex/order" }, "high");
      return NextResponse.json(
        { ok: false, error: "sessao_nao_legivel",
          detail: (e as Error)?.message?.slice(0, 160) ?? "falha ao ler a sessao" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    const agoraDaSessao = new Date();
    const hojeUtc = utcDayKey(agoraDaSessao);
    hojeDoPiloto = hojeUtc;
    const autorizacao = avaliarAutorizacaoDaSessaoParaExecucao(
      sessaoDoPiloto
        ? {
            ativa: sessaoDoPiloto.is_active,
            expiraEm: sessaoDoPiloto.expires_at,
            congeladaAte: sessaoDoPiloto.frozen_until_day,
            /**
             * ⚠️ A VIRADA DO DIA APLICADA AQUI. O contador só é zerado pela
             * passada do cron; num dia novo o valor da linha é de ontem, e
             * usá-lo cru bloquearia o piloto com um teto já cumprido.
             */
            tradesHoje: sessaoDoPiloto.last_reset_day === hojeUtc
              ? sessaoDoPiloto.trades_today : 0,
            maxTradesPorDia: sessaoDoPiloto.max_trades_per_day,
            maxTradeUsd: sessaoDoPiloto.max_trade_usd,
            conexaoId: sessaoDoPiloto.conexao_id,
            emQuarentena: Boolean(sessaoDoPiloto.quarentena_em),
          }
        : null,
      agoraDaSessao,
    );
    if (!autorizacao.ok) {
      logSecurity("a130_sessao_nao_autoriza", {
        route: "cex/order", motivo: autorizacao.motivo,
      }, "high");
      return NextResponse.json(
        { ok: false, error: "sessao_nao_autorizada",
          motivo: autorizacao.motivo, detail: autorizacao.porque },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    /**
     * ⚠️⚠️⚠️ A QUARENTENA POR DERIVA — achado da revisão adversarial do A130.
     *
     * `reconciliar-conta.ts` grava `quarentena_em` quando o saldo real deixa de
     * sustentar o inventário do bot. O cron obedecia e parava de comprar; ESTA
     * ROTA não sabia que a coluna existia. Mesma sessão, mesma deriva: o cron
     * parado e o piloto do navegador comprando.
     *
     * ⚠️ SÓ A COMPRA. A venda atravessa de propósito — quarentena não pode
     * trancar o cliente numa posição, e é a mesma regra que o cron aplica
     * ("SAÍDAS/redução NUNCA são presas").
     *
     * ⚠️ E CONTINUA ANTES DO COFRE (§20): recusa sem decifrar credencial.
     */
    if (side === "buy") {
      const entrada = entradaAutorizadaNaSessao({
        emQuarentena: Boolean(sessaoDoPiloto?.quarentena_em),
      });
      if (!entrada.ok) {
        logSecurity("a130_entrada_em_quarentena", { route: "cex/order" }, "high");
        return NextResponse.json(
          { ok: false, error: "sessao_nao_autorizada",
            motivo: entrada.motivo, detail: entrada.porque },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    /**
     * ⚠️⚠️⚠️ O ID DA SESSÃO NASCE AQUI, E NÃO DEPOIS DOS PORTÕES QUE O USAM.
     *
     * ⚠️ ACHADO DA REVISÃO ADVERSARIAL DO ROUND 9, e foi um defeito MEU, com a
     * pior forma possível: a atribuição vivia lá embaixo, depois da política, e
     * os dois portões do A131 liam a variável ainda `null` — com `?? ""` por
     * cima. O livro era consultado com `session_id = ""`, que numa coluna
     * `uuid not null` devolve erro de sintaxe. Ou seja: TODA venda autônoma do
     * navegador respondia `livro_ilegivel`, TODA compra também, e a posse que o
     * A131 existe para medir nunca foi medida contra a sessão real.
     *
     * ⚠️ E O `?? ""` ERA O DISFARCE. Ele transformava "não sei de que sessão
     * estou falando" em uma consulta plausível. Sem ele, o TypeScript teria
     * apontado o buraco.
     *
     * ⚠️ SEM ID NÃO SE OPERA. A autorização acima já provou que existe sessão —
     * a linha não chega aqui sem chave primária. Mas posse, exposição e a
     * reserva do teto diário são todas condicionadas a este id: falha FECHADA.
     */
    sessaoDoPilotoId = sessaoDoPiloto?.id ?? null;
    if (!sessaoDoPilotoId) {
      logSecurity("a130_sessao_sem_id", { route: "cex/order" }, "high");
      return NextResponse.json(
        { ok: false, error: "sessao_nao_autorizada", motivo: "sessao_inexistente",
          detail: "sessao do piloto sem identificador — posse, exposicao e a vaga "
            + "do teto diario nao podem ser conferidas" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    /**
     * Devolve o que foi prometido e responde a recusa.
     *
     * ⚠️ UMA PORTA SÓ. Espalhar `liberar...` por cada `return` é como se
     * esquece um deles — e o esquecido tranca a posição da sessão até a
     * reserva expirar.
     */
    const recusarLiberando = async (corpo: Record<string, unknown>, status: number) => {
      await devolverReservasEmVoo();
      return NextResponse.json(corpo,
        { status, headers: { "Cache-Control": "no-store" } });
    };

    const base = body.symbol.split(/[\/\-]/)[0];

    /**
     * ⚠️⚠️⚠️ O QUE O BOT POSSUI É O QUE O SERVIDOR DIZ — achado A131.
     *
     * Este ramo autorizava VENDA autônoma sem olhar inventário nenhum. O
     * inventário do piloto existia em dois lugares: `autopilot_positions` (que
     * só o cron lia) e o `localStorage` do navegador (que nada do servidor
     * lia). O ataque cabe em três linhas:
     *
     *     posição do bot no servidor:  0,01 BTC
     *     saldo do cliente na conta:   1,00 BTC
     *     cartão pede:                 VENDER 0,50 BTC
     *
     * O cron limitava a 0,01 (`quantoPodeVender`); esta rota mandava 0,50 — e
     * 0,49 BTC do PATRIMÔNIO DO DONO sairiam por um mandato que o bot não tem.
     *
     * ⚠️ A QUANTIDADE PASSA A SER `quantidadeAutorizada`, não `body.amount`.
     * Ela desce para o guarda de nocional, para a política e para o executor —
     * senão o teto seria conferido contra um número e a ordem sairia com outro.
     *
     * ⚠️ MANUAL NÃO ENTRA AQUI. Vender o próprio ativo é direito do dono; isto
     * só vale para `autopilot_browser` (`ehAutopilot`).
     */
    if (side === "sell") {
      /**
       * ⚠️⚠️⚠️ E ELA É RESERVADA, NÃO SÓ CONFERIDA — achado A134.
       *
       * Ler a posição, decidir, e só depois mandar a ordem é READ-THEN-ACT:
       * duas requisições simultâneas leem `base_amount = 0,01` e as DUAS são
       * autorizadas a vender 0,01. O teto diário não salva — ele responde
       * "quantas ordens cabem hoje", e havendo duas vagas as duas passam.
       *
       * A reserva é tomada DENTRO da transação que confere (0064, `for update`
       * na linha da posição), e ela também LIMITA à posição do bot. Quem
       * devolve é só a recusa PROVADA; UNKNOWN não devolve nada.
       */
      /**
       * ⚠️⚠️ ESTE É O PRÉ-VOO: ele DIMENSIONA, não autoriza — A137.
       *
       * A quantidade precisa ser decidida antes de o intent nascer (ele grava
       * `requested_qty`), e nesse momento ainda não há id para a reserva
       * pertencer a alguém. Então aqui se lê o livro, recusa-se o que já é
       * recusável (sem posição, saída armada, livro ilegível) e limita-se o
       * pedido à posição do bot — tudo ANTES do cofre (§20).
       *
       * ⚠️ A AUTORIZAÇÃO DE VERDADE É A RESERVA, na costura do executor, com o
       * intent na mão. Se alguém prometer a bolsa entre este pré-voo e ela, a
       * reserva recusa e NADA sai.
       */
      const posse = avaliarVendaAutonoma({
        leitura: await lerPosicaoDoBot(sessaoDoPilotoId, base),
        pedido: body.amount,
      });
      if (!posse.ok) {
        logSecurity("a131_venda_sem_posse", {
          route: "cex/order", symbol: body.symbol, motivo: posse.motivo,
        }, "high");
        return NextResponse.json(
          { ok: false, error: "posse_do_bot", motivo: posse.motivo, detail: posse.porque },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }
      if (posse.limitada) {
        /**
         * ⚠️ NÃO É RUÍDO. É a diferença entre vender a posição do bot e vender
         * a bolsa do dono — e o cron já registra o mesmo fato com nome
         * próprio quando limita.
         */
        await recordEvent("autopilot_venda_limitada_a_posicao", { wallet: sessao?.sub, meta: {
          canal: "browser", session: sessaoDoPilotoId, pair: body.symbol,
          pedido: body.amount, naPosicao: posse.naPosicao, enviado: posse.qtd,
          why: "o cartao pediu vender mais do que o bot comprou — o excedente seria "
            + "moeda do proprio usuario, que o autopilot nao tem mandato para vender",
        } });
      }
      quantidadeAutorizada = posse.qtd;
    }

    const refPrice = await getReferencePriceUsd(base);
    /**
     * ⚠️⚠️⚠️ A130-B — O TETO É O DURÁVEL, NÃO O DO CORPO.
     *
     * Isto era:
     *
     *     const cap = typeof body.maxNotionalUsd === "number" && body.maxNotionalUsd > 0
     *       ? body.maxNotionalUsd : HARD_NOTIONAL_CEILING_USD;
     *
     * — e alimentava `checkRealNotional` E `avaliarDecisaoDeEstrategia`. O
     * `max_trade_usd` da sessão, que o DONO configurou e está persistido, não
     * entrava na conta: sessão a US$ 50 e corpo pedindo US$ 1.000 fazia o
     * servidor avaliar contra 1.000.
     *
     * Agora vale o MENOR entre sessão, teto global e o que o corpo pediu — o
     * cliente só consegue ser mais conservador, nunca se autorizar mais.
     */
    const cap = tetoEfetivoDaOrdem({
      tetoDaSessaoUsd: autorizacao.tetoDaSessaoUsd,
      tetoGlobalUsd: HARD_NOTIONAL_CEILING_USD,
      pedidoPeloClienteUsd: body.maxNotionalUsd,
    });
    // ⚠️ A131: a quantidade conferida é a AUTORIZADA (limitada à posição do
    // bot numa venda), nunca a pedida pelo corpo.
    const guard = checkRealNotional({ side, baseAmount: quantidadeAutorizada, refPrice, maxTradeUsd: cap });
    if (!guard.ok) {
      logSecurity("notional_guard_block", { route: "cex/order", symbol: body.symbol, reason: guard.reason }, "high");
      return await recusarLiberando({ ok: false, error: "notional_guard", detail: guard.reason }, 400);
    }

    /**
     * ⚠️⚠️⚠️ A EXPOSIÇÃO TAMBÉM É DO SERVIDOR — A131 §22.
     *
     * O teto de exposição TOTAL do piloto vivia em dois lugares com dois
     * números: `RISK_EXPOSURE_USD` no cron (lendo `autopilot_positions`) e um
     * teto no Zustand do navegador (lendo `localStorage`). Uma aba com o store
     * vazio enxergava exposição ZERO e comprava por cima de tudo que o cron já
     * tinha comprado.
     *
     * ⚠️ DEPOIS DO GUARDA DE NOCIONAL, de propósito: o número que entra na
     * conta é o REAL medido (`guard.realNotionalUsd`), e a recusa mais
     * específica — "esta ordem é grande demais" — vem antes da mais geral —
     * "a carteira do bot já está cheia".
     *
     * ⚠️ LIVRO ILEGÍVEL RECUSA (A133): `[]` por erro de banco faria a exposição
     * parecer zero, que é a mesma mentira por outro caminho.
     *
     * ⚠️ O TETO É O DO MODO DE RISCO DA SESSÃO — o MESMO do cron. Isto muda
     * comportamento: uma compra do navegador maior que o teto de exposição
     * passava antes, porque ninguém no servidor olhava. Está declarado na
     * entrega.
     */
    if (side === "buy") {
      /**
       * ⚠️⚠️⚠️ E TAMBÉM É RESERVADA — achado A135.
       *
       * Somar as posições, comparar com o teto e só depois agir deixa duas
       * compras concorrentes lerem a MESMA exposição: 190 + 10 e 190 + 10
       * passam as duas, e o teto de 200 fecha em 210. A reserva soma a
       * exposição REAL e o que já está prometido dentro da mesma transação,
       * com a linha da sessão travada.
       */
      // ⚠️ PRÉ-VOO, como na venda: recusa cedo o que já dá para recusar. A
      // reserva com dono acontece na costura do executor (A137).
      const entradaUsd = guard.realNotionalUsd ?? Number.NaN;
      tetoDeExposicaoUsd = tetoDeExposicaoDoRisco(sessaoDoPiloto?.risk_mode);
      const exposicao = avaliarExposicaoParaEntrada({
        leitura: await getOpenServerPositions(sessaoDoPilotoId),
        novaEntradaUsd: entradaUsd,
        tetoUsd: tetoDeExposicaoUsd,
      });
      if (!exposicao.ok) {
        logSecurity("a131_exposicao_do_servidor", {
          route: "cex/order", symbol: body.symbol, motivo: exposicao.motivo,
        }, "high");
        return await recusarLiberando(
          { ok: false, error: "exposicao_do_bot", motivo: exposicao.motivo, detail: exposicao.porque },
          403);
      }
      entradaReservavelUsd = entradaUsd;
    }

    /**
     * ⚠️⚠️⚠️ O MOTOR DE POLÍTICA ÚNICO — achado A113, no canal que não o tinha.
     *
     * O portão de tendência existia SÓ no cron (`autopilot/cron/route.ts:867`).
     * O piloto do navegador dispara o MESMO cartão, do MESMO modelo, por esta
     * rota — e passava direto. Dois canais, dois vereditos para a mesma
     * estratégia; quem lia "o autopilot só entra a favor da tendência"
     * acreditava nisso para o produto inteiro.
     *
     * ⚠️ A DECISÃO É DO SERVIDOR. A tela mostra o veredito; ela não o produz.
     * `politicaVersao` volta na resposta justamente para a UI poder exibir POR
     * QUE, sem ter de reimplementar a regra para saber.
     */
    // ⚠️ A sessão já foi lida e AUTORIZADA acima (A130) — uma leitura só.
    const dbPolitica = getSupabaseAdmin();
    const cert = dbPolitica && sessaoDoPiloto?.strategy_id && sessaoDoPiloto.strategy_version
      ? (await certificadoVivo(dbPolitica, sessaoDoPiloto.strategy_id, sessaoDoPiloto.strategy_version)) ?? null
      : null;

    const decisaoDoPiloto = avaliarDecisaoDeEstrategia({
      canal: "browser", side, symbol: body.symbol, base: base.toUpperCase(),
      regime: await regimeDaBase(base),
      notionalUsd: guard.realNotionalUsd ?? null,
      maxTradeUsd: cap,
      allowedSymbols: sessaoDoPiloto?.allowed_symbols ?? null,
      autonomous: true,
      certificado: cert,
      venue: exchange,
      strategyHash: sessaoDoPiloto?.strategy_hash ?? null,
    });
    if (!decisaoDoPiloto.permite) {
      logSecurity("politica_bloqueou_piloto", {
        route: "cex/order", symbol: body.symbol, motivo: decisaoDoPiloto.motivo,
      }, "high");
      return await recusarLiberando(
        { ok: false, error: "politica_de_estrategia",
          motivo: decisaoDoPiloto.motivo, detail: decisaoDoPiloto.porque,
          politicaVersao: decisaoDoPiloto.versao }, 403);
    }
    certificadoDoPiloto = decisaoDoPiloto.certificadoId;
    hashDoPiloto = sessaoDoPiloto?.strategy_hash ?? null;
    notionalRealDoPiloto = guard.realNotionalUsd ?? null;
    estrategiaDoPiloto = {
      id: sessaoDoPiloto?.strategy_id ?? null,
      versao: sessaoDoPiloto?.strategy_version ?? null,
    };
    // ⚠️ Da AUTORIZAÇÃO, que já provou que ele existe (motivo `conexao_ausente`).
    conexaoDoPilotoId = autorizacao.conexaoId;

    /**
     * ⚠️⚠️ A127-BINDING: no piloto, a identidade histórica e a credencial do
     * efeito externo nascem da MESMA versão do cofre. O body não é autoridade
     * de conta neste ramo: C1 no intent com credential B no createOrder faria
     * o recovery procurar a ordem na conta errada.
     */
    if (!conexaoDoPilotoId) {
      return await recusarLiberando(
        { ok: false, error: "conexao_ausente",
          detail: "sessao do piloto sem conexao_id — nenhuma ordem foi enviada" }, 409);
    }
    const pronta = await conexaoParaExecucao(conexaoDoPilotoId, dbPolitica);
    if (!pronta.ok) {
      const status = pronta.motivo === "ilegivel" ? 503 : 409;
      return await recusarLiberando(
        { ok: false, error: `conexao_${pronta.motivo}`,
          detail: "a conexao da sessao nao pode criar nova ordem" }, status);
    }
    try {
      credenciaisDoPiloto = decifrarConexao(pronta.conexao);
    } catch {
      return await recusarLiberando(
        { ok: false, error: "conexao_ilegivel",
          detail: "nao foi possivel ler a credencial da conexao da sessao" }, 503);
    }
  }

  if (typeof body.apiKey !== "string" || body.apiKey.length < 8 || body.apiKey.length > 200) {
    return NextResponse.json({ ok: false, error: "invalid_api_key" }, { status: 400 });
  }
  if (typeof body.apiSecret !== "string" || body.apiSecret.length < 8 || body.apiSecret.length > 600) {
    return NextResponse.json({ ok: false, error: "invalid_api_secret" }, { status: 400 });
  }
  if (CEX_META[exchange].needsPassphrase && (!body.passphrase || typeof body.passphrase !== "string")) {
    return NextResponse.json(
      { ok: false, error: `passphrase_required_for_${exchange}` },
      { status: 400 },
    );
  }

  const credsDoBody: CexCredentials = {
    apiKey:    body.apiKey,
    apiSecret: body.apiSecret,
    passphrase: body.passphrase,
  };
  // A127-BINDING: autopilot_browser usa o cofre da conexão da sessão; manual
  // continua usando exatamente a credencial apresentada pelo usuário.
  const creds: CexCredentials = ehAutopilot ? credenciaisDoPiloto! : credsDoBody;

  /**
   * ⚠️⚠️ A120 — O VÍNCULO CREDENCIAL ↔ INTENT, calculado NO SERVIDOR.
   *
   * A ordem MANUAL REAL nasce com `credential_fingerprint` (HMAC da exchange
   * canonica + NUL + apiKey, sob `CEX_RECOVERY_HMAC_KEY`): é o que permite ao
   * recovery por intentId conferir que quem reconcilia é quem criou — antes
   * disso, qualquer credencial válida reconciliava o intent de qualquer um.
   *
   * ⚠️ ENV AUSENTE → 500 ANTES DO EXECUTOR (e portanto ANTES de qualquer
   * createOrder): uma ordem manual real incapaz de vínculo NÃO NASCE — sem o
   * fingerprint gravado, o recovery futuro dela fecharia em
   * `recovery_not_bound` e a ordem ficaria irreconciliável por desenho.
   *
   * ⚠️ SÓ O RAMO MANUAL REAL. Autopilot/DCA não recebem fingerprint (a
   * credencial deles está no cofre e o recovery é por `intent.conexao_id`) e o simulado
   * também não. E o campo `credentialFingerprint` do body, se vier, é
   * IGNORADO: fingerprint apresentado pelo cliente é autoautorização.
   */
  let credentialFingerprint: string | null = null;
  if (!ehAutopilot) {
    try {
      credentialFingerprint = impressaoDaCredencial(exchange, body.apiKey);
    } catch {
      return NextResponse.json(
        { ok: false, error: "server_configuration_error",
          detail: "o servidor nao consegue vincular a credencial ao intent; "
            + "a ordem NAO foi enviada" },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  /**
   * ⚠️⚠️ ESTA ROTA NÃO EXECUTA MAIS NADA POR CONTA PRÓPRIA — achado A107.
   *
   * Ela chamava `placeCexOrder` direto, como o cron do DCA e os dois ramos do
   * autopilot faziam. Três consumidores, três semânticas de sucesso e de
   * falha, nenhum com estado durável antes do efeito externo.
   *
   * Agora ela monta o pedido e entrega ao EXECUTOR, que grava o intent, confere
   * o kill-switch no limiar, marca SUBMITTING antes do envio e trata timeout
   * como DÚVIDA. O kill-switch acima continua aqui de propósito: recusar cedo
   * economiza uma escrita e dá erro melhor — mas ele NÃO é mais a única trava,
   * e é isso que o A106 pedia.
   */
  try {
    /**
     * ⚠️⚠️ UMA PORTA SÓ PARA PROJETAR, E ELA AVISA QUANDO FALHA.
     *
     * Dois caminhos desta rota terminam com dinheiro movido: o preenchimento
     * direto e o INCERTO que a reconciliação imediata prova ter executado. Os
     * dois passam por aqui — ter a projeção escrita só no primeiro foi
     * exatamente o achado da revisão.
     *
     * ⚠️ FALHA NÃO DESFAZ NADA (§36). A ordem já existe na corretora. O que
     * não pode é passar por normal: sai evento de severidade alta, e a
     * varredura de pendências (`autopilot_projecoes_pendentes`) tenta de novo
     * na passada seguinte do cron — porque `FILLED` é terminal e o recuperador
     * de intents não volta nele.
     */
    const projetarOuAvisar = async (
      intentId: string,
      // ⚠️ A taxa vem de quem chama porque só ali o desfecho está estreitado —
      // e ela é do LIVRO, não do corpo da requisição.
      taxaDoLivro: { total: number | null; moeda: string | null } = { total: null, moeda: null },
    ) => {
      // ⚠️ A140: a taxa é derivada do LIVRO dentro da RPC, e o dia vem do
      // relógio do banco. Esta rota só registra quando ela não é precificável.
      const projecao = await projetarEfeitoDoIntent(intentId);
      if (projecao.ok && projecao.taxaNaoPrecificada) {
        await recordEvent("autopilot_taxa_nao_precificada", { meta: {
          pair: body.symbol, moeda: taxaDoLivro.moeda ?? "?", valor: taxaDoLivro.total ?? 0,
          why: "taxa em moeda que nao e stable nem a base do par — subtraida como "
            + "ZERO, entao o P&L sai OTIMISTA e o stop de perda afrouxa",
        } });
      }
      if (projecao.ok) {
        /**
         * ⚠️⚠️⚠️ O P&L ENTROU NA MESMA TRANSAÇÃO — achado A138.
         *
         * Antes esta rota chamava `applySessionPnl` depois de a projeção
         * reduzir a posição. Duas escritas sem nada que as amarrasse: a
         * projeção podia suceder e o P&L falhar, e reprojetar devolvia
         * `sem_delta` — o débito sumia, sem prova durável de que faltava.
         * Agora a RPC aplica o resultado junto da redução, e o marcador
         * guarda quanto DESTE intent já entrou no `pnl_today`.
         *
         * ⚠️ A conversão da taxa continua aqui: ela é a única parte que o
         * banco não tem como fazer (preço da moeda da taxa).
         */
        if (projecao.motivo === "aplicado" && projecao.realizado !== 0) {
          await recordEvent("autopilot_pnl_realizado", { wallet: walletDoPiloto ?? undefined, meta: {
            canal: "browser", session: sessaoDoPilotoId, intent: intentId,
            realizado: projecao.realizado,
          } });
        }
        return;
      }
      logSecurity("a131_projecao_falhou", {
        route: "cex/order", symbol: body.symbol, motivo: projecao.motivo,
      }, "high");
      await recordEvent("autopilot_projecao_de_posicao_falhou", { wallet: walletDoPiloto ?? undefined, meta: {
        severity: "high", canal: "browser", session: sessaoDoPilotoId,
        intent: intentId, motivo: projecao.motivo, porque: projecao.porque,
        why: "a ordem EXECUTOU e o livro de posicoes nao registrou. O bot pode nao "
          + "saber que possui (ou que vendeu) o que ja aconteceu na corretora.",
      } });
    };

    const r = await executarOrdemCex(
      { db: getSupabaseAdmin() },
      /**
       * ⚠️ A ORIGEM DISTINGUE OS DOIS CANAIS DESTA MESMA ROTA. O piloto do
       * navegador dispara por aqui com `autopilot: true`, e um intent autônomo
       * precisa ser reconhecível como tal no livro — senão "quem mandou esta
       * ordem" vira pergunta sem resposta depois do fato.
       *
       * ⚠️ A sessão é lida aqui, FORA do ramo de automação, só para atribuir o
       * intent. A ordem manual continua aberta sem login, de propósito: ler
       * não é exigir.
       */
      { origin: ehAutopilot ? "autopilot_browser" : "manual",
        autonomous: ehAutopilot,
        walletAddress: (await getSession())?.sub ?? null,
        /**
         * ⚠️ O sessionId no intent (ponto 9): uma ordem do piloto que ficar
         * UNKNOWN é reconciliada pelo recuperador global com a credencial DA
         * CONEXÃO gravada no próprio intent. Ordem MANUAL continua sem sessão — a credencial
         * dela não é guardada, e ninguém pode reconciliá-la sem reautenticar.
         */
        sessionId: sessaoDoPilotoId,
        conexaoId: conexaoDoPilotoId,
        strategyId: estrategiaDoPiloto.id,
        strategyVersion: estrategiaDoPiloto.versao,
        certificateId: certificadoDoPiloto,
        strategyHash: hashDoPiloto,
        /** ⚠️ A120: null no piloto (credencial no cofre, recovery por
         *  conexao_id do intent); a impressão do manual veio do SERVIDOR, nunca do body. */
        credentialFingerprint },
      { exchangeId: exchange, symbol: body.symbol, side, type,
        qty: quantidadeAutorizada, price: type === "limit" ? body.price : null,
        /**
         * ⚠️ MARKET DO PILOTO NÃO TEM `body.price` — sem este fallback o
         * intent gravava `requested_notional_usd` NULL e a autorização final
         * do banco (RPC 0060) recusava qualquer certificado com teto
         * ("nocional não mensurável"). O nocional REAL medido no servidor
         * (price-guard) cobre exatamente esse buraco; ordem MANUAL segue
         * inalterada (`notionalRealDoPiloto` é null fora do ramo do piloto),
         * e null nunca vira 0 — sem medida, sem número.
         */
        notionalUsd: (typeof body.price === "number" ? quantidadeAutorizada * body.price : null)
          ?? notionalRealDoPiloto },
      creds,
      /**
       * ⚠️⚠️⚠️ A130-B §17 — A VAGA DO TETO DIÁRIO É RESERVADA, NÃO REPORTADA.
       *
       * O navegador contava o trade DEPOIS, num POST separado para
       * `/api/autopilot/session/record-fire`. Três problemas de uma vez:
       *
       *   · a contagem dependia de o cliente mandar (aba fechada = não contou);
       *   · `/api/cex/order` não conferia o teto ANTES de disparar;
       *   · `bump_session_trades` é `trades_today = trades_today + n` sem teto,
       *     então dois cliques simultâneos com 4/5 viravam 6.
       *
       * Agora a vaga é RESERVADA pelo servidor, atomicamente (compare-and-swap
       * em `reservarTradeDaSessao`), na costura que o executor já tinha para
       * isso — entre a autorização e o SUBMITTING.
       *
       * ⚠️ `liberar` SÓ RODA NA RECUSA PROVADA. O executor a chama em três
       * pontos, todos com prova de que nada saiu, e NUNCA em `UNKNOWN`:
       * devolver a vaga sobre dúvida autorizaria um segundo envio para um
       * dinheiro que talvez já tenha saído (INVARIANTE 4).
       *
       * ⚠️ Ordem MANUAL não reserva nada — ela não tem sessão nem teto diário.
       */
      /**
       * ⚠️⚠️ A MESMA PRIMITIVA QUE O CRON USA — A132.
       *
       * Este fechamento era escrito aqui dentro, e o cron contava DEPOIS da
       * ordem com `bumpSessionTrades` (soma sem conferir teto). Dois canais,
       * duas formas de gastar a mesma vaga: com 4/5, os dois passavam e o dia
       * fechava em 6. Agora é uma função só, chamada pelos dois.
       */
      /**
       * ⚠️⚠️ A DEVOLUÇÃO É DAS TRÊS JUNTAS — vaga do dia, posse e exposição.
       *
       * O executor chama `liberar` apenas onde PROVA que nada saiu. Era o
       * lugar certo para a vaga diária desde o A130-B; com as reservas de
       * inventário (A134/A135), é o lugar certo para elas também. E o
       * silêncio no desfecho INCERTO vale para as três: devolver sobre dúvida
       * autorizaria uma segunda ordem para um dinheiro que talvez já tenha
       * saído.
       */
      ehAutopilot && sessaoDoPilotoId
        ? (() => {
            const vaga = reservaDaVagaDiaria(sessaoDoPilotoId, hojeDoPiloto!);
            return {
              /**
               * ⚠️⚠️⚠️ AS TRÊS RESERVAS, COM O INTENT NA MÃO — A134/A135/A137.
               *
               * A costura roda entre AUTHORIZED e SUBMITTING: o intent já
               * existe, e é a ele que o compromisso pertence. Antes as
               * reservas de inventário eram tomadas lá em cima, sem dono, num
               * contador agregado com prazo — e o prazo esquecia ordem viva.
               *
               * ⚠️ RESERVA LIMITADA É RECUSA AQUI. O intent já foi gravado com
               * a quantidade; conceder menos faria a linha mentir sobre o que
               * saiu. Se alguém prometeu a bolsa entre o pré-voo e este
               * instante, nada sai.
               */
              reservar: async (intentId: string) => {
                const daVaga = await vaga.reservar(intentId);
                if (!daVaga.ok) return daVaga;
                intentComReserva = intentId;
                /**
                 * ⚠️⚠️⚠️ SE A SEGUNDA ETAPA RECUSA, A PRIMEIRA VOLTA — A141.
                 *
                 * A composição consumia a vaga do dia e, recusando a posse ou
                 * a exposição, devolvia `ok:false` com ela JÁ GASTA. O
                 * executor não chama `liberar` quando a reserva falha — do
                 * ponto de vista dele nada foi reservado —, e o caller só
                 * soltava o inventário. ZERO ordem enviada e `trades_today` um
                 * a mais: um trade do dia comido por uma ordem inexistente.
                 */
                const desfazerVaga = async (porque: string) => {
                  const devolveu = await vaga.liberar();
                  await devolverReservasEmVoo();
                  if (!devolveu) {
                    await recordEvent("autopilot_rollback_da_vaga_falhou", {
                      wallet: walletDoPiloto ?? undefined, meta: {
                        severity: "high", canal: "browser", session: sessaoDoPilotoId,
                        intent: intentId, porque,
                        why: "a segunda etapa da reserva recusou e a vaga diaria NAO "
                          + "voltou. Nenhuma ordem saiu, e o usuario perdeu um trade do dia.",
                      } });
                  }
                  return { ok: false as const, porque };
                };
                if (side === "sell") {
                  const posse = await reservarVendaDoBot(intentId, quantidadeAutorizada);
                  if (!posse.ok) return desfazerVaga(`posse: ${posse.porque}`);
                  if (posse.limitada || posse.qtd + 1e-12 < quantidadeAutorizada) {
                    return desfazerVaga("posse: a bolsa foi prometida a outra venda entre "
                      + "a autorizacao e a reserva — nada sai");
                  }
                } else if (entradaReservavelUsd != null) {
                  const exposicao = await reservarExposicaoDoBot(
                    intentId, entradaReservavelUsd, tetoDeExposicaoUsd);
                  if (!exposicao.ok) return desfazerVaga(`exposicao: ${exposicao.porque}`);
                }
                return { ok: true as const };
              },
              liberar: async () => {
                await vaga.liberar();
                await devolverReservasEmVoo();
              },
            };
          })()
        : undefined,
    );

    if (r.desfecho === "incerto") {
      /**
       * ⚠️⚠️ O CASO QUE ANTES VIRAVA ERRO 5xx E SUMIA.
       *
       * A ordem PODE estar na corretora. Devolver "falhou" convidaria o usuário
       * a mandar de novo — o retry destrutivo que o briefing proíbe. O intent
       * fica em UNKNOWN com a chave de idempotência, e a reconciliação decide.
       *
       * ⚠️⚠️ UMA RECONCILIAÇÃO IMEDIATA, ENQUANTO A CREDENCIAL ESTÁ NA MÃO
       * (ponto 9 do Round 2). Esta rota DESCARTA a credencial ao final — o
       * recuperador global não consegue olhar a venue por um intent manual, e
       * a resposta antiga prometia "a reconciliacao vai confirmar em ate
       * alguns minutos", o que para ordem manual é MENTIRA. Agora a rota faz
       * UMA tentativa segura na hora: `reconciliarIntent` é LEITURA por
       * clientOrderId — NUNCA reenvio. Se ela conclui, respondemos o estado
       * real. Se não, o 202 diz a verdade: reconciliar exige reautenticar.
       */
      const dbRec = getSupabaseAdmin();
      if (dbRec) {
        try {
          const pendente = await intentPorId(dbRec, r.intentId);
          if (pendente) {
            const rec = await reconciliarIntent({
              db: dbRec, credenciais: async () => creds,
            }, pendente);
            if (rec.desfecho === "resolvido") {
              const final = await intentPorId(dbRec, r.intentId);
              if (final && final.state === "FILLED") {
                await recordEvent("cex_order_reconciliada_na_hora", { meta: {
                  exchange, symbol: body.symbol, intentId: r.intentId, estado: final.state,
                } });
                /**
                 * ⚠️⚠️⚠️ ESTE CAMINHO NÃO PROJETAVA — achado da revisão
                 * adversarial, e o pior dos que ela achou.
                 *
                 * Aqui a ordem era INCERTA, a reconciliação imediata provou
                 * que executou, e a função RETORNAVA. A projeção do fim da
                 * rota nunca era alcançada, e `reconciliarIntent` (diferente
                 * de `reconciliarPendentes`) não projeta. Pior: o intent agora
                 * é FILLED, que é TERMINAL — o recuperador global não o olha
                 * mais. Ordem executada, dinheiro movido, posição fora do
                 * livro para sempre, sem um evento sequer.
                 */
                await projetarOuAvisar(r.intentId,
                  { total: final.fee_total ?? null, moeda: final.fee_currency ?? null });
                const filled = Number(final.filled_qty);
                const resp: CexOrderResponse = {
                  ok: true, exchange,
                  order: {
                    id: final.external_order_id ?? final.id,
                    symbol: body.symbol, side, type,
                    status: "closed",
                    amount: quantidadeAutorizada, filled,
                    remaining: Math.max(quantidadeAutorizada - filled, 0),
                    price: type === "limit" ? body.price : undefined,
                  },
                  filledImmediately: true,
                  fetchedAt: Date.now(),
                };
                return NextResponse.json(resp, {
                  headers: { "Cache-Control": "no-store, no-transform" } });
              }
              if (final && ehTerminal(final.state)) {
                // A corretora NEGOU a ordem em todos os caminhos: nada executou.
                return NextResponse.json(
                  { ok: false, error: "ordem_nao_executada_na_venue",
                    intentId: r.intentId, estado: final.state,
                    detail: "a corretora confirma que a ordem nao executou. "
                      + "Nada saiu da sua conta; pode tentar de novo." },
                  { status: 409, headers: { "Cache-Control": "no-store" } },
                );
              }
            }
          }
        } catch { /* cai no 202 honesto abaixo */ }
      }
      /**
       * ⚠️⚠️ O 202 HONESTO. Sem promessa falsa: para ordem MANUAL, esta rota
       * não guardou a credencial, então NINGUÉM vai reconciliar sozinho "em
       * alguns minutos" — intents manuais sem sessão nem entram na quarentena
       * automática do recuperador (ele os pula de propósito). O caminho real
       * é reautenticar e consultar. Para ordem do PILOTO (com sessão), o
       * recuperador global resolve pela sessão — e a resposta diz isso.
       */
      return NextResponse.json(
        { ok: false, error: "resultado_incerto", intentId: r.intentId,
          detail: r.porque,
          porque: ehAutopilot && sessaoDoPilotoId
            ? "a ordem pode ter sido aceita pela corretora. NAO reenvie: "
              + "a reconciliacao automatica confere pela sua sessao em alguns minutos."
            : "a ordem pode ter sido aceita pela corretora. NAO reenvie. "
              + "Esta rota NAO guarda a sua credencial, entao a reconciliacao "
              + "exige nova autenticacao: consulte o estado em /api/cex/order/status "
              + "com a mesma chave (somente leitura), informando o intentId acima "
              + "ao suporte se a duvida persistir." },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (r.desfecho === "recusado") {
      /**
       * ⚠️ DEVOLVE AQUI TAMBÉM. O executor só chama `liberar` nos três pontos
       * onde ELE reservou e provou que nada saiu; uma recusa anterior a isso
       * (kill-switch, credencial) não passa por lá, e a posição ficaria
       * prometida a uma ordem que não existe. Chamar duas vezes é inócuo.
       */
      await devolverReservasEmVoo();
      /**
       * ⚠️ `reserva_negada` NÃO É 500 — achado da revisão adversarial.
       *
       * Ela quer dizer "o teto diário desta sessão não tem vaga agora" (ou que
       * o contador virou o dia e só o cron o zera). É conflito de estado, não
       * erro do servidor: 409, para o cliente não tratar como falha a repetir.
       */
      const httpStatus = r.motivo === "kill_switch" ? 503
                       : r.motivo === "sem_banco" ? 503
                       : r.motivo === "reserva_negada" ? 409
                       : r.motivo === "recusada_pela_corretora" ? 400 : 500;
      return NextResponse.json(
        { ok: false, error: r.motivo, detail: sanitizeUpstreamMessage(r.porque, body.apiKey),
          intentId: r.intentId },
        { status: httpStatus, headers: { "Cache-Control": "no-store" } },
      );
    }

    /**
     * ⚠️⚠️⚠️ O QUE O NAVEGADOR EXECUTOU ENTRA NO LIVRO DO SERVIDOR — A131.
     *
     * A compra do piloto era gravada em `localStorage` e em lugar nenhum do
     * servidor. Na passada seguinte, o cron lia `autopilot_positions` vazio:
     * `exposureUsd = 0`, `ownedBases` vazio. Dinheiro real comprado, e o dono
     * do inventário não sabia. Daí saíam três coisas: compra nova por cima do
     * teto de exposição, ausência de saída gerida pelo cron, e contexto errado
     * para o ZION.
     *
     * ⚠️ VENDA TAMBÉM PROJETA. Uma saída executada aqui precisa REDUZIR a
     * posição no servidor — senão o livro segue dizendo que o bot tem a bolsa
     * que acabou de vender.
     *
     * ⚠️ NÚMEROS DO LIVRO, NUNCA DO PEDIDO (§21). A RPC lê `filled_qty` /
     * `filled_quote` do intent; esta rota só passa o id. ACK sem preenchimento
     * não abre posição nenhuma — a projeção aplica delta zero e a reconciliação
     * abre quando (e se) executar.
     *
     * ⚠️ FALHA AQUI É BARULHENTA (§36). O dinheiro já se moveu e não dá para
     * desfazer; o que não pode é passar por normal. A projeção é retentável: a
     * reconciliação chama a MESMA RPC, que aplica o delta que faltar.
     */
    // ⚠️ Esta rota não emite ordem simulada — `simulated` nasce `false` no
    // intent —, e a RPC recusa simulado de novo, do lado do banco (§31).
    if (ehAutopilot && r.filledQty > 0) {
      await projetarOuAvisar(r.intentId, { total: r.feeTotal, moeda: r.feeCurrency });
    }

    /**
     * ⚠️⚠️⚠️ A SAÍDA DO NAVEGADOR TAMBÉM PRECISA FICAR ARMADA NO SERVIDOR —
     * achado da revisão adversarial.
     *
     * `markServerExitArmed` documenta em maiúsculas o que acontece quando a
     * marca não entra: *"a passada seguinte arma DE NOVO e vende duas vezes a
     * mesma bolsa"*. O navegador marcava só no `localStorage` — o livro do
     * servidor continuava `open` com a bolsa inteira, e tanto o cron quanto
     * uma segunda aba podiam mandar outra venda da MESMA posição.
     *
     * ⚠️ SÓ QUANDO A ORDEM CONTINUA VIVA: limitada aceita sem preencher tudo.
     * Preenchimento total já reduziu a posição pela projeção.
     */
    if (ehAutopilot && side === "sell" && type === "limit"
        && sessaoDoPilotoId && r.externalOrderId
        && r.filledQty < quantidadeAutorizada) {
      const baseDaSaida = body.symbol.split(/[\/\-]/)[0];
      // ⚠️ A139: grava o intent da saída, não só o número da ordem.
      const marcou = await markServerExitArmed(
        sessaoDoPilotoId, baseDaSaida, r.externalOrderId, r.intentId);
      if (!marcou.ok) {
        await recordEvent("autopilot_saida_nao_armada", { wallet: walletDoPiloto ?? undefined, meta: {
          severity: "high", canal: "browser", session: sessaoDoPilotoId,
          base: baseDaSaida, ordem: r.externalOrderId, erro: marcou.erro,
          why: "a ordem de venda esta viva na corretora e o livro nao sabe. A passada "
            + "seguinte pode armar de novo e vender duas vezes a mesma bolsa.",
        } });
      }
    }

    /**
     * ⚠️ `filledImmediately` AGORA SAI DO LIVRO, não do ACK (achado A81).
     * Antes ele era `status === "closed" || (market && filled > 0)`; um ACK sem
     * preenchimento podia vir como "preenchido" para a tela.
     */
    const resp: CexOrderResponse = {
      ok:        true,
      exchange,
      order: {
        id: r.externalOrderId ?? r.intentId,
        symbol: body.symbol, side, type,
        status: r.state === "FILLED" ? "closed" : "open",
        amount: quantidadeAutorizada,
        filled: r.filledQty,
        remaining: Math.max(quantidadeAutorizada - r.filledQty, 0),
        price: type === "limit" ? body.price : undefined,
      },
      filledImmediately: r.state === "FILLED",
      fetchedAt: Date.now(),
    };
    // ⚠️ AGUARDADO: uma ordem REAL acabou de ser colocada na corretora. Perder
    // este registro deixa um buraco no extrato do usuário — e a resposta já
    // pagou uma ida à corretora, então um insert não é o que pesa aqui.
    await recordEvent("cex_order", {
      meta: {
        exchange,
        symbol: body.symbol,
        side,
        type,
        filledImmediately: r.state === "FILLED",
        intentId: r.intentId,
        estado: r.state,
        notional: typeof body.price === "number" ? quantidadeAutorizada * body.price : null,
      },
    });
    return NextResponse.json(resp, {
      headers: { "Cache-Control": "no-store, no-transform" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[cex/order]", exchange, body.symbol, side, type, "failed:", msg);
    const code = classifyCexError(msg);
    logError("cex/order", code, { exchange, symbol: body.symbol, side, type });
    const detail = sanitizeUpstreamMessage(msg, body.apiKey);
    return NextResponse.json(
      { ok: false, error: code, detail },
      { status: statusForError(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
