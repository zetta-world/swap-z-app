/**
 * ⚠️⚠️ O EXECUTOR AUTORITATIVO, EXERCITADO PELOS CENÁRIOS DO BRIEFING.
 *
 * Achados A80, A81, A104, A106, A107. Cenários A e E da seção 8.
 *
 * O que estes testes perguntam não é "a função roda". É:
 *
 *   · um ECONNRESET depois do envio vira DÚVIDA, nunca falha?
 *   · o ACK da corretora, sozinho, consegue criar volume?
 *   · com `disable_cex` ligado, alguma ordem sai?
 *   · sem banco, alguma ordem sai?
 *   · a reserva volta na recusa provada — e NÃO volta na dúvida?
 */

import { describe, it, expect, vi } from "vitest";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import { executarOrdemCex, type ContextoDeExecucao, type OrdemPedida } from "@/lib/cex/execucao/executor";
import type { RespostaDaVenue } from "@/lib/cex/execucao/venue-primitivo";
import type { CexCredentials, CexId } from "@/lib/cex/types";

const CTX: ContextoDeExecucao = { origin: "manual", autonomous: false, walletAddress: "0xdono" };
const ORDEM: OrdemPedida = {
  exchangeId: "binance", symbol: "BTC/USDT", side: "buy", type: "limit",
  qty: 10, price: 100, notionalUsd: 1000,
};
const CREDS: CexCredentials = { apiKey: "k", apiSecret: "s" };

const passaLivre = async () => ({ bloqueado: false as const, motivo: null });
/** Corretora falsa com a assinatura REAL — sem ela `mock.calls` perde os tipos
 *  e a asserção sobre o `clientOrderId` que viajou não teria como existir. */
type Enviar = (
  id: CexId, creds: CexCredentials,
  req: { symbol: string; side: "buy" | "sell"; type: "market" | "limit";
         amount: number; price?: number | null; clientOrderId: string },
) => Promise<RespostaDaVenue>;
const venue = (r: RespostaDaVenue) => vi.fn<Enviar>(async () => r);

describe("① Cenário A — a ordem executou e a resposta se perdeu", () => {
  it("⚠️⚠️ ECONNRESET depois do envio vira INCERTO, nunca falha", async () => {
    const b = bancoFalso();
    const enviar = venue({ tipo: "incerta", porque: "RequestTimeout: socket hang up" });
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX, ORDEM, CREDS);

    expect(r.desfecho).toBe("incerto");
    expect(b.intents[0].state).toBe("UNKNOWN");
    // ⚠️ E NADA de fill: a dúvida não inventa volume.
    expect(b.intents[0].filled_qty).toBe(0);
    expect(b.fills).toHaveLength(0);
  });

  it("⚠️⚠️ e a RESERVA NÃO É LIBERADA na dúvida (INVARIANTE 4)", async () => {
    // Devolver a cota agora autorizaria um segundo envio para um dinheiro que
    // talvez já tenha saído — o retry destrutivo que o briefing proíbe.
    const b = bancoFalso();
    const liberar = vi.fn(async () => {});
    await executarOrdemCex(
      { db: b.cliente, enviar: venue({ tipo: "incerta", porque: "timeout" }), killSwitches: passaLivre },
      CTX, ORDEM, CREDS,
      { reservar: async () => ({ ok: true }), liberar });
    expect(liberar).not.toHaveBeenCalled();
  });

  it("⚠️ o intent guarda o client_order_id — é o que a reconciliação pergunta", async () => {
    const b = bancoFalso();
    const enviar = venue({ tipo: "incerta", porque: "timeout" });
    await executarOrdemCex({ db: b.cliente, enviar, killSwitches: passaLivre }, CTX, ORDEM, CREDS);
    const coid = String(b.intents[0].client_order_id);
    expect(coid.length).toBeGreaterThan(0);
    // e foi o MESMO que viajou para a corretora
    expect(enviar.mock.calls[0]?.[2]?.clientOrderId).toBe(coid);
  });
});

