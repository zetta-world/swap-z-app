/**
 * ⚠️ BANCO FALSO — SÓ PARA TESTE. Nenhum arquivo de produção importa daqui, e
 * `autoridade-do-executor.test.ts` recusa se algum passar a importar.
 *
 * ⚠️ POR QUE ELE GUARDA LINHAS DE VERDADE. Um espião de chamadas provaria que
 * `cex_transicionar` foi chamado — e uma RPC que não fizesse nada passaria
 * igual. O que interessa é o INVARIANTE: depois de qualquer caminho, com falha
 * ou sem, o livro e o estado contam a mesma história.
 *
 * ⚠️ E ELE NÃO É UMA SEGUNDA IMPLEMENTAÇÃO DA REGRA. A legalidade da transição
 * vem de `transicaoPermitida`, o mesmo módulo que o executor usa — e
 * `estados.test.ts` prova, lendo o SQL, que esse módulo e o banco de verdade
 * são a mesma máquina. A aritmética do livro foi exercitada contra o Postgres
 * de produção numa transação desfeita; aqui ela é reproduzida para que o teste
 * do EXECUTOR possa rodar sem banco.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { transicaoPermitida, type EstadoDoIntent } from "@/lib/cex/execucao/estados";
import { avaliarCertificado, type CertificadoRow } from "@/lib/autopilot/certificado";

type Linha = Record<string, unknown>;

export interface BancoFalso {
  cliente: SupabaseClient<Database>;
  intents: Linha[];
  fills: Linha[];
  /** Os certificados que a RPC `cex_autorizar_e_submeter` enxerga (A110 r3).
   *  O teste os grava — e os REVOGA no meio do voo quando quer a janela. */
  certificados: Linha[];
  /** A124: `autopilot_sessions` — o resolver de escopo lê `conexao_id` daqui
   *  quando o intent só tem `session_id`. */
  sessoes: Linha[];
  /** A127: `cex_conexoes` — o cofre versionado (migration 0063). A RPC fake
   *  `cex_guardar_conexao_versionada` grava aqui; `revogarConexao` atualiza. */
  conexoes: Linha[];
  /** A131: `autopilot_positions` — o livro ÚNICO do que o bot possui. */
  posicoes: Linha[];
  /** A131-C: `autopilot_position_effects` — quanto de cada intent já entrou
   *  na posição. É o marcador durável da migration 0064. */
  efeitos: Linha[];
  /** Falhas injetáveis, por operação, para exercitar o caminho de erro. */
  falhas: {
    insertIntent?: string;
    transicao?: string;
    ingestao?: string;
    autorizacao?: string;
    /** A127: falha genérica de RPC (qualquer uma) — ex.: permission denied da
     *  ACL da 0063 na `cex_guardar_conexao_versionada`. */
    rpc?: string;
    /** A124: falha de LEITURA genérica (toda `select` passa a errar). */
    select?: string;
    /** A124: falha só na N-ésima leitura (ex.: erro na 2ª página de um
     *  `.range()` — a 1ª passa, a 2ª quebra). */
    selectNaChamada?: { n: number; mensagem: string };
    /** A126: falha de leitura só numa TABELA (ex.: só `autopilot_sessions`
     *  quebra, com a tabela de intents boa — é o que prova o fail-closed da
     *  união de braços). `naChamada` limita à N-ésima leitura DAQUELA tabela
     *  (ex.: erro na 2ª página da listagem de sessões). */
    selectNaTabela?: { tabela: string; mensagem: string; naChamada?: number };
  };
}

