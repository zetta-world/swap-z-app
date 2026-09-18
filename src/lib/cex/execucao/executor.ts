/**
 * ⚠️⚠️⚠️ O EXECUTOR CEX AUTORITATIVO — achados A80, A104, A106, A107.
 *
 * TODO caminho que movimenta dinheiro em corretora passa por aqui. Manual,
 * autopilot do cron, autopilot do navegador, DCA e qualquer worker futuro.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A ORDEM DOS PASSOS É A CORREÇÃO, e ela é inegociável:
 *
 *    1. banco vivo            sem banco não há como registrar → NADA sai
 *    2. intent DURÁVEL        gravado ANTES de qualquer efeito externo
 *    3. kill-switch           imediatamente antes do envio, falha FECHADA
 *    4. credencial            ausente ou ilegível → nada sai
 *    5. reserva de risco      cota/orçamento, antes do envio
 *    6. AUTORIZAÇÃO FINAL     certificado validado NO BANCO, numa transação
 *                              junto à marcação SUBMITTING (A110, round 2)
 *    7. envio                 o único efeito externo
 *    8. SUBMITTED | UNKNOWN   nunca "falhou" sobre dúvida
 *    9. ingestão do que se sabe   ACK não é fill
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A110, ROUNDS 2 E 3 — O CERTIFICADO É A AUTORIDADE FINAL, DENTRO DO EXECUTOR,
 * E ELA DERIVA DO INTENT.
 *
 * O precheck das rotas (`avaliarCertificado`) continua onde está — é ele que
 * dá o erro bom cedo (A113, política única). Mas ele decide num instante
 * ANTERIOR ao envio: revogar o certificado entre a decisão da rota e o
 * submit passava batido. O passo 6 chama a RPC `cex_autorizar_e_submeter`
 * (0057, endurecida na 0060), que relê o PRÓPRIO intent sob `for update`,
 * valida o certificado no banco e marca SUBMITTING na mesma transação.
 *
 * ⚠️ ROUND 3 — A AUTORIZAÇÃO DERIVA DO INTENT, NÃO DO CALLER. A RPC recebe
 * APENAS o id: venue, símbolo, nocional e hash vêm da linha gravada no passo
 * 2 (o `strategy_hash` virou coluna durável). Um caller que mentisse venue,
 * símbolo ou nocional DEPOIS do precheck não tem mais como expressar a
 * mentira — não existe parâmetro para isso. A autorização final não é mais
 * uma lembrança da rota, nem uma afirmação de quem chama.
 *
 * ⚠️ JANELA RESIDUAL, DECLARADA: uma revogação comitada DEPOIS do commit da
 * RPC e ANTES do HTTP à corretora não é pega. Eliminar essa janela exigiria
 * segurar o lock através de chamada externa — custo pior que o risco.
 *
 * ⚠️ EXCEÇÃO DOCUMENTADA — SELL/redução de risco NÃO exige certificado
 * válido: prender a saída de uma estratégia revogada seria o mecanismo de
 * segurança criando o perigo que existe para evitar. A isenção é da RPC e
 * da constraint (0052), e é deliberada.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ O PASSO 6 É O QUE TORNA O CRASH RECUPERÁVEL. Se o processo morrer entre 6
 * e 8, o banco tem um intent em `SUBMITTING` com `client_order_id` — e o
 * recuperador sabe exatamente o que perguntar à corretora. Sem ele, o
 * Cenário C do briefing produz um fantasma que ninguém consegue achar.
 *
 * ⚠️ E O PASSO 3 ESTÁ AQUI, NÃO NAS ROTAS — achado A106. `disable_cex` era
 * conferido em `/api/cex/order` e em `/api/autopilot/session`, e NÃO no cron do
 * DCA nem no limiar do envio. Um interruptor que cada consumidor precisa
 * lembrar de consultar é um interruptor que o próximo consumidor esquece.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { CexId, CexCredentials } from "@/lib/cex/types";
import { checarKillSwitches } from "@/lib/admin/kill-switches";
import { enviarOrdemNaVenue } from "@/lib/cex/execucao/venue-primitivo";
import {
  abrirIntent, transicionar, ingerirSnapshotDaOrdem, intentPorId,
  type IntentRow,
} from "@/lib/cex/execucao/intents";
import type { EstadoDoIntent } from "@/lib/cex/execucao/estados";

export type OrigemDeExecucao =
  | "manual"
  | "autopilot_cron"
  | "autopilot_browser"
  | "dca_cron"
  | "reconciliacao";

export interface ContextoDeExecucao {
  origin: OrigemDeExecucao;
  /** ⚠️ Autônomo exige estratégia certificada — ver `certificado.ts` (A110). */
  autonomous: boolean;
  walletAddress?: string | null;
  sessionId?: string | null;
  planId?: string | null;
  cycleNumber?: number | null;
  conexaoId?: string | null;
  strategyId?: string | null;
  strategyVersion?: number | null;
  certificateId?: string | null;
  /**
   * ⚠️ O HASH DOS PARÂMETROS COM QUE a estratégia vai rodar agora (A110).
   * Desde o round 3 ele é gravado NO INTENT na criação (coluna
   * `strategy_hash`, migration 0060) — e a autorização final do passo 6 lê o
   * hash DE LÁ, não de parâmetro: depois de gravado, ninguém mais o afirma.
   * Compra autônoma real sem hash que case é recusada NO BANCO, no passo 6.
   */
  strategyHash?: string | null;
  /**
   * ⚠️ A120 — A IMPRESSÃO DA CREDENCIAL, só no caminho MANUAL REAL.
   *
   * A rota `/api/cex/order` a calcula NO SERVIDOR (HMAC sobre exchange+NUL+
   * apiKey, ver `src/lib/cex/fingerprint.ts`) e a entrega aqui; o executor a
   * grava no intent no passo 2. Autopilot/DCA passam SEM ela (a credencial
   * deles está no cofre e o recovery é pela sessão), e o simulado também —
   * nesses casos ela fica NULL e o recovery por intentId fecha com
   * `recovery_not_bound`. O campo `credentialFingerprint` do body do cliente
   * NUNCA é autoridade: a rota o ignora de propósito.
   *
   * ⚠️ A120-H (round 5): para `origin: "manual"` NÃO simulado este campo é
   * OBRIGATÓRIO — o executor recusa (`fingerprint_ausente`) ANTES de gravar
   * o intent se ele estiver ausente ou fora do formato `^[0-9a-f]{64}$`.
   */
  credentialFingerprint?: string | null;
}