describe("② A81 — ACK de ordem NÃO é fill", () => {
  it("⚠️⚠️ aceita com filled=0 deixa filled_qty em ZERO e estado SUBMITTED", async () => {
    // O código antigo fazia `filled > 0 ? filled : intent.amount` em TRÊS
    // arquivos: um ACK sem preenchimento virava posição inteira.
    const b = bancoFalso();
    const enviar = venue({ tipo: "aceita",
      ordem: { id: "ORD-1", filled: 0, remaining: 10, amount: 10, status: "open",
               symbol: "BTC/USDT", side: "buy", type: "limit" } as never });
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX, ORDEM, CREDS);

    expect(r.desfecho).toBe("submetido");
    if (r.desfecho === "submetido") {
      expect(r.filledQty).toBe(0);
      expect(r.state).toBe("SUBMITTED");
    }
    expect(b.fills).toHaveLength(0);
  });

  it("⚠️ o gêmeo positivo: fill de verdade ENTRA no livro", async () => {
    // Sem isto, um executor que nunca gravasse nada passaria no teste acima.
    const b = bancoFalso();
    const enviar = venue({ tipo: "aceita",
      ordem: { id: "ORD-2", filled: 4, average: 101, cost: 404, amount: 10,
               status: "open", symbol: "BTC/USDT", side: "buy", type: "limit" } as never });
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX, ORDEM, CREDS);

    expect(r.desfecho).toBe("submetido");
    if (r.desfecho === "submetido") {
      expect(r.filledQty).toBe(4);
      expect(r.state).toBe("PARTIALLY_FILLED");
    }
    expect(b.fills).toHaveLength(1);
    expect(Number(b.fills[0].qty)).toBe(4);
  });

  it("⚠️ preenchimento total fecha como FILLED, e só então", async () => {
    const b = bancoFalso();
    const enviar = venue({ tipo: "aceita",
      ordem: { id: "ORD-3", filled: 10, average: 100, cost: 1000, amount: 10,
               status: "closed", symbol: "BTC/USDT", side: "buy", type: "limit" } as never });
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX, ORDEM, CREDS);
    if (r.desfecho === "submetido") expect(r.state).toBe("FILLED");
    expect(b.intents[0].state).toBe("FILLED");
  });
});

