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

    /**
     * ⚠️⚠️ A134/A135/A137 — AS RESERVAS, reproduzidas COM DONO.
     *
     * A primeira versão somava num contador agregado com prazo de validade.
     * O prazo esquecia ordem viva, e o agregado deixava a projeção de uma
     * ordem antiga consumir o compromisso de outra mais nova. Agora cada
     * reserva pertence a um intent, e o compromisso vivo é
     * `greatest(reservado − applied, 0)` enquanto ele puder preencher.
     */
    const TERMINAIS = new Set(["FILLED", "CANCELED", "FAILED_PRE_SUBMIT"]);
    /**
     * ⚠️⚠️ A140 — a taxa acumulada em USD, derivada do LIVRO, e o dia do
     * "banco". Nenhum dos dois vem de quem chama: era isso que fazia o mesmo
     * preenchimento render P&L diferente conforme quem o descobrisse.
     */
    const ESTAVEIS = new Set(["USDT", "USDC", "USD", "BUSD", "DAI", "TUSD", "FDUSD"]);
    /**
     * ⚠️⚠️⚠️ `NULL` NÃO É TAXA ZERO — patch final da matriz (item 11).
     *
     * A primeira linha do SQL era `when p_fee is null or p_fee <= 0 then 0`,
     * e juntava dois fatos diferentes: taxa CONHECIDA e nula (0) com taxa
     * AINDA NÃO CONHECIDA (null, a corretora não reportou). O segundo virava
     * zero DENTRO do número que alimenta o stop de perda diária — "não
     * medimos" virando "medimos zero" no ponto mais caro do produto.
     *
     * ⚠️ Escalar e exportado como RPC (abaixo) para poder ser exercitado
     * exatamente como o SQL é, sem passar por uma linha de intent.
     */
    const converterTaxaEmUsd = (
      fee: unknown, moedaCrua: unknown, symbol: unknown,
      filledQty: unknown, filledQuote: unknown,
    ): number | null => {
      if (fee == null) return null;            // não medida
      const valor = Number(fee);
      if (!(valor > 0)) return 0;              // medida e nula
      const moeda = String(moedaCrua ?? "").toUpperCase();
      if (!moeda) return null;
      if (ESTAVEIS.has(moeda)) return valor;
      const base = String(symbol).replace(/-/g, "/").split("/")[0].toUpperCase();
      const qty = Number(filledQty ?? 0), quote = Number(filledQuote ?? 0);
      if (moeda === base && qty > 0 && quote > 0) return valor * (quote / qty);
      return null;
    };
    const taxaEmUsdDoIntent = (it: Linha): number | null =>
      converterTaxaEmUsd(it.fee_total, it.fee_currency, it.symbol,
                         it.filled_qty, it.filled_quote);
    const hojeUtcDoBanco = () => new Date().toISOString().slice(0, 10);
    /** ⚠️ A MESMA regra que `autopilot_efeito_incompleto` — ver abaixo. */
    const efeitoIncompletoDaLinha = (e: Linha) =>
      e.taxa_opaca === true
      || (e.side === "sell" && Number(e.custo_removido_usd ?? 0) > 0
          && Number(e.applied_quote ?? 0) <= 0);
    /**
     * ⚠️⚠️ INVARIANTE F — a opacidade da taxa vira BLOQUEIO DURÁVEL.
     *
     * A bandeira mora no efeito (por intent, que é quem tem ou não taxa
     * precificável) e a sessão é DERIVADA dela: destravar por causa de um
     * intent não pode destravar com outro ainda opaco. Espelha
     * `autopilot_marcar_contabilidade`, na mesma passagem que aplicou.
     */
    const marcarContabilidade = (intentId: unknown, sessionId: unknown, opaca: boolean) => {
      const e = efeitos.find((x) => x.intent_id === intentId);
      if (e) e.taxa_opaca = opaca;
      const ses = sessoes.find((x) => x.id === sessionId);
      if (!ses) return;
      /**
       * ⚠️⚠️ DOIS MOTIVOS, não um (item 11 da matriz final):
       *   1. taxa opaca — a venda realizou e a taxa não se precifica;
       *   2. custo removido SEM recebido — a posição reduziu, o custo saiu do
       *      livro, e a corretora ainda não disse por quanto. O A142 guarda o
       *      custo e espera o quote (certo), mas nessa janela o `pnl_today`
       *      NÃO contém o prejuízo de um trade já fechado.
       */
      const aindaOpaco = efeitos.some((x) => x.session_id === sessionId
        && efeitoIncompletoDaLinha(x));
      // ⚠️ Preserva o INSTANTE original: a bandeira não se renova a cada passada.
      ses.contabilidade_incompleta_em = aindaOpaco
        ? (ses.contabilidade_incompleta_em ?? new Date().toISOString())
        : null;
    };
    const aplicarPnl = (sessionId: unknown, realizado: number) => {
      if (realizado === 0) return;
      const ses = sessoes.find((x) => x.id === sessionId);
      if (!ses) return;
      const depois = Number(ses.pnl_today ?? 0) + realizado;
      ses.pnl_today = depois;
      if (depois <= -Number(ses.daily_loss_stop_usd ?? Infinity)) {
        ses.frozen_until_day = hojeUtcDoBanco();
      }
    };
    /**
     * ⚠️⚠️ A144 — TERMINAL COM FILL AINDA COMPROMETE.
     *
     * A versão anterior jogava `CANCELED` junto com `FAILED_PRE_SUBMIT` para
     * zero. Uma limitada que preencheu 0,004 e depois foi cancelada liberava
     * a bolsa inteira antes de a projeção aplicar aquele 0,004 — e a ordem
     * seguinte vendia mais do que existe. O que se provou é o que vale:
     * terminal mede o EXECUTADO, não o reservado.
     */
    const compromissoVivo = (e: Linha, dono: Linha | undefined,
                             campo: "reservado_qty" | "reservado_usd") => {
      const estado = String(dono?.state ?? "");
      if (estado === "FAILED_PRE_SUBMIT") return 0;
      const venda = campo === "reservado_qty";
      const aplicado = venda ? Number(e.applied_qty ?? 0) : Number(e.applied_quote ?? 0);
      if (TERMINAIS.has(estado)) {
        const executado = venda ? Number(dono?.filled_qty ?? 0) : Number(dono?.filled_quote ?? 0);
        return Math.max(executado - aplicado, 0);
      }
      return Math.max(Number(e[campo] ?? 0) - aplicado, 0);
    };
    const efeitoDe = (it: Linha, base: string) => {
      let e = efeitos.find((x) => x.intent_id === it.id);
      if (!e) {
        e = { intent_id: it.id, session_id: it.session_id, exchange_id: it.exchange_id,
              base, side: it.side, applied_qty: 0, applied_quote: 0,
              ledger_qty: 0, ledger_quote: 0, reservado_qty: 0, reservado_usd: 0,
              fee_aplicada_usd: 0, custo_removido_usd: 0, pnl_aplicado_usd: 0,
              taxa_opaca: false };
        efeitos.push(e);
      }
      return e;
    };
    const baseDo = (it: Linha) =>
      String(it.symbol).replace(/-/g, "/").split("/")[0].toUpperCase();
    const autonomo = (it: Linha) =>
      it.simulated !== true && it.autonomous === true && Boolean(it.session_id)
      && (String(it.origin) === "autopilot_browser" || String(it.origin) === "autopilot_cron");

    /**
     * ⚠️⚠️ A ÚNICA definição de contabilidade incompleta — espelho de
     * `autopilot_efeito_incompleto`. Ela decide o bloqueio da sessão E a
     * elegibilidade ao recovery financeiro: duas cópias divergiriam, e a
     * divergência é exatamente a sessão presa sem ninguém buscar o que falta.
     */
    const efeitoIncompleto = (e: Linha | undefined) =>
      Boolean(e) && efeitoIncompletoDaLinha(e!);

    if (nome === "autopilot_efeito_incompleto") {
      return { data: Boolean(args.p_taxa_opaca)
        || (args.p_side === "sell" && Number(args.p_custo_removido ?? 0) > 0
            && Number(args.p_applied_quote ?? 0) <= 0), error: null };
    }

    if (nome === "autopilot_pendencias_financeiras") {
      /**
       * ⚠️⚠️⚠️ TERMINAL DE ORDEM NÃO É TERMINAL DE CONTABILIDADE.
       *
       * Dois braços: projeção atrasada (barato, local) e LIVRO incompleto
       * (precisa perguntar à corretora). O segundo é o que faltava — sem ele
       * um `FILLED` com `fee_total` NULL ficava fora de todo recovery e
       * prendia a sessão para sempre.
       */
      const EPSP = 1e-12;
      const saida: Linha[] = [];
      for (const it of intents) {
        if (it.simulated === true || it.autonomous !== true) continue;
        const origem = String(it.origin);
        if (origem !== "autopilot_browser" && origem !== "autopilot_cron") continue;
        if (!it.session_id) continue;
        if (!(Number(it.filled_qty ?? 0) > 0)) continue;

        const e = efeitos.find((x) => x.intent_id === it.id);
        const appliedQty = Number(e?.applied_qty ?? 0);
        const appliedQuote = Number(e?.applied_quote ?? 0);
        const feeAplicada = Number(e?.fee_aplicada_usd ?? 0);
        const lida = taxaEmUsdDoIntent(it);
        const taxaPendente = (lida ?? feeAplicada) > feeAplicada + EPSP;
        const livroIncompleto = efeitoIncompleto(e);
        const projecaoAtrasada = !e
          || Number(it.filled_qty ?? 0) > appliedQty + EPSP
          || Number(it.filled_quote ?? 0) > appliedQuote + EPSP
          || taxaPendente;
        if (!projecaoAtrasada && !livroIncompleto) continue;

        const motivo = !e ? "sem_marcador"
          : Number(it.filled_qty ?? 0) > appliedQty + EPSP ? "quantidade_pendente"
          : Number(it.filled_quote ?? 0) > appliedQuote + EPSP ? "recebido_pendente"
          : taxaPendente ? "taxa_pendente"
          : e.taxa_opaca === true ? "taxa_desconhecida"
          : "resultado_sem_recebido";
        saida.push({ intent_id: it.id, motivo, precisa_venue: livroIncompleto });
      }
      // ⚠️ O livro incompleto vem primeiro: ele é quem prende dinheiro.
      saida.sort((a, b) => Number(b.precisa_venue) - Number(a.precisa_venue));
      const lim = Math.max(Number(args.p_limite ?? 50), 0);
      return { data: saida.slice(0, lim), error: null };
    }

    if (nome === "autopilot_taxa_do_intent_em_usd") {
      // ⚠️ Escalar, sem intent: é assim que o SQL a expõe, e é assim que o
      // teste do item 11 a exercita.
      return { data: converterTaxaEmUsd(args.p_fee, args.p_moeda, args.p_symbol,
                                        args.p_filled_qty, args.p_filled_quote),
               error: null };
    }

    if (nome === "autopilot_reservar_venda_do_intent") {
      const qty = Number(args.p_qty);
      if (!(qty > 0)) return { data: { ok: false, motivo: "quantidade_invalida" }, error: null };
      const it = intents.find((i) => i.id === args.p_intent_id);
      if (!it) return { data: { ok: false, motivo: "intent_inexistente" }, error: null };
      if (it.simulated === true) return { data: { ok: false, motivo: "simulado" }, error: null };
      if (it.side !== "sell") return { data: { ok: false, motivo: "intent_nao_e_venda" }, error: null };
      if (!autonomo(it)) return { data: { ok: false, motivo: "origem_nao_autonoma" }, error: null };

      const base = baseDo(it);
      const pos = posicoes.find((x) => x.session_id === it.session_id && x.base === base);
      if (!pos || pos.status === "closed" || !(Number(pos.base_amount) > 0)) {
        return { data: { ok: false, motivo: "sem_posicao" }, error: null };
      }
      if (pos.status === "exit_armed") {
        return { data: { ok: false, motivo: "saida_ja_armada",
                         ordem_armada: pos.exit_order_id }, error: null };
      }
      const comprometido = efeitos
        .filter((e) => e.session_id === it.session_id && e.base === base
                    && e.side === "sell" && e.intent_id !== it.id)
        .reduce((soma, e) => {
          const dono = intents.find((i) => i.id === e.intent_id);
          return soma + compromissoVivo(e, dono, "reservado_qty");
        }, 0);
      const disponivel = Number(pos.base_amount) - comprometido;
      if (disponivel <= 0) {
        return { data: { ok: false, motivo: "quantidade_ja_reservada",
                         na_posicao: pos.base_amount, comprometido }, error: null };
      }
      const conceder = Math.min(qty, disponivel);
      efeitoDe(it, base).reservado_qty = conceder;
      return { data: { ok: true, qtd: conceder, limitada: conceder < qty,
                       na_posicao: pos.base_amount }, error: null };
    }

    if (nome === "autopilot_reservar_exposicao_do_intent") {
      const usd = Number(args.p_usd), teto = Number(args.p_teto);
      if (!(usd > 0)) return { data: { ok: false, motivo: "nocional_nao_mensuravel" }, error: null };
      if (!(teto > 0)) return { data: { ok: false, motivo: "teto_invalido" }, error: null };
      const it = intents.find((i) => i.id === args.p_intent_id);
      if (!it) return { data: { ok: false, motivo: "intent_inexistente" }, error: null };
      if (it.side !== "buy") return { data: { ok: false, motivo: "intent_nao_e_compra" }, error: null };
      if (!autonomo(it)) return { data: { ok: false, motivo: "origem_nao_autonoma" }, error: null };
      const ses = sessoes.find((x) => x.id === it.session_id);
      if (!ses) return { data: { ok: false, motivo: "sessao_inexistente" }, error: null };

      const exposicao = posicoes
        .filter((x) => x.session_id === it.session_id && x.status !== "closed")
        .reduce((soma, x) => soma + Number(x.cost_usd ?? 0), 0);
      const comprometido = efeitos
        .filter((e) => e.session_id === it.session_id && e.side === "buy" && e.intent_id !== it.id)
        .reduce((soma, e) => {
          const dono = intents.find((i) => i.id === e.intent_id);
          return soma + compromissoVivo(e, dono, "reservado_usd");
        }, 0);
      if (exposicao + comprometido + usd > teto) {
        return { data: { ok: false, motivo: "teto_estourado",
                         exposicao, comprometido, teto }, error: null };
      }
      efeitoDe(it, baseDo(it)).reservado_usd = usd;
      return { data: { ok: true, exposicao, comprometido: comprometido + usd, teto }, error: null };
    }

    if (nome === "autopilot_liberar_reserva_do_intent") {
      const e = efeitos.find((x) => x.intent_id === args.p_intent_id);
      if (e) { e.reservado_qty = 0; e.reservado_usd = 0; }
      return { data: { ok: true }, error: null };
    }

    /**
     * ⚠️ DAQUI PARA BAIXO TODA RPC É POR INTENT — e a guarda abaixo recusa o
     * que não existe. As reservas de inventário (acima) são por SESSÃO/BASE:
     * passá-las por esta linha as fazia falhar com "intent nao existe", que
     * foi exatamente o que aconteceu ao escrevê-las.
     */
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
      /**
       * ⚠️⚠️ INVARIANTE Q — `null` É NÃO MEDIDO, e o recebido tem delta.
       *
       * A 0059 escrevia por extenso "fill sem qty só existe para carregar
       * correção de fee, nunca quote". O ACK de uma limitada traz `filled` e
       * não traz `cost`: o recebido chega DEPOIS, com a qty parada, e caía
       * neste ramo para ser descartado. `filled_quote` ficava zero para
       * sempre — e é ele que o A143 e o A145 leem.
       */
      const cqBruto = args.p_cumulative_quote;
      const cq = cqBruto == null ? null : Number(cqBruto);
      // ⚠️ Mesma base do SQL: `sum(quote_amount) where intent_id = ...` — o
      // livro INTEIRO do intent, como `ja` faz para a quantidade.
      const quoteJa = fills.filter((f) => f.intent_id === it.id)
        .reduce((t, f) => t + Number(f.quote_amount ?? 0), 0);
      const quoteDelta = cq == null ? 0 : Math.max(cq - quoteJa, 0);
      const regrediu = (args.p_cumulative_qty != null && cum < ja - 1e-9)
                    || (cq != null && cq < quoteJa - 1e-9);
      // A123 (round 5): dedupe por INTENT, não por corretora — replay no
      // mesmo intent é no-op, outro intent com a mesma chave persiste.
      const temChave = (k: string) =>
        fills.some((f) => f.intent_id === it.id && f.dedupe_key === k);
      if (!(cum > ja + 1e-12)) {
        // Qty parada: a fee E/OU o recebido podem ter sido descobertos depois.
        // ⚠️ Chave própria (`ordadj:`), com o quote dentro: replay idêntico é
        // no-op, recebido corrigido é fato novo.
        const chaveAjuste = `ordadj:${args.p_external_order_id ?? "?"}:${cum}`
          + `:${args.p_fee ?? "-"}:${cqBruto ?? "-"}`;
        let inseridos = 0;
        if (args.p_cumulative_qty != null && cum > ja - 1e-9
            && ((feeDelta != null && feeDelta > 0) || quoteDelta > 0)
            && !temChave(chaveAjuste)) {
          const avg = Number(args.p_avg_price);
          const ultimo = [...fills].reverse().find((f) => mesmaOrdem(f));
          const preco = avg > 0 ? avg
            : (cq != null && cq > 0 && cum > 0 ? cq / cum : Number(ultimo?.price ?? 0));
          if (!(preco > 0)) {
            return { data: null, error: { message: "ajuste sem preco utilizavel" } };
          }
          fills.push({
            id: `f${++seq}`, intent_id: it.id, exchange_id: it.exchange_id,
            external_order_id: args.p_external_order_id, external_trade_id: null,
            symbol: it.symbol, side: it.side, qty: 0, price: preco,
            quote_amount: quoteDelta,
            fee: feeDelta, fee_currency: args.p_fee_currency ?? null,
            executed_at: args.p_executed_at ?? null,
            sintetico: true, dedupe_key: chaveAjuste,
          });
          inseridos = 1;
        }
        recalcular(String(it.id));
        return { data: { inseridos, regrediu, filled_qty: it.filled_qty,
                         filled_quote: it.filled_quote, state: it.state }, error: null };
      }
      const chave = `ordercum:${args.p_external_order_id ?? "?"}:${cum}:${args.p_fee ?? "-"}`;
      const avg = Number(args.p_avg_price);
      const preco = avg > 0 ? avg
        : (cq != null && cq > 0 && cum > 0 ? cq / cum : 0);
      if (!(preco > 0)) {
        return { data: null, error: { message: "snapshot sem preco utilizavel" } };
      }
      if (!temChave(chave)) {
        fills.push({
          id: `f${++seq}`, intent_id: it.id, exchange_id: it.exchange_id,
          external_order_id: args.p_external_order_id, external_trade_id: null,
          symbol: it.symbol, side: it.side, qty: cum - ja, price: preco,
          quote_amount: quoteDelta,
          fee: feeDelta, fee_currency: args.p_fee_currency ?? null,
          executed_at: args.p_executed_at ?? null,
          sintetico: true, dedupe_key: chave,
        });
      }
      if (args.p_external_order_id && !it.external_order_id) {
        it.external_order_id = args.p_external_order_id;
      }
      recalcular(String(it.id));
      return { data: { inseridos: 1, regrediu, filled_qty: it.filled_qty,
                       filled_quote: it.filled_quote, state: it.state }, error: null };
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
      /**
       * ⚠️⚠️ COBERTURA DE QUOTE (invariante Q) — a que faltava.
       *
       * `sint` soma QTY, e um ajuste de recebido tem qty zero: um lote todo
       * dedupado passava na cobertura, apagava o ajuste, e `filled_quote`
       * desabava de 600 para 0 sem um único trade novo. Mesma forma do gate
       * de fee: dispara pela EXISTÊNCIA do sintético com recebido.
       *
       * ⚠️ Real MENOR continua substituindo — o trade é fato, e a regressão
       * resultante é pega pelas guardas `regressao_de_quote` do autopilot.
       */
      if (novos.length === 0
          && sinteticoRows.some((f) => Number(f.quote_amount ?? 0) > 0)) {
        return { data: { ok: false, porque: "cobertura_quote_incompleta",
                         novos: novosQty, sintetico: sint }, error: null };
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
                   ledger_qty: 0, ledger_quote: 0, reservado_qty: 0,
                   reservado_usd: 0, fee_aplicada_usd: 0, custo_removido_usd: 0,
                   pnl_aplicado_usd: 0, taxa_opaca: false };
        efeitos.push(efeito);
      }
      const EPS = 1e-12, RUIDO = 1e-9;
      const noLivro = Number(it.filled_qty);
      // ⚠️ Regressão mede o LIVRO contra o livro; o delta mede o livro contra
      // o que já está DENTRO da posição (que a absorção pode ter adiantado).
      if (noLivro < Number(efeito.ledger_qty) - EPS) {
        return { data: { ok: false, motivo: "regressao",
                         aplicado: Number(efeito.ledger_qty), no_livro: noLivro }, error: null };
      }
      /**
       * ⚠️⚠️ AUDITORIA SINTÉTICO→REAL: o RECEBIDO também regride quando os
       * trades reais substituem um sintético superestimado. Os `greatest()`
       * abaixo o esconderiam, e na venda isso deixa o P&L (e o stop de perda)
       * OTIMISTA. Divergência não se absorve.
       */
      const quoteNoLivro = Number(it.filled_quote ?? 0);
      if (quoteNoLivro < Number(efeito.ledger_quote ?? 0) - EPS) {
        return { data: { ok: false, motivo: "regressao_de_quote",
                         aplicado: Number(efeito.ledger_quote),
                         no_livro: quoteNoLivro }, error: null };
      }
      const deltaQty = Math.max(noLivro - Number(efeito.applied_qty), 0);
      const deltaQuote = Math.max(Number(it.filled_quote) - Number(efeito.applied_quote), 0);
      // ⚠️ A140: a taxa acumulada tem delta próprio, e pode crescer SEM
      // quantidade nova (a 0059 permite o ajuste depois).
      const taxaLida = taxaEmUsdDoIntent(it);
      const taxaOpaca = taxaLida === null;
      const taxaTotal = taxaOpaca ? Number(efeito.fee_aplicada_usd ?? 0) : taxaLida!;
      const taxaDelta = taxaTotal - Number(efeito.fee_aplicada_usd ?? 0);
      if (taxaDelta < -EPS) {
        return { data: { ok: false, motivo: "regressao_de_taxa",
                         aplicado: efeito.fee_aplicada_usd, no_livro: taxaTotal }, error: null };
      }
      // ⚠️ A142: o RECEBIDO entra na decisão — ele cresce com a quantidade parada.
      if (deltaQty <= EPS && taxaDelta <= EPS && deltaQuote <= EPS) {
        efeito.ledger_qty = Math.max(Number(efeito.ledger_qty), noLivro);
        efeito.ledger_quote = Math.max(Number(efeito.ledger_quote), Number(it.filled_quote));
        // ⚠️ Invariante F: a opacidade da taxa e o bloqueio derivado entram
        // na MESMA passagem que aplicou o efeito.
        marcarContabilidade(it.id, it.session_id,
          taxaOpaca && it.side === "sell" && Number(it.filled_qty ?? 0) > 0);
        return { data: { ok: true, motivo: "sem_delta", aplicado_qty: 0,
                         aplicado_quote: 0, fechou: false, pnl_realizado: 0,
                         taxa_nao_precificada: taxaOpaca }, error: null };
      }
      if (deltaQty <= EPS) {
        // ⚠️ A142: ajuste sem quantidade — recebido OU taxa chegaram depois.
        let semQtd = 0;
        if (it.side === "sell") {
          const quoteNovo = Math.max(Number(efeito.applied_quote ?? 0), Number(it.filled_quote ?? 0));
          if (quoteNovo > 0) {
            semQtd = (quoteNovo - Number(efeito.custo_removido_usd ?? 0) - taxaTotal)
                   - Number(efeito.pnl_aplicado_usd ?? 0);
          }
          if (semQtd !== 0) aplicarPnl(it.session_id, semQtd);
        } else if (deltaQuote > EPS) {
          /**
           * ⚠️⚠️ A145: o RECEBIDO da compra que chegou depois vira BASE DE
           * CUSTO. Sem isto o marcador dizia "aplicado" e `cost_usd` ficava
           * zero para sempre: exposição subavaliada e lucro inventado na
           * venda seguinte. Sem posição onde entrar, NADA é marcado.
           */
          const alvo = posicoes.find((x) => x.session_id === it.session_id && x.base === base);
          if (!alvo) {
            return { data: { ok: false, motivo: "sem_posicao_para_custo",
                             base, delta_quote: deltaQuote }, error: null };
          }
          const custo = Number(alvo.cost_usd ?? 0) + deltaQuote;
          alvo.cost_usd = custo;
          // ⚠️ A QUANTIDADE NÃO MUDA — `deltaQty` é zero por definição.
          alvo.entry_price = Number(alvo.base_amount) > 0
            ? custo / Number(alvo.base_amount) : alvo.entry_price;
        }
        efeito.fee_aplicada_usd = taxaTotal;
        efeito.applied_quote = Math.max(Number(efeito.applied_quote ?? 0), Number(it.filled_quote ?? 0));
        efeito.pnl_aplicado_usd = Number(efeito.pnl_aplicado_usd ?? 0) + semQtd;
        efeito.ledger_qty = Math.max(Number(efeito.ledger_qty), noLivro);
        efeito.ledger_quote = Math.max(Number(efeito.ledger_quote), Number(it.filled_quote));
        // ⚠️ Invariante F: a opacidade da taxa e o bloqueio derivado entram
        // na MESMA passagem que aplicou o efeito.
        marcarContabilidade(it.id, it.session_id,
          taxaOpaca && it.side === "sell" && Number(it.filled_qty ?? 0) > 0);
        return { data: { ok: true, motivo: "ajuste_sem_quantidade", aplicado_qty: 0,
                         aplicado_quote: Math.max(deltaQuote, 0), fechou: false,
                         pnl_realizado: semQtd, taxa_delta: taxaDelta,
                         taxa_nao_precificada: taxaOpaca }, error: null };
      }

      const pos = posicoes.find((x) => x.session_id === it.session_id && x.base === base);
      // ⚠️ A142: a posição já foi encerrada por ESTE intent; o que sobra é
      // receita sem custo novo, e a conta acumulada sabe lidar com isso.
      if (!pos && it.side === "sell" && Number(efeito.applied_qty ?? 0) > 0) {
        const quoteNovo = Math.max(Number(efeito.applied_quote ?? 0), Number(it.filled_quote ?? 0));
        let extra = 0;
        if (quoteNovo > 0) {
          extra = (quoteNovo - Number(efeito.custo_removido_usd ?? 0) - taxaTotal)
                - Number(efeito.pnl_aplicado_usd ?? 0);
        }
        if (extra !== 0) aplicarPnl(it.session_id, extra);
        efeito.applied_qty = Math.max(Number(efeito.applied_qty), noLivro);
        efeito.applied_quote = Math.max(Number(efeito.applied_quote ?? 0), Number(it.filled_quote ?? 0));
        efeito.fee_aplicada_usd = Math.max(Number(efeito.fee_aplicada_usd ?? 0), taxaTotal);
        efeito.pnl_aplicado_usd = Number(efeito.pnl_aplicado_usd ?? 0) + extra;
        efeito.ledger_qty = Math.max(Number(efeito.ledger_qty), noLivro);
        efeito.ledger_quote = Math.max(Number(efeito.ledger_quote), Number(it.filled_quote));
        // ⚠️ Invariante F: a opacidade da taxa e o bloqueio derivado entram
        // na MESMA passagem que aplicou o efeito.
        marcarContabilidade(it.id, it.session_id,
          taxaOpaca && it.side === "sell" && Number(it.filled_qty ?? 0) > 0);
        return { data: { ok: true, motivo: "posicao_ja_encerrada", aplicado_qty: deltaQty,
                         aplicado_quote: deltaQuote, custo_removido: 0, fechou: false,
                         pnl_realizado: extra, taxa_delta: taxaDelta,
                         taxa_nao_precificada: taxaOpaca }, error: null };
      }
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
      /**
       * ⚠️⚠️ A138: o P&L realizado entra na MESMA passagem que reduziu.
       * Antes era uma segunda escrita, e por isso não tinha exactly-once.
       */
      let realizado = 0;
      if (it.side === "sell") {
        // ⚠️ A142: conta ACUMULADA; sem recebido, o custo espera guardado.
        const custoAcum = Number(efeito.custo_removido_usd ?? 0) + custoRemovido;
        const quoteNovo = Math.max(Number(efeito.applied_quote ?? 0), Number(it.filled_quote ?? 0));
        if (quoteNovo > 0) {
          realizado = (quoteNovo - custoAcum - taxaTotal) - Number(efeito.pnl_aplicado_usd ?? 0);
        }
        aplicarPnl(it.session_id, realizado);
      }
      efeito.custo_removido_usd = Number(efeito.custo_removido_usd ?? 0) + custoRemovido;
      efeito.fee_aplicada_usd = Math.max(Number(efeito.fee_aplicada_usd ?? 0), taxaTotal);
      // ⚠️ A reserva não precisa ser "solta": o compromisso vivo é
      // `greatest(reservado − applied, 0)`, e `applied` acabou de crescer.
      efeito.pnl_aplicado_usd = Number(efeito.pnl_aplicado_usd ?? 0) + realizado;
      efeito.applied_qty = Math.max(Number(efeito.applied_qty), noLivro);
      efeito.applied_quote = Math.max(Number(efeito.applied_quote), Number(it.filled_quote));
      efeito.ledger_qty = Math.max(Number(efeito.ledger_qty), noLivro);
      efeito.ledger_quote = Math.max(Number(efeito.ledger_quote), Number(it.filled_quote));
      // ⚠️ Invariante F — ver acima.
      marcarContabilidade(it.id, it.session_id,
        taxaOpaca && it.side === "sell" && Number(it.filled_qty ?? 0) > 0);
      return { data: { ok: true, motivo: "aplicado", side: it.side, base,
                       aplicado_qty: deltaQty, aplicado_quote: deltaQuote,
                       custo_removido: custoRemovido, fechou,
                       pnl_realizado: realizado, taxa_delta: taxaDelta,
                       taxa_nao_precificada: taxaOpaca }, error: null };
    }

    /**
     * ⚠️⚠️ A136 — a liquidação da saída armada, numa passagem só: posição e
     * marcador avançam juntos ou não avançam.
     */
    if (nome === "autopilot_liquidar_saida_armada") {
      const qty = Number(args.p_qty_vendida);
      if (!(qty > 0)) return { data: { ok: false, motivo: "quantidade_invalida" }, error: null };
      const it = intents.find((i) => i.id === args.p_intent_id);
      if (!it) return { data: { ok: false, motivo: "intent_inexistente" }, error: null };
      if (it.simulated === true) return { data: { ok: false, motivo: "simulado" }, error: null };
      if (it.side !== "sell") return { data: { ok: false, motivo: "intent_nao_e_venda" }, error: null };
      if (!autonomo(it)) return { data: { ok: false, motivo: "origem_nao_autonoma" }, error: null };
      // ⚠️ O SQL confere isto e o falso não conferia — divergência apontada na
      // revisão adversarial. Um falso mais PERMISSIVO que o banco faz o teste
      // provar a coisa errada.
      if (!it.session_id) return { data: { ok: false, motivo: "sem_sessao" }, error: null };

      const base = baseDo(it);
      // ⚠️ Marcador ANTES da posição: repetir é no-op, não erro.
      const efeito = efeitoDe(it, base);
      const delta = qty - Number(efeito.applied_qty);
      const taxaLidaL = taxaEmUsdDoIntent(it);
      const taxaOpacaL = taxaLidaL === null;
      const taxaTotalL = taxaOpacaL ? Number(efeito.fee_aplicada_usd ?? 0) : taxaLidaL!;
      const taxaDeltaL = taxaTotalL - Number(efeito.fee_aplicada_usd ?? 0);
      if (taxaDeltaL < -1e-12) {
        return { data: { ok: false, motivo: "regressao_de_taxa",
                         aplicado: efeito.fee_aplicada_usd, no_livro: taxaTotalL }, error: null };
      }
      // ⚠️ A143/auditoria sintético→real: o recebido vem do LIVRO e o livro
      // pode regredir. `greatest()` manteria o P&L otimista — fail-closed.
      if (args.p_quote_recebido != null
          && Number(args.p_quote_recebido) < Number(efeito.applied_quote ?? 0) - 1e-12) {
        return { data: { ok: false, motivo: "regressao_de_quote",
                         aplicado: efeito.applied_quote,
                         no_livro: args.p_quote_recebido }, error: null };
      }
      if (delta <= 1e-12 && taxaDeltaL <= 1e-12) {
        // ⚠️ Invariante F (a liquidação é sempre de VENDA).
        marcarContabilidade(it.id, it.session_id,
          taxaOpacaL && Number(it.filled_qty ?? 0) > 0);
        return { data: { ok: true, motivo: "sem_delta", aplicado_qty: 0,
                         custo_removido: 0, fechou: false, pnl_realizado: 0,
                         taxa_nao_precificada: taxaOpacaL }, error: null };
      }
      if (delta <= 1e-12) {
        // ⚠️ A142: ajuste sem quantidade, pela conta acumulada.
        const quoteNovo = Math.max(Number(efeito.applied_quote ?? 0),
                                   Number(args.p_quote_recebido ?? 0));
        let semQtd = 0;
        if (quoteNovo > 0) {
          semQtd = (quoteNovo - Number(efeito.custo_removido_usd ?? 0) - taxaTotalL)
                 - Number(efeito.pnl_aplicado_usd ?? 0);
        }
        aplicarPnl(it.session_id, semQtd);
        efeito.fee_aplicada_usd = taxaTotalL;
        efeito.applied_quote = quoteNovo;
        efeito.pnl_aplicado_usd = Number(efeito.pnl_aplicado_usd ?? 0) + semQtd;
        // ⚠️ Invariante F (a liquidação é sempre de VENDA).
        marcarContabilidade(it.id, it.session_id,
          taxaOpacaL && Number(it.filled_qty ?? 0) > 0);
        return { data: { ok: true, motivo: "ajuste_sem_quantidade", aplicado_qty: 0,
                         custo_removido: 0, fechou: false, pnl_realizado: semQtd,
                         taxa_delta: taxaDeltaL, taxa_nao_precificada: taxaOpacaL }, error: null };
      }
      const pos = posicoes.find((x) => x.session_id === it.session_id && x.base === base);
      if (!pos) return { data: { ok: false, motivo: "sem_posicao", base }, error: null };

      /**
       * ⚠️⚠️ A139 — A IDENTIDADE DA SAÍDA É CONFERIDA, não adivinhada.
       * `external_order_id` não é identificador global da corretora.
       */
      if (pos.status !== "exit_armed") {
        return { data: { ok: false, motivo: "posicao_nao_armada", status: pos.status }, error: null };
      }
      if (!pos.exit_intent_id) {
        return { data: { ok: false, motivo: "saida_sem_identidade",
                         base, ordem_armada: pos.exit_order_id }, error: null };
      }
      if (pos.exit_intent_id !== it.id) {
        return { data: { ok: false, motivo: "intent_nao_e_a_saida_armada",
                         esperado: pos.exit_intent_id }, error: null };
      }
      if (it.exchange_id !== pos.exchange_id) {
        return { data: { ok: false, motivo: "corretora_divergente" }, error: null };
      }
      // ⚠️ Hardening A139: null de qualquer lado TAMBÉM é divergência.
      if ((it.external_order_id ?? null) !== (pos.exit_order_id ?? null)) {
        return { data: { ok: false, motivo: "ordem_externa_divergente",
                         na_posicao: pos.exit_order_id,
                         no_intent: it.external_order_id }, error: null };
      }

      const quote = Number(args.p_quote_recebido ?? 0);
      const deltaQuote = Math.max(quote - Number(efeito.applied_quote), 0);

      let custoRemovido = 0, fechou = false;
      const restante = Number(pos.base_amount) - delta;
      if (restante <= Number(pos.base_amount) * 1e-9) {
        custoRemovido = Number(pos.cost_usd);
        fechou = true;
        posicoes.splice(posicoes.indexOf(pos), 1);
      } else {
        const custoRestante = Number(pos.cost_usd) * (restante / Number(pos.base_amount));
        custoRemovido = Number(pos.cost_usd) - custoRestante;
        pos.base_amount = restante; pos.cost_usd = custoRestante;
        pos.status = "open"; pos.exit_order_id = null; pos.exit_armed_at = null;
        pos.exit_intent_id = null;
      }

      /**
       * ⚠️⚠️ A142: conta ACUMULADA. Sem recebido (o ACK não trouxe `cost`), o
       * custo removido fica guardado e o resultado espera — era isso que
       * fazia a liquidação lançar `−custo` inteiro e congelar o dia.
       */
      const custoAcumL = Number(efeito.custo_removido_usd ?? 0) + custoRemovido;
      const quoteNovoL = Math.max(Number(efeito.applied_quote ?? 0), quote);
      let realizado = 0;
      if (quoteNovoL > 0) {
        realizado = (quoteNovoL - custoAcumL - taxaTotalL) - Number(efeito.pnl_aplicado_usd ?? 0);
      }
      aplicarPnl(it.session_id, realizado);
      efeito.applied_qty = Math.max(Number(efeito.applied_qty), qty);
      efeito.applied_quote = Math.max(Number(efeito.applied_quote), quote);
      efeito.custo_removido_usd = custoAcumL;
      efeito.fee_aplicada_usd = Math.max(Number(efeito.fee_aplicada_usd ?? 0), taxaTotalL);
      efeito.pnl_aplicado_usd = Number(efeito.pnl_aplicado_usd ?? 0) + realizado;
      // ⚠️ Invariante F (a liquidação é sempre de VENDA).
      marcarContabilidade(it.id, it.session_id,
        taxaOpacaL && Number(it.filled_qty ?? 0) > 0);
      return { data: { ok: true, motivo: "aplicado", aplicado_qty: delta,
                       aplicado_quote: deltaQuote, custo_removido: custoRemovido,
                       fechou, base, pnl_realizado: realizado,
                       taxa_delta: taxaDeltaL, taxa_nao_precificada: taxaOpacaL }, error: null };
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