export interface OrdemPedida {
  exchangeId: CexId;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  qty: number;
  price?: number | null;
  notionalUsd?: number | null;
  /** Plano simulado: percorre TUDO menos a chamada externa. */
  simulated?: boolean;
  /** Preço de referência — só para materializar o fill do simulado. */
  precoDeReferencia?: number | null;
}

/**
 * A reserva de risco, injetada por quem chama.
 *
 * ⚠️ O EXECUTOR É DONO DA ORDEM DOS PASSOS; O CONSUMIDOR É DONO DA SEMÂNTICA.
 * Cota diária do autopilot e reserva de ciclo do DCA são coisas diferentes e
 * nenhuma delas cabe aqui dentro — mas AMBAS têm de acontecer antes do envio,
 * e isso é responsabilidade deste arquivo.
 *
 * ⚠️ `liberar` SÓ RODA NA RECUSA PROVADA. Nunca em `UNKNOWN`: devolver a cota
 * sobre dúvida é autorizar um segundo envio para um dinheiro que talvez já
 * tenha saído (INVARIANTE 4).
 */
export interface ReservaDeRisco {
  reservar: () => Promise<{ ok: true } | { ok: false; porque: string }>;
  liberar?: () => Promise<void>;
}

export type MotivoDeRecusa =
  | "sem_banco"
  /** A120-H: ordem MANUAL REAL sem `credentialFingerprint` (ou com ele
   *  malformado) — recusada ANTES de gravar intent: zero side effect. */
  | "fingerprint_ausente"
  | "conexao_ausente"
  | "intent_nao_gravado"
  | "ja_existe_intent_vivo"
  | "kill_switch"
  | "sem_credencial"
  | "reserva_negada"
  | "nao_consegui_marcar_envio"
  /** A RPC `cex_autorizar_e_submeter` recusou: certificado inválido no limiar
   *  (A110, round 2), estado que não admite submissão, ou o próprio banco. */
  | "autorizacao_recusada"
  | "recusada_pela_corretora";

