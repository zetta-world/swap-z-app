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

type Linha = Record<string, unknown>;

export interface BancoFalso {
  cliente: SupabaseClient<Database>;
  intents: Linha[];
  fills: Linha[];
  /** Falhas injetáveis, por operação, para exercitar o caminho de erro. */
  falhas: {
    insertIntent?: string;
    transicao?: string;
    ingestao?: string;
  };
}

export function bancoFalso(): BancoFalso {
  const intents: Linha[] = [];
  const fills: Linha[] = [];
  const falhas: BancoFalso["falhas"] = {};
  let seq = 0;

  const somaDoLivro = (intentId: string) =>
    fills.filter((f) => f.intent_id === intentId)
         .reduce((t, f) => t + Number(f.qty), 0);

  function recalcular(intentId: string) {
    const it = intents.find((i) => i.id === intentId)!;
    const qty = somaDoLivro(intentId);
    const quote = fills.filter((f) => f.intent_id === intentId)
                       .reduce((t, f) => t + Number(f.quote_amount), 0);
    it.filled_qty = qty;
    it.filled_quote = quote;
    const estado = it.state as EstadoDoIntent;
    if (["SUBMITTED", "PARTIALLY_FILLED", "UNKNOWN", "CANCEL_PENDING",
         "RECONCILIATION_REQUIRED"].includes(estado)) {
      if (qty >= Number(it.requested_qty) - 1e-12) it.state = "FILLED";
      else if (qty > 0) it.state = "PARTIALLY_FILLED";
    }
  }

  const rpc = async (nome: string, args: Record<string, unknown>) => {
    if (falhas.transicao && nome === "cex_transicionar") {
      return { data: null, error: { message: falhas.transicao } };
    }
    if (falhas.ingestao && nome.startsWith("cex_ingest")) {
      return { data: null, error: { message: falhas.ingestao } };
    }
    const it = intents.find((i) => i.id === args.p_intent_id);
    if (!it) return { data: null, error: { message: "intent nao existe" } };

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

    if (nome === "cex_ingest_order_snapshot") {
      const estado = it.state as EstadoDoIntent;
      if (["CREATED", "AUTHORIZED", "RESERVED", "FAILED_PRE_SUBMIT"].includes(estado)) {
        return { data: null, error: { message: `snapshot contra intent em ${estado}` } };
      }
      const ja = somaDoLivro(String(it.id));
      const cum = Number(args.p_cumulative_qty);
      if (!(cum > ja + 1e-12)) {
        recalcular(String(it.id));
        return { data: { inseridos: 0, regrediu: cum < ja - 1e-9 }, error: null };
      }
      const avg = Number(args.p_avg_price);
      const cq = Number(args.p_cumulative_quote);
      const preco = avg > 0 ? avg : (cq > 0 && cum > 0 ? cq / cum : 0);
      if (!(preco > 0)) {
        return { data: null, error: { message: "snapshot sem preco utilizavel" } };
      }
      const chave = `ordercum:${args.p_external_order_id ?? "?"}:${cum}`;
      if (!fills.some((f) => f.exchange_id === it.exchange_id && f.dedupe_key === chave)) {
        fills.push({
          id: `f${++seq}`, intent_id: it.id, exchange_id: it.exchange_id,
          external_order_id: args.p_external_order_id, external_trade_id: null,
          symbol: it.symbol, side: it.side, qty: cum - ja, price: preco,
          quote_amount: Math.max(cq - Number(it.filled_quote), 0),
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

    if (nome === "cex_ingest_trades") {
      const estado = it.state as EstadoDoIntent;
      if (["CREATED", "AUTHORIZED", "RESERVED", "FAILED_PRE_SUBMIT"].includes(estado)) {
        return { data: null, error: { message: `fill contra intent em ${estado}` } };
      }
      // O sintético é estimativa; o trade é fato. O fato substitui.
      for (let i = fills.length - 1; i >= 0; i--) {
        const f = fills[i];
        if (f.intent_id === it.id && f.sintetico
            && f.external_order_id === args.p_external_order_id) fills.splice(i, 1);
      }
      let inseridos = 0;
      for (const t of (args.p_trades as Linha[]) ?? []) {
        const chave = `trade:${t.trade_id}`;
        if (fills.some((f) => f.exchange_id === it.exchange_id && f.dedupe_key === chave)) continue;
        fills.push({
          id: `f${++seq}`, intent_id: it.id, exchange_id: it.exchange_id,
          external_order_id: args.p_external_order_id, external_trade_id: t.trade_id,
          symbol: it.symbol, side: it.side, qty: Number(t.qty), price: Number(t.price),
          quote_amount: Number(t.quote), sintetico: false, dedupe_key: chave,
        });
        inseridos++;
      }
      if (args.p_external_order_id && !it.external_order_id) {
        it.external_order_id = args.p_external_order_id;
      }
      recalcular(String(it.id));
      return { data: { inseridos, filled_qty: it.filled_qty, state: it.state }, error: null };
    }

    return { data: null, error: { message: `rpc desconhecida: ${nome}` } };
  };

  function consulta(tabela: string) {
    const linhas = () => (tabela === "cex_fills" ? fills : intents);
    const filtros: Array<(r: Linha) => boolean> = [];
    let limite = Infinity;
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
      then: (res: (x: { data: Linha[]; error: null }) => void) =>
        Promise.resolve({
          data: linhas().filter((r) => filtros.every((f) => f(r))).slice(0, limite),
          error: null as null,
        }).then(res),
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
            canceled_qty: 0, external_order_id: null, state_reason: null,
            created_at: new Date().toISOString(), reconcile_attempts: 0,
            last_reconciled_at: null, submitted_at: null, ...valores,
          };
          (tabela === "cex_fills" ? fills : intents).push(linha);
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
  const linhasDe = (t: string) => (t === "cex_fills" ? fills : intents);

  return { cliente: cliente as unknown as SupabaseClient<Database>, intents, fills, falhas };
}