describe("③ Cenário E — disable_cex é freio universal (A106)", () => {
  it("⚠️⚠️ com o interruptor ligado, ZERO chamada à corretora", async () => {
    const b = bancoFalso();
    const enviar = venue({ tipo: "aceita", ordem: { id: "X" } as never });
    const r = await executarOrdemCex(
      { db: b.cliente, enviar,
        killSwitches: async () => ({ bloqueado: true, motivo: "disable_cex" as const }) },
      CTX, ORDEM, CREDS);

    expect(enviar).not.toHaveBeenCalled();
    expect(r.desfecho).toBe("recusado");
    if (r.desfecho === "recusado") expect(r.motivo).toBe("kill_switch");
    // ⚠️ E o intent fica gravado como recusado ANTES do envio — rastro, não silêncio.
    expect(b.intents[0].state).toBe("FAILED_PRE_SUBMIT");
  });

  it("⚠️⚠️ falha ao LER o interruptor também bloqueia (INVARIANTE 9)", async () => {
    // `checarKillSwitches` com `dinheiro_sai` já devolve bloqueado quando não
    // consegue ler. Aqui o executor prova que respeita esse veredito.
    const b = bancoFalso();
    const enviar = venue({ tipo: "aceita", ordem: { id: "X" } as never });
    const r = await executarOrdemCex(
      { db: b.cliente, enviar,
        killSwitches: async () => ({ bloqueado: true, motivo: "leitura_falhou" as const }) },
      CTX, ORDEM, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    expect(r.desfecho).toBe("recusado");
  });

  it("⚠️ o gêmeo positivo: com o interruptor aberto, a ordem SAI", async () => {
    const b = bancoFalso();
    const enviar = venue({ tipo: "aceita",
      ordem: { id: "OK", filled: 10, average: 100, cost: 1000 } as never });
    await executarOrdemCex({ db: b.cliente, enviar, killSwitches: passaLivre },
      CTX, ORDEM, CREDS);
    expect(enviar).toHaveBeenCalledTimes(1);
  });
});

describe("④ sem banco e sem credencial, nada sai (INVARIANTE 9)", () => {
  it("⚠️⚠️ banco indisponível: ZERO chamada, e o motivo é explícito", async () => {
    const enviar = venue({ tipo: "aceita", ordem: { id: "X" } as never });
    const r = await executarOrdemCex({ db: null, enviar, killSwitches: passaLivre },
      CTX, ORDEM, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    expect(r.desfecho).toBe("recusado");
    if (r.desfecho === "recusado") expect(r.motivo).toBe("sem_banco");
  });

  it("⚠️ o intent não gravou: ZERO chamada", async () => {
    const b = bancoFalso();
    b.falhas.insertIntent = "banco recusou";
    const enviar = venue({ tipo: "aceita", ordem: { id: "X" } as never });
    const r = await executarOrdemCex({ db: b.cliente, enviar, killSwitches: passaLivre },
      CTX, ORDEM, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    if (r.desfecho === "recusado") expect(r.motivo).toBe("intent_nao_gravado");
  });

  it("⚠️ credencial ausente: ZERO chamada", async () => {
    const b = bancoFalso();
    const enviar = venue({ tipo: "aceita", ordem: { id: "X" } as never });
    const r = await executarOrdemCex({ db: b.cliente, enviar, killSwitches: passaLivre },
      CTX, ORDEM, null);
    expect(enviar).not.toHaveBeenCalled();
    if (r.desfecho === "recusado") expect(r.motivo).toBe("sem_credencial");
  });

  it("⚠️⚠️ não consegui marcar SUBMITTING: ZERO chamada", async () => {
    // Enviar sem ter conseguido registrar "estou enviando" é o buraco do A80
    // inteiro: o processo morre e o banco não sabe que houve tentativa.
    const b = bancoFalso();
    const enviar = venue({ tipo: "aceita", ordem: { id: "X" } as never });
    b.falhas.transicao = "banco fora do ar";
    const r = await executarOrdemCex({ db: b.cliente, enviar, killSwitches: passaLivre },
      CTX, ORDEM, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    expect(r.desfecho).toBe("recusado");
  });
});

describe("⑤ a reserva de risco, e quando ela volta", () => {
  it("⚠️ reserva negada: ZERO chamada à corretora", async () => {
    const b = bancoFalso();
    const enviar = venue({ tipo: "aceita", ordem: { id: "X" } as never });
    const r = await executarOrdemCex({ db: b.cliente, enviar, killSwitches: passaLivre },
      CTX, ORDEM, CREDS,
      { reservar: async () => ({ ok: false, porque: "cota diaria estourada" }) });
    expect(enviar).not.toHaveBeenCalled();
    if (r.desfecho === "recusado") expect(r.motivo).toBe("reserva_negada");
  });

  it("⚠️⚠️ recusa PROVADA pela corretora libera a reserva — e só ela", async () => {
    const b = bancoFalso();
    const liberar = vi.fn(async () => {});
    const r = await executarOrdemCex(
      { db: b.cliente, killSwitches: passaLivre,
        enviar: venue({ tipo: "recusada", porque: "InsufficientFunds: saldo" }) },
      CTX, ORDEM, CREDS, { reservar: async () => ({ ok: true }), liberar });

    expect(r.desfecho).toBe("recusado");
    if (r.desfecho === "recusado") expect(r.motivo).toBe("recusada_pela_corretora");
    expect(liberar).toHaveBeenCalledTimes(1);
    // ⚠️ Nada executou e nada ficou vivo: cancelado o pedido inteiro.
    expect(b.intents[0].state).toBe("CANCELED");
    expect(Number(b.intents[0].filled_qty)).toBe(0);
    expect(Number(b.intents[0].canceled_qty)).toBe(10);
  });

  it("a reserva roda ANTES do envio, não depois", async () => {
    const ordemDosPassos: string[] = [];
    const b = bancoFalso();
    await executarOrdemCex(
      { db: b.cliente, killSwitches: passaLivre,
        enviar: vi.fn(async () => { ordemDosPassos.push("envio");
          return { tipo: "aceita" as const, ordem: { id: "Z", filled: 0 } as never }; }) },
      CTX, ORDEM, CREDS,
      { reservar: async () => { ordemDosPassos.push("reserva"); return { ok: true }; } });
    expect(ordemDosPassos).toEqual(["reserva", "envio"]);
  });
});

describe("⑥ o simulado percorre o mesmo caminho", () => {
  it("⚠️ nenhuma chamada externa, e mesmo assim livro e estado completos", async () => {
    const b = bancoFalso();
    const enviar = venue({ tipo: "aceita", ordem: { id: "NAO-DEVE-SAIR" } as never });
    const r = await executarOrdemCex({ db: b.cliente, enviar, killSwitches: passaLivre },
      CTX, { ...ORDEM, simulated: true }, null);

    expect(enviar).not.toHaveBeenCalled();
    expect(r.desfecho).toBe("submetido");
    expect(b.intents[0].state).toBe("FILLED");
    expect(b.fills).toHaveLength(1);
    // ⚠️ E o id é prefixado: extrato simulado não vira evidência de compra real.
    expect(String(b.fills[0].external_order_id)).toMatch(/^simulado:/);
  });

  it("⚠️ simulado sem preço NÃO inventa execução", async () => {
    const b = bancoFalso();
    const r = await executarOrdemCex(
      { db: b.cliente, enviar: venue({ tipo: "aceita", ordem: { id: "X" } as never }),
        killSwitches: passaLivre },
      CTX, { ...ORDEM, simulated: true, price: null, type: "market" }, null);
    expect(r.desfecho).toBe("recusado");
    expect(b.fills).toHaveLength(0);
  });
});