export type ResultadoDaExecucao =
  /** Provado que nada saiu. Seguro repetir depois. */
  | { desfecho: "recusado"; motivo: MotivoDeRecusa; porque: string; intentId: string | null }
  /** A corretora aceitou. `filledQty` vem do LIVRO, não do pedido. */
  | { desfecho: "submetido"; intentId: string; externalOrderId: string | null;
      filledQty: number; filledQuote: number;
      /** ⚠️ Do LIVRO, para quem precisa medir o pedágio real (DCA). */
      feeTotal: number | null; feeCurrency: string | null;
      state: EstadoDoIntent }
  /**
   * ⚠️⚠️ DÚVIDA. Pode ter executado. NÃO é falha, NÃO libera reserva, NÃO
   * avança ciclo, NÃO conta trade, NÃO abre posição. Só a reconciliação decide.
   */
  | { desfecho: "incerto"; intentId: string; porque: string };

export type ResultadoDaAutorizacao =
  | { ok: true }
  | { ok: false; porque: string };

/**
 * ⚠️ O SEAM DA AUTORIZAÇÃO FINAL (A110, round 3). A assinatura recebe APENAS
 * o id do intent: venue, símbolo, nocional e hash são lidos DA PRÓPRIA LINHA
 * pela RPC `cex_autorizar_e_submeter` (migration 0060), sob `for update`.
 * O caller mentiroso deixou de ser um caso a detectar — é IMPOSSÍVEL DE
 * EXPRESSAR: não existe parâmetro para mentir. O default é a RPC; os testes
 * injetam um falso que reproduz a mesma decisão. Nenhum outro caminho marca
 * SUBMITTING a partir deste executor — autorização e ponto-sem-volta são a
 * mesma passada.
 */
export type AutorizarSubmissao = (
  db: SupabaseClient<Database>, intentId: string,
) => Promise<ResultadoDaAutorizacao>;

/** A autorização de verdade: valida o certificado e marca SUBMITTING numa
 *  transação só, no banco. O único argumento é o id — o resto é do intent. */
export const autorizarSubmissaoNoBanco: AutorizarSubmissao = async (db, intentId) => {
  const { data, error } = await db.rpc("cex_autorizar_e_submeter", {
    p_intent_id: intentId,
  });
  if (error) return { ok: false, porque: error.message.slice(0, 200) };
  const r = data as { ok?: boolean; porque?: string } | null;
  if (!r || r.ok !== true) {
    return { ok: false, porque: r?.porque ?? "autorizacao recusada pelo banco" };
  }
  return { ok: true };
};

export interface DependenciasDoExecutor {
  db: SupabaseClient<Database> | null;
  /** Injetados para o teste poder exercitar sem rede e sem banco. */
  enviar?: typeof enviarOrdemNaVenue;
  killSwitches?: typeof checarKillSwitches;
  autorizarSubmissao?: AutorizarSubmissao;
  agora?: () => Date;
}

/**
 * Executa UMA ordem em corretora. Este é o único caminho autorizado.
 */