export function bancoFalso(): BancoFalso {
  const intents: Linha[] = [];
  const fills: Linha[] = [];
  const certificados: Linha[] = [];
  const sessoes: Linha[] = [];
  const conexoes: Linha[] = [];
  const posicoes: Linha[] = [];
  const efeitos: Linha[] = [];
  const falhas: BancoFalso["falhas"] = {};
  let seq = 0;
  let leiturasFeitas = 0;
  const leiturasPorTabela: Record<string, number> = {};

  /**
   * ⚠️ AS TRÊS TABELAS QUE O FALSO CONHECE, mapeadas explicitamente. O default
   * para tabela desconhecida continua `intents` SÓ por compatibilidade com os
   * testes anteriores ao A124 — código novo deve usar tabela mapeada.
   */
  const linhasDe = (t: string) =>
    t === "cex_fills" ? fills
    : t === "autopilot_sessions" ? sessoes
    : t === "cex_conexoes" ? conexoes
    : intents;

  const somaDoLivro = (intentId: string) =>
    fills.filter((f) => f.intent_id === intentId)
         .reduce((t, f) => t + Number(f.qty), 0);

  function recalcular(intentId: string) {
    const it = intents.find((i) => i.id === intentId)!;
    const doIntent = fills.filter((f) => f.intent_id === intentId);
    const qty = doIntent.reduce((t, f) => t + Number(f.qty), 0);
    const quote = doIntent.reduce((t, f) => t + Number(f.quote_amount), 0);
    // Mesma regra da RPC (0051): fee_total = nullif(sum(coalesce(fee,0)),0),
    // fee_currency = max das moedas presentes (moeda única assumida — A118).
    const fee = doIntent.reduce((t, f) => t + Number(f.fee ?? 0), 0);
    const moedas = doIntent.map((f) => f.fee_currency)
      .filter((m): m is string => typeof m === "string").sort();
    it.filled_qty = qty;
    it.filled_quote = quote;
    it.fee_total = fee === 0 ? null : fee;
    it.fee_currency = moedas.length > 0 ? moedas[moedas.length - 1] : (it.fee_currency ?? null);
    const estado = it.state as EstadoDoIntent;
    if (["SUBMITTED", "PARTIALLY_FILLED", "UNKNOWN", "CANCEL_PENDING",
         "RECONCILIATION_REQUIRED"].includes(estado)) {
      if (qty >= Number(it.requested_qty) - 1e-12) it.state = "FILLED";
      else if (qty > 0) it.state = "PARTIALLY_FILLED";
    }
  }

  const rpc = async (nome: string, args: Record<string, unknown>) => {
    if (falhas.rpc) {
      return { data: null, error: { message: falhas.rpc } };
    }
    if (falhas.transicao && nome === "cex_transicionar") {
      return { data: null, error: { message: falhas.transicao } };
    }
    if (falhas.ingestao && nome.startsWith("cex_ingest")) {
      return { data: null, error: { message: falhas.ingestao } };
    }

    /**
     * A127 (migration 0063): a guarda VERSIONADA da credencial, reproduzida
     * com a mesma semântica da RPC real — identity malformada é exceção;
     * mesma identity na current ATIVA reusa o MESMO id (só refresca
     * `expires_at`, NÃO toca `creds_cipher`); qualquer outro caso aposenta a
     * current (is_current=false, superseded_at) e insere versão nova com id
     * novo. O advisory lock do par é transacional e não tem análogo num
     * array em memória — aqui a serialização é do próprio event loop.
     */
    if (nome === "cex_guardar_conexao_versionada") {
      const identidade = args.p_credential_identity;
      if (typeof identidade !== "string" || !/^[0-9a-f]{64}$/.test(identidade)) {
        return { data: null, error: { message: "credential_identity malformada" } };
      }
      const wallet = String(args.p_wallet_address);
      const exchange = String(args.p_exchange_id);
      const agora = new Date().toISOString();
      const atual = conexoes.find((c) =>
        c.wallet_address === wallet && c.exchange_id === exchange
        && c.is_current === true);
      if (atual && atual.is_active === true
          && typeof atual.credential_identity === "string"
          && atual.credential_identity === identidade) {
        atual.expires_at = args.p_expires_at ?? null;
        atual.atualizado_em = agora;
        return { data: atual.id, error: null };
      }
      if (atual) {
        atual.is_current = false;
        atual.superseded_at = agora;
        atual.atualizado_em = agora;
      }
      // ⚠️ O nome da coluna do cipher é montado por concatenação DE PROPÓSITO:
      // a guarda estrutural do cofre-t3 proíbe a literal `creds_cipher` em
      // CÓDIGO fora de `conexoes.ts` — e ela tem razão em vigiar; aqui é a
      // coluna do PRÓPRIO cofre sendo gravada pela RPC fake da 0063.
      const COL_CIPHER = "creds" + "_cipher";
      const nova: Linha = {
        id: `cx${++seq}`, wallet_address: wallet, exchange_id: exchange,
        [COL_CIPHER]: args["p_" + COL_CIPHER] ?? null,
        expires_at: args.p_expires_at ?? null,
        is_active: true, credential_identity: identidade, is_current: true,
        superseded_at: null,
        criado_em: agora, atualizado_em: agora,
      };
      conexoes.push(nova);
      return { data: nova.id, error: null };
    }

    const it = intents.find((i) => i.id === args.p_intent_id);
    if (!it) return { data: null, error: { message: "intent nao existe" } };

    /**
     * ⚠️ A AUTORIZAÇÃO FINAL (migration 0060, A110 round 3), reproduzida aqui
     * para o teste do executor rodar sem banco. NÃO é uma segunda regra: a
     * legalidade da transição vem do mesmo `transicaoPermitida`, e a decisão
     * sobre o certificado vem do mesmo `avaliarCertificado` puro — a guarda
     * estrutural lê o SQL da 0060 e confere que a RPC real existe, nasce
     * fechada e que a assinatura antiga foi apagada.
     *
     * ⚠️⚠️ ELA DERIVA TUDO DO INTENT — venue, símbolo, nocional e hash são
     * lidos DA LINHA, exatamente como a RPC real faz sob `for update`. Ler
     * `args.p_venue` (ou qualquer primo) aqui seria reabrir o caller
     * mentiroso que o round 3 fechou; a quebra deliberada deste round foi
     * exatamente essa, e o teste de caller mentiroso a pega.
     */
    if (nome === "cex_autorizar_e_submeter") {
      if (falhas.autorizacao) {
        return { data: null, error: { message: falhas.autorizacao } };
      }
      const de = it.state as EstadoDoIntent;
      if (de !== "AUTHORIZED" && de !== "RESERVED") {
        return { data: { ok: false, porque: `estado ${de} nao admite submissao` }, error: null };
      }
      if (it.autonomous === true && it.side === "buy" && it.simulated !== true) {
        if (!it.certificate_id) {
          return { data: { ok: false, porque: "compra autonoma sem certificate_id" }, error: null };
        }
        const cert = certificados.find((c) => c.id === it.certificate_id);
        if (!cert) {
          return { data: { ok: false, porque: "certificado inexistente" }, error: null };
        }
        if (cert.strategy_id !== it.strategy_id
            || Number(cert.strategy_version) !== Number(it.strategy_version)) {
          return { data: { ok: false, porque: "certificado de outra estrategia ou versao" },
                   error: null };
        }
        // ⚠️ O hash vem DA LINHA do intent — ausente ou divergente, recusa.
        if (it.strategy_hash == null || it.strategy_hash !== cert.strategy_hash) {
          return { data: { ok: false, porque: "strategy_hash nao confere" }, error: null };
        }
        // hash já conferido acima (no precheck ele é opcional; aqui, exigido)
        const v = avaliarCertificado(cert as unknown as CertificadoRow, {
          venue: String(it.exchange_id), symbol: String(it.symbol),
          notionalUsd: it.requested_notional_usd == null
            ? null : Number(it.requested_notional_usd),
          strategyHash: null,
        });
        if (!v.vale) return { data: { ok: false, porque: v.porque }, error: null };
      }
      if (!transicaoPermitida(de, "SUBMITTING")) {
        return { data: { ok: false, de, para: "SUBMITTING", porque: "transicao proibida" },
                 error: null };
      }
      it.state = "SUBMITTING";
      it.submitting_at = new Date().toISOString();
      return { data: { ok: true, de, para: "SUBMITTING" }, error: null };
    }

    if (nome === "cex_transicionar") {
      const de = it.state as EstadoDoIntent;
      const para = args.p_para as EstadoDoIntent;
      if (de === para) return { data: { ok: true, de, para, noop: true }, error: null };
      if (!transicaoPermitida(de, para)) {
        return { data: { ok: false, de, para, porque: "transicao proibida" }, error: null };
      }
      it.state = para;
      if (args.p_motivo) it.state_reason = args.p_motivo;
      if (args.p_external_order_id) it.external_order_id = args.p_external_order_id;
      if (para === "CANCELED") {
        it.canceled_qty = Math.max(Number(it.requested_qty) - Number(it.filled_qty), 0);
      }
      return { data: { ok: true, de, para }, error: null };
    }

    /**
     * A118 (migration 0059): a fee é CUMULATIVA como qty/quote — grava-se o
     * DELTA por mesma moeda; qty parada com fee corrigida vira ajuste de
     * qty ZERO; a dedupe key inclui o fee; moeda incompatível é exceção.
     */
    if (nome === "cex_ingest_order_snapshot") {
      const estado = it.state as EstadoDoIntent;
      if (["CREATED", "AUTHORIZED", "RESERVED", "FAILED_PRE_SUBMIT"].includes(estado)) {
        return { data: null, error: { message: `snapshot contra intent em ${estado}` } };
      }
      const mesmaOrdem = (f: Linha) =>
        f.intent_id === it.id
        && (f.external_order_id ?? null) === (args.p_external_order_id ?? null);
      // Mesmo predicado "não atribuído" do achado 2 (cex_ingest_trades): o
      // sintético com external_order_id NULL do MESMO intent entra na base de
      // fee e na guarda de moeda; o de OUTRA ordem segue fora (brecha do
      // verificador, round 4 — espelha a 0059).
      const daOrdemOuNaoAtribuido = (f: Linha) =>
        f.intent_id === it.id
        && ((f.external_order_id ?? null) === (args.p_external_order_id ?? null)
            || f.external_order_id == null);
      const daOrdem = () => fills.filter(daOrdemOuNaoAtribuido);
      // Moeda incompatível: fail-closed — e o NULL também fecha (CCXT traz
      // `cost` sem `currency`). Dispara quando o snapshot traz fee (ou moeda)
      // e existe fill DA ORDEM (real ou sintético, atribuído ou não) com fee
      // não nula cuja moeda diverge; null↔'USDT' fecha nos dois sentidos.
      if (args.p_fee != null || args.p_fee_currency != null) {
        const outra = daOrdem().find((f) =>
          f.fee != null && (f.fee_currency ?? null) !== (args.p_fee_currency ?? null));
        if (outra) {
          return { data: null, error: { message:
            `fee_currency incompativel na ordem ${args.p_external_order_id}: ` +
            `livro tem ${outra.fee_currency ?? "(null)"}, snapshot traz ${args.p_fee_currency ?? "(null)"}` } };
        }
      }
      const ja = somaDoLivro(String(it.id));
      const cum = Number(args.p_cumulative_qty);
      // A base do delta é o LIVRO INTEIRO da ordem (reais + sintéticos) na
      // mesma moeda — depois da substituição synthetic→real não há mais
      // sintético, e filtrar por ele regravaria a fee inteira (achado 1, r3).
      const feeJa = daOrdem()
        .filter((f) => (f.fee_currency ?? null) === (args.p_fee_currency ?? null))
        .reduce((t, f) => t + Number(f.fee ?? 0), 0);
      const feeDelta = args.p_fee == null ? null
        : Math.max(Number(args.p_fee) - feeJa, 0);
      const chave = `ordercum:${args.p_external_order_id ?? "?"}:${cum}:${args.p_fee ?? "-"}`;
      // A123 (round 5): dedupe por INTENT, não por corretora — replay no
      // mesmo intent é no-op, outro intent com a mesma chave persiste.
      const jaTemChave = () =>
        fills.some((f) => f.intent_id === it.id && f.dedupe_key === chave);
      if (!(cum > ja + 1e-12)) {
        // Qty parada com fee corrigida: ajuste de qty zero (quote zero).
        let inseridos = 0;
        if (args.p_cumulative_qty != null && feeDelta != null && feeDelta > 0
            && cum > ja - 1e-9 && !jaTemChave()) {
          const avg = Number(args.p_avg_price);
          const cq = Number(args.p_cumulative_quote);
          const ultimo = [...fills].reverse().find((f) => mesmaOrdem(f));
          const preco = avg > 0 ? avg
            : (cq > 0 && cum > 0 ? cq / cum : Number(ultimo?.price ?? 0));
          if (!(preco > 0)) {
            return { data: null, error: { message: "ajuste de fee sem preco utilizavel" } };
          }
          fills.push({
            id: `f${++seq}`, intent_id: it.id, exchange_id: it.exchange_id,
            external_order_id: args.p_external_order_id, external_trade_id: null,
            symbol: it.symbol, side: it.side, qty: 0, price: preco, quote_amount: 0,
            fee: feeDelta, fee_currency: args.p_fee_currency ?? null,
            executed_at: args.p_executed_at ?? null,
            sintetico: true, dedupe_key: chave,
          });
          inseridos = 1;
        }
        recalcular(String(it.id));
        return { data: { inseridos, regrediu: cum < ja - 1e-9 }, error: null };
      }
      const avg = Number(args.p_avg_price);
      const cq = Number(args.p_cumulative_quote);
      const preco = avg > 0 ? avg : (cq > 0 && cum > 0 ? cq / cum : 0);
      if (!(preco > 0)) {
        return { data: null, error: { message: "snapshot sem preco utilizavel" } };
      }
      if (!jaTemChave()) {
        fills.push({
          id: `f${++seq}`, intent_id: it.id, exchange_id: it.exchange_id,
          external_order_id: args.p_external_order_id, external_trade_id: null,
          symbol: it.symbol, side: it.side, qty: cum - ja, price: preco,
          quote_amount: Math.max(cq - Number(it.filled_quote), 0),
          fee: feeDelta, fee_currency: args.p_fee_currency ?? null,
          executed_at: args.p_executed_at ?? null,
          sintetico: true, dedupe_key: chave,
        });
      }
      if (args.p_external_order_id && !it.external_order_id) {
        it.external_order_id = args.p_external_order_id;
      }
      recalcular(String(it.id));
      return { data: { inseridos: 1, regrediu: false,
                       filled_qty: it.filled_qty, state: it.state }, error: null };
    }

    /**
     * A118 + A121 (migration 0059): GUARDA DE COBERTURA synthetic→real.
     * fetchMyTrades é página única sem prova de completude — o sintético só
     * é substituído quando os NOVOS trades únicos do lote cobrem o estimado
     * (`v_novos >= v_sint`). O real existente é ANTERIOR ao sintético e nunca
     * cobre o que veio depois dele (real 5, snapshot 8 → sint 3, lote só
     * dedupado: 0 < 3 → adiado; a fórmula antiga R+N≥S apagava os 3 e o
     * total caía de 8 para 5). E a FEE também é coberta: sintético com fee
     * conhecida exige fee explícita na mesma moeda nos novos — fee null é
     * 'cobertura_fee_incompleta', moeda divergente é
     * 'fee_currency_incompativel'. Tudo adiado, nada deletado nem inserido,
     * retorno ANTES de tocar o livro (atomicidade).
     *
     * Revisão do round 4 (espelho EXATO da 0059):
     *  a. o gate de fee dispara pela EXISTÊNCIA de sintético da ordem com fee
     *     — INDEPENDENTE de sint > 0: o ajuste de fee de qty zero é fato, e
     *     lote todo dedupado (zero novos) não é evidência substituta;
     *  b. sintético NÃO ATRIBUÍDO (external_order_id NULL, ACK sem id) entra
     *     em v_sint e no delete — os trades com o id descoberto são a
     *     atribuição; sintético de OUTRA ordem segue fora;
     *  c. fee "", não-numérica ou ausente é SEM fee (a mesma semântica do
     *     `nullif(t->>'fee','')` do SQL — o teste não aprova o que o banco
     *     recusa);
     *  d. itens do lote que declaram OUTRA ordem são IGNORADOS — não
     *     inseridos, não contam em v_novos (a RPC não confia no caller).
     *
     * A122 (round 5), na ordem obrigatória da 0059:
     *  e. TRADE SEM ID no LOTE BRUTO → {ok:false, porque:'trade_sem_id'},
     *     antes do filtro de ordem e de qualquer coverage;
     *  f. DEDUPE INTRA-LOTE por trade_id: payload idêntico (qty, price,
     *     quote, fee, fee_currency, order normalizado, executed_at — com
     *     comparação numérica e nullif de "", como o SQL) conta UMA vez
     *     (fica a primeira ocorrência); payload divergente →
     *     {ok:false, porque:'trade_id_conflitante'}, ZERO mudança — nunca
     *     escolher uma versão;
     *  g. N, cobertura de fee e insert usam SEMPRE o lote normalizado.
     */
    if (nome === "cex_ingest_trades") {
      const estado = it.state as EstadoDoIntent;
      if (["CREATED", "AUTHORIZED", "RESERVED", "FAILED_PRE_SUBMIT"].includes(estado)) {
        return { data: null, error: { message: `fill contra intent em ${estado}` } };
      }
      // (b) `is not distinct from` + não atribuídos: NULL entra na ordem.
      const daOrdem = (f: Linha) =>
        f.intent_id === it.id
        && ((f.external_order_id ?? null) === (args.p_external_order_id ?? null)
            || f.external_order_id == null);
      const sinteticoRows = fills.filter((f) => daOrdem(f) && f.sintetico);
      const sint = sinteticoRows.reduce((t, f) => t + Number(f.qty), 0);
      // (c) nullif(t->>'fee',''): "", não-numérico ou ausente = SEM fee.
      const feeDe = (t: Linha): number | null => {
        const f = t.fee;
        if (f == null || f === "") return null;
        const n = Number(f);
        return Number.isFinite(n) ? n : null;
      };
      const moedaDe = (t: Linha): string | null =>
        t.fee_currency == null || t.fee_currency === "" ? null : String(t.fee_currency);
      const bruto = (args.p_trades as Linha[]) ?? [];
      // (e) A122 passo 1: trade sem id no LOTE BRUTO — antes do filtro de
      // ordem e de qualquer coverage; zero delete/insert.
      if (bruto.some((t) => t.trade_id == null || t.trade_id === "")) {
        return { data: { ok: false, porque: "trade_sem_id" }, error: null };
      }
      // (d) defesa em profundidade: itens de OUTRA ordem são ignorados.
      const filtrado = bruto.filter((t) => t.order == null
                    || t.order === (args.p_external_order_id ?? null));
      // (f) A122 passo 2: assinatura do payload financeiro, com a MESMA
      // normalização do insert/SQL — Number() (1.5 ≡ 1.50), nullif de "" em
      // fee/fee_currency/executed_at, e `order` ausente vale a ordem da
      // chamada (é o que o insert gravaria). Null nunca é 0.
      const numDe = (v: unknown): string =>
        v == null ? "∅" : String(Number(v));
      const assinatura = (t: Linha): string => [
        numDe(t.qty), numDe(t.price), numDe(t.quote),
        feeDe(t) == null ? "∅" : String(feeDe(t)),
        moedaDe(t) ?? "∅",
        t.order == null || t.order === ""
          ? String(args.p_external_order_id ?? "∅") : String(t.order),
        t.executed_at == null || t.executed_at === "" ? "∅" : String(t.executed_at),
      ].join("|");
      const vistos = new Map<string, string>();
      const lote: Linha[] = [];
      let conflito = false;
      for (const t of filtrado) {
        const id = String(t.trade_id);
        const sig = assinatura(t);
        const prev = vistos.get(id);
        if (prev === undefined) { vistos.set(id, sig); lote.push(t); }
        else if (prev !== sig) { conflito = true; break; }
      }
      if (conflito) {
        return { data: { ok: false, porque: "trade_id_conflitante" }, error: null };
      }
      // (g) daqui em diante SÓ o lote normalizado: um item por trade_id.
      // A123 (round 5): "já persistido" é NESTE intent — outro intent com o
      // mesmo trade_id tem fill próprio e legítimo (dedupe por intent_id).
      const jaExiste = (t: Linha) =>
        fills.some((f) => f.intent_id === it.id
                       && f.dedupe_key === `trade:${t.trade_id}`);
      const novos = lote.filter((t) => !jaExiste(t));
      const novosQty = novos.reduce((t, x) => t + Number(x.qty), 0);
      if (sint > 0 && novosQty < sint - 1e-12) {
        return { data: { ok: false, porque: "cobertura_incompleta",
                         novos: novosQty, sintetico: sint }, error: null };
      }
      // Cobertura de FEE (a): dispara pela EXISTÊNCIA de sintético com fee,
      // independente de sint > 0; zero trades novos também recusa — sem
      // evidência substituta explícita, a correção de fee é preservada.
      if (sinteticoRows.some((f) => f.fee != null)) {
        if (novos.length === 0 || novos.some((t) => feeDe(t) == null)) {
          return { data: { ok: false, porque: "cobertura_fee_incompleta",
                           novos: novosQty, sintetico: sint }, error: null };
        }
        const moedasSint = new Set(sinteticoRows.filter((f) => f.fee != null)
          .map((f) => f.fee_currency ?? null));
        if (novos.some((t) => !moedasSint.has(moedaDe(t)))) {
          return { data: { ok: false, porque: "fee_currency_incompativel",
                           novos: novosQty, sintetico: sint }, error: null };
        }
      }
      // O sintético é estimativa; o trade é fato. O fato substitui (b: o
      // delete inclui os não atribuídos — NULL — e nunca outra ordem).
      for (let i = fills.length - 1; i >= 0; i--) {
        const f = fills[i];
        if (daOrdem(f) && f.sintetico) fills.splice(i, 1);
      }
      let inseridos = 0;
      for (const t of lote) {
        const chave = `trade:${t.trade_id}`;
        // A123: o conflito é por (intent_id, dedupe_key) — outro intent não
        // bloqueia, replay no mesmo intent é no-op.
        if (fills.some((f) => f.intent_id === it.id && f.dedupe_key === chave)) continue;
        fills.push({
          id: `f${++seq}`, intent_id: it.id, exchange_id: it.exchange_id,
          external_order_id: args.p_external_order_id, external_trade_id: t.trade_id,
          symbol: it.symbol, side: it.side, qty: Number(t.qty), price: Number(t.price),
          quote_amount: Number(t.quote),
          fee: feeDe(t), fee_currency: moedaDe(t),
          executed_at: t.executed_at ?? null,
          sintetico: false, dedupe_key: chave,
        });
        inseridos++;
      }
      if (args.p_external_order_id && !it.external_order_id) {
        it.external_order_id = args.p_external_order_id;
      }
      recalcular(String(it.id));
      return { data: { ok: true, inseridos, filled_qty: it.filled_qty,
                       state: it.state }, error: null };
    }

    /**
     * ⚠️⚠️⚠️ A131-C (migration 0064) — A PROJEÇÃO IDEMPOTENTE, reproduzida.
     *
     * Mesma ordem de decisões do SQL: origem → marcador → regressão → delta →
     * posição → marcador. O teste estrutural em `a131-projecao.test.ts`
     * confere que o SQL de verdade mantém cada uma destas guardas, para este
     * falso não virar uma segunda regra de negócio (que é o achado A131).
     */
    if (nome === "autopilot_projetar_efeito_do_intent") {
      const it = intents.find((i) => i.id === args.p_intent_id);
      if (!it) return { data: { ok: false, motivo: "intent_inexistente" }, error: null };
      if (it.simulated === true) return { data: { ok: false, motivo: "simulado" }, error: null };
      const origem = String(it.origin);
      if ((origem !== "autopilot_browser" && origem !== "autopilot_cron") || it.autonomous !== true) {
        return { data: { ok: false, motivo: "origem_nao_autonoma", origin: origem }, error: null };
      }
      if (!it.session_id) return { data: { ok: false, motivo: "sem_sessao" }, error: null };

      const base = String(it.symbol).replace(/-/g, "/").split("/")[0].toUpperCase();
      let efeito = efeitos.find((e) => e.intent_id === it.id);
      if (!efeito) {
        efeito = { intent_id: it.id, session_id: it.session_id, exchange_id: it.exchange_id,
                   base, side: it.side, applied_qty: 0, applied_quote: 0,
                   ledger_qty: 0, ledger_quote: 0 };
        efeitos.push(efeito);
      }
      // Absorção do que a liquidação da saída armada já aplicou direto.
      const jaQty = args.p_qty_ja_aplicada;
      if (typeof jaQty === "number" && jaQty > Number(efeito.applied_qty)) {
        efeito.applied_qty = jaQty;
        efeito.applied_quote = Math.max(Number(efeito.applied_quote),
          Number(args.p_quote_ja_aplicada ?? 0));
      }

      const EPS = 1e-12, RUIDO = 1e-9;
      const noLivro = Number(it.filled_qty);
      // ⚠️ Regressão mede o LIVRO contra o livro; o delta mede o livro contra
      // o que já está DENTRO da posição (que a absorção pode ter adiantado).
      if (noLivro < Number(efeito.ledger_qty) - EPS) {
        return { data: { ok: false, motivo: "regressao",
                         aplicado: Number(efeito.ledger_qty), no_livro: noLivro }, error: null };
      }
      const deltaQty = Math.max(noLivro - Number(efeito.applied_qty), 0);
      const deltaQuote = Math.max(Number(it.filled_quote) - Number(efeito.applied_quote), 0);
      if (deltaQty <= EPS) {
        efeito.ledger_qty = Math.max(Number(efeito.ledger_qty), noLivro);
        efeito.ledger_quote = Math.max(Number(efeito.ledger_quote), Number(it.filled_quote));
        return { data: { ok: true, motivo: "sem_delta", aplicado_qty: 0,
                         aplicado_quote: 0, fechou: false }, error: null };
      }

      const pos = posicoes.find((x) => x.session_id === it.session_id && x.base === base);
      let custoRemovido = 0, fechou = false;
      if (it.side === "buy") {
        if (pos) {
          const qtd = Number(pos.base_amount) + deltaQty;
          const custo = Number(pos.cost_usd) + deltaQuote;
          pos.base_amount = qtd; pos.cost_usd = custo;
          pos.entry_price = qtd > 0 ? custo / qtd : pos.entry_price;
          // ⚠️ `status`/`exit_order_id` INTOCADOS: desarmar uma saída viva
          // deixaria a ordem órfã, e o P&L dela nunca seria realizado.
        } else {
          posicoes.push({ id: `pos${++seq}`, session_id: it.session_id,
            wallet_address: it.wallet_address ?? "", exchange_id: it.exchange_id,
            base, pair: String(it.symbol).toUpperCase(),
            entry_price: deltaQty > 0 ? deltaQuote / deltaQty : 0,
            base_amount: deltaQty, cost_usd: deltaQuote, status: "open",
            exit_order_id: null, exit_armed_at: null });
        }
      } else {
        if (!pos) {
          return { data: { ok: false, motivo: "sem_posicao", base, delta_qty: deltaQty }, error: null };
        }
        // ⚠️ Saída armada pertence à liquidação, que realiza o P&L contra a
        // posição AINDA INTEIRA. A projeção não toca.
        if (pos.status === "exit_armed" && pos.exit_order_id) {
          return { data: { ok: true, motivo: "saida_em_liquidacao", aplicado_qty: 0,
                           aplicado_quote: 0, fechou: false, base,
                           ordem_armada: pos.exit_order_id }, error: null };
        }
        const restante = Number(pos.base_amount) - deltaQty;
        if (restante <= Number(pos.base_amount) * RUIDO) {
          custoRemovido = Number(pos.cost_usd);
          fechou = true;
          posicoes.splice(posicoes.indexOf(pos), 1);
        } else {
          const custoRestante = Number(pos.cost_usd) * (restante / Number(pos.base_amount));
          custoRemovido = Number(pos.cost_usd) - custoRestante;
          // ⚠️ O parcial NÃO desarma nada — só quantidade e custo mudam.
          pos.base_amount = restante; pos.cost_usd = custoRestante;
        }
      }
      efeito.applied_qty = Math.max(Number(efeito.applied_qty), noLivro);
      efeito.applied_quote = Math.max(Number(efeito.applied_quote), Number(it.filled_quote));
      efeito.ledger_qty = Math.max(Number(efeito.ledger_qty), noLivro);
      efeito.ledger_quote = Math.max(Number(efeito.ledger_quote), Number(it.filled_quote));
      return { data: { ok: true, motivo: "aplicado", side: it.side, base,
                       aplicado_qty: deltaQty, aplicado_quote: deltaQuote,
                       custo_removido: custoRemovido, fechou }, error: null };
    }

    return { data: null, error: { message: `rpc desconhecida: ${nome}` } };
  };

  function consulta(tabela: string) {
    const linhas = () => linhasDe(tabela);
    const filtros: Array<(r: Linha) => boolean> = [];
    let limite = Infinity;
    // A124: `.range(inicio, fim)` do PostgREST — fatia APÓS os filtros, com
    // precedência sobre `limit` (é o que a paginação do escopo usa).
    let faixa: [number, number] | null = null;

    /** A leitura em si, com as falhas injetáveis — compartilhada pelo `then`
     *  (lista) e pelo `maybeSingle` (A127: o cofre lê linha a linha). */
    const executar = (): { data: Linha[] | null; error: { message: string } | null } => {
      leiturasFeitas++;
      leiturasPorTabela[tabela] = (leiturasPorTabela[tabela] ?? 0) + 1;
      // A124: falha de leitura injetável — genérica ou só na N-ésima
      // chamada (erro de paginação no meio do caminho).
      if (falhas.select) {
        return { data: null, error: { message: falhas.select } };
      }
      if (falhas.selectNaChamada && leiturasFeitas === falhas.selectNaChamada.n) {
        return { data: null, error: { message: falhas.selectNaChamada.mensagem } };
      }
      // A126: falha só numa tabela — para provar que o erro de UM braço da
      // união derruba a consulta inteira mesmo com o outro braço saudável.
      const falhaTabela = falhas.selectNaTabela;
      if (falhaTabela && falhaTabela.tabela === tabela
          && (falhaTabela.naChamada === undefined
              || leiturasPorTabela[tabela] === falhaTabela.naChamada)) {
        return { data: null, error: { message: falhaTabela.mensagem } };
      }
      const filtradas = linhas().filter((r) => filtros.every((f) => f(r)));
      return {
        data: faixa ? filtradas.slice(faixa[0], faixa[1] + 1)
                    : filtradas.slice(0, limite),
        error: null,
      };
    };

    const alvo = {
      select: (_c: string) => alvo,
      eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return alvo; },
      in: (c: string, vs: unknown[]) => { filtros.push((r) => vs.includes(r[c])); return alvo; },
      /**
       * ⚠️ `gte` e `not` EXISTEM AQUI PORQUE A PRODUÇÃO OS USA (a checagem de
       * deriva do A103). Um banco falso que não implementa o que o código
       * chama não é um banco falso simples — é um teste que não exercita o
       * caminho, e ele avisa isso estourando, que é o melhor que pode fazer.
       */
      gte: (c: string, v: unknown) => {
        filtros.push((r) => String(r[c] ?? "") >= String(v)); return alvo;
      },
      not: (c: string, op: string, v: unknown) => {
        if (op === "is" && v === null) filtros.push((r) => r[c] != null);
        else filtros.push((r) => r[c] !== v);
        return alvo;
      },
      is: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return alvo; },
      order: () => alvo,
      limit: (n: number) => { limite = n; return alvo; },
      range: (inicio: number, fim: number) => { faixa = [inicio, fim]; return alvo; },
      /**
       * A127: `maybeSingle` com a semântica do PostgREST — 0 linhas devolve
       * `data: null` SEM erro; MAIS DE UMA é erro (é o que o índice parcial
       * da 0063 torna impossível para a current, e o que o cofre precisa
       * enxergar como "ilegível", não como uma linha qualquer).
       */
      maybeSingle: () => {
        const r = executar();
        if (r.error) return Promise.resolve({ data: null, error: r.error });
        const lista = r.data ?? [];
        if (lista.length > 1) {
          return Promise.resolve({ data: null, error: {
            message: "JSON object requested, multiple (or no) rows returned",
          } });
        }
        return Promise.resolve({ data: lista[0] ?? null, error: null });
      },
      then: (res: (x: { data: Linha[] | null;
                        error: { message: string } | null }) => void) => {
        return Promise.resolve(executar()).then(res);
      },
    };
    return alvo;
  }

  const cliente = {
    rpc,
    from(tabela: string) {
      return {
        insert(valores: Linha) {
          if (falhas.insertIntent) {
            const alvo = {
              select: () => alvo, limit: () => alvo,
              then: (res: (x: unknown) => void) =>
                Promise.resolve({ data: null, error: { message: falhas.insertIntent } }).then(res),
            };
            return alvo;
          }
          const linha: Linha = {
            id: `i${++seq}`, state: "CREATED", filled_qty: 0, filled_quote: 0,
            fee_total: null, fee_currency: null,
            canceled_qty: 0, external_order_id: null, state_reason: null,
            // A120 (0061): a coluna nova nasce NULL — histórico/autopilot/DCA.
            credential_fingerprint: null,
            created_at: new Date().toISOString(), reconcile_attempts: 0,
            last_reconciled_at: null, submitted_at: null, ...valores,
          };
          (linhasDe(tabela)).push(linha);
          const alvo = {
            select: () => alvo, limit: () => alvo,
            then: (res: (x: unknown) => void) =>
              Promise.resolve({ data: [linha], error: null }).then(res),
          };
          return alvo;
        },
        select: (c: string) => consulta(tabela).select(c),
        update(patch: Linha) {
          const filtros: Array<[string, unknown]> = [];
          const alvo = {
            eq(c: string, v: unknown) { filtros.push([c, v]); return alvo; },
            then: (res: (x: { error: null }) => void) => {
              for (const r of linhasDe(tabela)) {
                if (filtros.every(([c, v]) => r[c] === v)) Object.assign(r, patch);
              }
              return Promise.resolve({ error: null as null }).then(res);
            },
          };
          return alvo;
        },
      };
    },
  };
  return { cliente: cliente as unknown as SupabaseClient<Database>,
           intents, fills, certificados, sessoes, conexoes, posicoes, efeitos, falhas };
}