export async function executarOrdemCex(
  deps: DependenciasDoExecutor,
  ctx: ContextoDeExecucao,
  ordem: OrdemPedida,
  creds: CexCredentials | null,
  reserva?: ReservaDeRisco,
): Promise<ResultadoDaExecucao> {
  const enviar = deps.enviar ?? enviarOrdemNaVenue;
  const checar = deps.killSwitches ?? checarKillSwitches;
  const db = deps.db;

  // ── 1. SEM BANCO, NADA SAI ────────────────────────────────────────────
  // ⚠️ INVARIANTE 9 na sua forma mais direta. Sem banco não há intent; sem
  // intent, um timeout vira um fantasma que ninguém consegue achar depois.
  // Perder um trade custa um trade. Perder a rastreabilidade custa o livro.
  if (!db) {
    return { desfecho: "recusado", motivo: "sem_banco", intentId: null,
      porque: "banco indisponivel — sem registro duravel nenhuma ordem pode ser enviada" };
  }

  // ── 1.5. A120-H — MANUAL REAL SEM VÍNCULO NÃO NASCE ───────────────────
  /**
   * ⚠️⚠️ FAIL-CLOSED, ANTES DO INTENT E DE QUALQUER SIDE EFFECT. A rota
   * `/api/cex/order` calcula o fingerprint no servidor e já recusa com 500
   * quando a env falta — mas o executor é o caminho autoritativo, e ele não
   * pode depender de que todo consumidor lembre de vincular: uma ordem
   * MANUAL REAL gravada sem `credential_fingerprint` seria
   * irreconciliável por desenho (o recovery por intentId fecha com
   * `recovery_not_bound`) e violaria a CHECK `cex_intent_manual_real_tem_
   * fingerprint` da migration 0061. Aqui a recusa é explícita e ANTES do
   * insert: zero intent, zero createOrder.
   *
   * ⚠️ O EXECUTOR EXIGE O VÍNCULO; ELE NÃO O RECALCULA. A apiKey não é
   * assunto deste arquivo — quem calcula é a rota (`fingerprint.ts`), e
   * conferir formato (`^[0-9a-f]{64}$`) basta para recusar vínculo falso.
   *
   * ⚠️ SÓ O MANUAL REAL. Autopilot/DCA (credencial no cofre, recovery pela
   * sessão) e o SIMULADO (nenhum dinheiro se move) seguem sem fingerprint.
   */
  if (ctx.origin === "manual" && ordem.simulated !== true) {
    const fp = ctx.credentialFingerprint;
    if (typeof fp !== "string" || !/^[0-9a-f]{64}$/.test(fp)) {
      return { desfecho: "recusado", motivo: "fingerprint_ausente", intentId: null,
        porque: fp == null
          ? "ordem manual real sem fingerprint de credencial — sem vinculo ela seria irreconciliavel; nada foi gravado nem enviado"
          : "fingerprint de credencial malformado (esperado HMAC-SHA256 hex minusculo, 64 chars) — nada foi gravado nem enviado" };
    }
  }

  // ── 1.6. A127 — BROWSER REAL SEM SNAPSHOT DE CONEXÃO NÃO NASCE ───────
  if (ctx.origin === "autopilot_browser" && ordem.simulated !== true && !ctx.conexaoId) {
    return { desfecho: "recusado", motivo: "conexao_ausente", intentId: null,
      porque: "autopilot_browser real sem conexao_id — nada foi gravado nem enviado" };
  }

  // ── 2. O INTENT DURÁVEL, ANTES DE TUDO ────────────────────────────────
  /**
   * ⚠️ TUDO QUE A AUTORIZAÇÃO FINAL VAI CONFERIR É GRAVADO AQUI (A110,
   * round 3): venue, símbolo, nocional E o `strategyHash`. A RPC do passo 6
   * lê esses fatos DA LINHA gravada — depois deste insert, o caller não tem
   * mais como afirmar nada sobre eles.
   */
  const aberto = await abrirIntent(db, {
    origin: ctx.origin, autonomous: ctx.autonomous,
    exchangeId: ordem.exchangeId, symbol: ordem.symbol, side: ordem.side,
    orderType: ordem.type, requestedQty: ordem.qty, limitPrice: ordem.price ?? null,
    requestedNotionalUsd: ordem.notionalUsd ?? null, simulated: ordem.simulated ?? false,
    walletAddress: ctx.walletAddress, sessionId: ctx.sessionId, planId: ctx.planId,
    cycleNumber: ctx.cycleNumber, conexaoId: ctx.conexaoId,
    strategyId: ctx.strategyId, strategyVersion: ctx.strategyVersion,
    certificateId: ctx.certificateId, strategyHash: ctx.strategyHash ?? null,
    credentialFingerprint: ctx.credentialFingerprint ?? null,
  });
  if (!aberto.ok) {
    return { desfecho: "recusado", intentId: null,
      motivo: aberto.jaExiste ? "ja_existe_intent_vivo" : "intent_nao_gravado",
      porque: aberto.porque };
  }
  const intent: IntentRow = aberto.intent;

  const recusarPreEnvio = async (
    motivo: MotivoDeRecusa, porque: string,
  ): Promise<ResultadoDaExecucao> => {
    await transicionar(db, intent.id, "FAILED_PRE_SUBMIT", porque.slice(0, 300));
    return { desfecho: "recusado", motivo, porque, intentId: intent.id };
  };

  // ── 3. O KILL-SWITCH, NO LIMIAR ───────────────────────────────────────
  /**
   * ⚠️⚠️ ACHADO A106. Falha de LEITURA bloqueia — `checarKillSwitches` com
   * `dinheiro_sai` já implementa essa direção, e ela é a certa aqui.
   *
   * ⚠️ VALE TAMBÉM PARA O SIMULADO, e isso é escolha consciente: o briefing
   * pede um freio universal, e uma passada simulada ainda avança plano e grava
   * livro. LIMITAÇÃO CONHECIDA: com `disable_cex` ligado o dono também não
   * consegue testar em modo simulado. Se isso incomodar, a saída é uma
   * capability própria de simulado — não afrouxar o freio.
   */
  const kill = await checar(["disable_cex", "maintenance_mode"], "dinheiro_sai");
  if (kill.bloqueado) {
    return recusarPreEnvio("kill_switch",
      `kill-switch: ${kill.motivo ?? "bloqueado"} — zero ordem enviada`);
  }

  // ── 4. A CREDENCIAL ───────────────────────────────────────────────────
  if (!ordem.simulated && !creds) {
    return recusarPreEnvio("sem_credencial",
      "credencial ausente ou ilegivel — nenhuma ordem pode ser enviada");
  }

  const auth = await transicionar(db, intent.id, "AUTHORIZED");
  if (!auth.ok) return recusarPreEnvio("intent_nao_gravado", `AUTHORIZED: ${auth.porque}`);

  // ── 5. A RESERVA DE RISCO ─────────────────────────────────────────────
  if (reserva) {
    const r = await reserva.reservar();
    if (!r.ok) return recusarPreEnvio("reserva_negada", r.porque);
  }
  const res = await transicionar(db, intent.id, "RESERVED");
  if (!res.ok) {
    if (reserva?.liberar) await reserva.liberar();
    return recusarPreEnvio("intent_nao_gravado", `RESERVED: ${res.porque}`);
  }

  // ── 6. AUTORIZAÇÃO FINAL + SUBMITTING, NUMA TRANSAÇÃO — O PONTO SEM VOLTA
  /**
   * ⚠️⚠️ SE ESTA GRAVAÇÃO FALHAR, NÃO SE ENVIA. Enviar sem ter conseguido
   * registrar "estou enviando" é exatamente o buraco do A80: o processo morre
   * e o banco não tem como saber que houve uma tentativa.
   *
   * ⚠️⚠️ E AGORA A GRAVAÇÃO É TAMBÉM A AUTORIZAÇÃO (A110, rounds 2 e 3). A RPC
   * `cex_autorizar_e_submeter` relê o PRÓPRIO intent sob `for update` e, para
   * compra autônoma real, valida o certificado no banco — revogado, expirado,
   * de outra estratégia/versão, hash divergente, venue ou símbolo fora do
   * envelope, nocional acima do teto: recusa, e o intent NÃO transiciona.
   * Desde o round 3 (migration 0060) TUDO o que ela confere vem DA LINHA do
   * intent — venue, símbolo, nocional e hash foram gravados no passo 2, e a
   * assinatura recebe só o id. O kill-switch (passo 3) continua ANTES desta
   * chamada, de propósito: o freio universal não depende de certificado
   * nenhum.
   *
   * ⚠️ SELL É ISENTA POR DECISÃO DOCUMENTADA — ver o cabeçalho do arquivo e
   * das migrations 0057/0060.
   */
  const autorizar = deps.autorizarSubmissao ?? autorizarSubmissaoNoBanco;
  const aut = await autorizar(db, intent.id);
  if (!aut.ok) {
    if (reserva?.liberar) await reserva.liberar();
    return recusarPreEnvio("autorizacao_recusada", `autorizacao: ${aut.porque}`);
  }

  // ── 7. O ÚNICO EFEITO EXTERNO ─────────────────────────────────────────
  const resposta = ordem.simulated
    ? simularOrdem(intent, ordem)
    : await enviar(ordem.exchangeId, creds!, {
        symbol: ordem.symbol, side: ordem.side, type: ordem.type,
        amount: ordem.qty, price: ordem.price ?? null,
        clientOrderId: intent.client_order_id,
      });

  // ── 8. O DESFECHO ─────────────────────────────────────────────────────
  if (resposta.tipo === "incerta") {
    /**
     * ⚠️⚠️ AQUI ESTÁ A INVARIANTE 3 E A 4 JUNTAS.
     *
     * Nada de FAILED. Nada de liberar a reserva — devolver a cota agora
     * autorizaria um segundo envio para um dinheiro que talvez já tenha saído.
     * O intent fica em UNKNOWN, com `client_order_id`, esperando reconciliação.
     */
    await transicionar(db, intent.id, "UNKNOWN", resposta.porque.slice(0, 300));
    return { desfecho: "incerto", intentId: intent.id, porque: resposta.porque };
  }

  if (resposta.tipo === "recusada") {
    // A corretora respondeu e disse não: nada executou, nada ficou vivo.
    // Aqui SIM a reserva volta — é o único caminho em que isso é seguro.
    await transicionar(db, intent.id, "CANCELED", `recusada: ${resposta.porque}`.slice(0, 300));
    if (reserva?.liberar) await reserva.liberar();
    return { desfecho: "recusado", motivo: "recusada_pela_corretora",
      porque: resposta.porque, intentId: intent.id };
  }

  // ── 9. ACEITA — ACK NÃO É FILL ────────────────────────────────────────
  const ordemExterna = resposta.ordem;
  const idExterno = ordemExterna.id ? String(ordemExterna.id) : null;
  await transicionar(db, intent.id, "SUBMITTED", null, idExterno);

  /**
   * ⚠️⚠️ ACHADO A81, NO PONTO EXATO ONDE ELE VIVIA.
   *
   * O código antigo fazia, em três arquivos:
   *
   *     const filledQty = Number(order.filled) > 0 ? Number(order.filled) : intent.amount;
   *
   * — ou seja, `filled` ausente ou zero virava "executou tudo". Aqui, um ACK
   * sem preenchimento NÃO gera linha no livro: `filled_qty` continua 0 e o
   * estado continua SUBMITTED. O volume só existe com evidência de fill.
   */
  let estado: EstadoDoIntent = "SUBMITTED";
  let filled = 0, quote = 0;
  let taxa: number | null = null, moedaDaTaxa: string | null = null;
  const executado = Number(ordemExterna.filled);
  if (Number.isFinite(executado) && executado > 0) {
    const medio = Number(ordemExterna.average);
    const custo = Number(ordemExterna.cost);
    const ing = await ingerirSnapshotDaOrdem(db, intent.id, idExterno, {
      cumulativeQty: executado,
      avgPrice: Number.isFinite(medio) && medio > 0 ? medio : 0,
      cumulativeQuote: Number.isFinite(custo) && custo > 0 ? custo : 0,
      fee: ordemExterna.fee?.cost ?? null,
      feeCurrency: ordemExterna.fee?.currency ?? null,
      executedAt: ordemExterna.timestamp
        ? new Date(ordemExterna.timestamp).toISOString() : null,
    });
    if (!ing.ok) {
      /**
       * ⚠️ A ORDEM EXECUTOU E O LIVRO NÃO ACEITOU. Não dá para concluir nada
       * daqui — vira reconciliação, que é o estado honesto.
       */
      await transicionar(db, intent.id, "RECONCILIATION_REQUIRED",
        `fill nao ingerido: ${ing.porque}`.slice(0, 300));
      return { desfecho: "submetido", intentId: intent.id, externalOrderId: idExterno,
        filledQty: 0, filledQuote: 0, feeTotal: null, feeCurrency: null,
        state: "RECONCILIATION_REQUIRED" };
    }
    filled = ing.filledQty ?? 0;
    estado = ing.state ?? "PARTIALLY_FILLED";
    // ⚠️ Relê o intent: `filled_quote` e a taxa são DERIVADOS do livro pela
    // RPC, e reconstruí-los aqui a partir da resposta da corretora seria uma
    // segunda contabilidade — exatamente o que este executor existe para acabar.
    const depois = await intentPorId(db, intent.id);
    quote = Number(depois?.filled_quote ?? 0);
    taxa = depois?.fee_total ?? null;
    moedaDaTaxa = depois?.fee_currency ?? null;
  }

  return { desfecho: "submetido", intentId: intent.id, externalOrderId: idExterno,
    filledQty: filled, filledQuote: quote, feeTotal: taxa, feeCurrency: moedaDaTaxa,
    state: estado };
}

/**
 * O "envio" de um plano simulado.
 *
 * ⚠️ ELE PERCORRE TODO O RESTO DO CAMINHO — intent, kill-switch, reserva,
 * estados, livro de fills. A ÚNICA diferença é não falar com a corretora. É o
 * que faz o teste sem dinheiro VALER: um caminho paralelo só provaria que o
 * caminho paralelo funciona.
 *
 * ⚠️ E O ID É PREFIXADO. Um id que pudesse ser confundido com o de uma ordem
 * real é como um extrato simulado vira evidência de compra que nunca houve.
 */
function simularOrdem(
  intent: IntentRow, ordem: OrdemPedida,
): { tipo: "aceita"; ordem: { id: string; filled: number; average: number; cost: number;
      fee?: { cost: number; currency: string }; timestamp?: number } }
  | { tipo: "recusada"; porque: string } {
  const preco = Number(ordem.price ?? ordem.precoDeReferencia ?? 0);
  if (!(preco > 0)) {
    // Sem preço não se inventa execução, nem no simulado.
    return { tipo: "recusada", porque: "simulado sem preco de referencia" };
  }
  return { tipo: "aceita", ordem: {
    id: `simulado:${intent.id.slice(0, 8)}`,
    filled: ordem.qty, average: preco, cost: preco * ordem.qty,
    timestamp: Date.now(),
  } };
}
