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
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import { executarOrdemCex, autorizarSubmissaoNoBanco,
         type ContextoDeExecucao, type OrdemPedida } from "@/lib/cex/execucao/executor";
import type { RespostaDaVenue } from "@/lib/cex/execucao/venue-primitivo";
import type { CexCredentials, CexId } from "@/lib/cex/types";

/**
 * ⚠️ A120-H (round 5): o caminho MANUAL REAL exige o vínculo da credencial —
 * o executor recusa (`fingerprint_ausente`) antes de gravar intent sem ele.
 * Aqui só o FORMATO importa (o HMAC de verdade nasce na rota, coberto por
 * `fingerprint-criacao.test.ts`); os testes do próprio gate vivem em
 * `fingerprint-enforcement.test.ts`.
 */
const FINGERPRINT_VALIDO = "0123456789abcdef".repeat(4);
const CTX: ContextoDeExecucao = { origin: "manual", autonomous: false,
  walletAddress: "0xdono", credentialFingerprint: FINGERPRINT_VALIDO };
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
    // Desde o round 2 (A110) a marcação SUBMITTING acontece DENTRO da RPC
    // `cex_autorizar_e_submeter` — a falha injetável é a dela.
    const b = bancoFalso();
    const enviar = venue({ tipo: "aceita", ordem: { id: "X" } as never });
    b.falhas.autorizacao = "banco fora do ar";
    const r = await executarOrdemCex({ db: b.cliente, enviar, killSwitches: passaLivre },
      CTX, ORDEM, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    expect(r.desfecho).toBe("recusado");
    if (r.desfecho === "recusado") expect(r.motivo).toBe("autorizacao_recusada");
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

/**
 * ─────────────────────────────────────────────────────────────────────────
 * ⑦ A110 — O CERTIFICADO É A AUTORIDADE FINAL, DENTRO DO EXECUTOR.
 *
 * O precheck da rota (`avaliarCertificado`) decide CEDO, mas decide num
 * instante anterior ao envio. Entre os dois cabia uma revogação — e ela
 * passava. Desde o round 2 o passo 6 é a RPC `cex_autorizar_e_submeter`, e
 * desde o ROUND 3 (migration 0060) ela recebe APENAS o id do intent: venue,
 * símbolo, nocional e hash são lidos DA PRÓPRIA LINHA, sob `for update`. O
 * caller mentiroso não é um caso a detectar — é impossível de expressar.
 * Estes testes perguntam:
 *
 *   · certificado válido → a ordem SAI?                    (H1)
 *   · revogado antes — ou ENTRE precheck e executor —      (H2, H3)
 *     → ZERO chamada à corretora?
 *   · cert de outra strategy / versão / hash / venue /     (H4–H8)
 *     símbolo → ZERO chamada?
 *   · hash ausente no intent → ZERO chamada?               (H6b)
 *   · nocional acima do teto certificado → ZERO chamada?   (H9)
 *   · SELL com certificado revogado → SAI (exceção         (H10)
 *     documentada: revogação não prende saída)?
 * ─────────────────────────────────────────────────────────────────────────
 */

const CERT_ID = "cert-1";
/** Um certificado vivo, coerente com CTX_AUTO e ORDEM. */
const certVivo = (): Record<string, unknown> => ({
  id: CERT_ID, strategy_id: "estrategia-x", strategy_version: 3,
  strategy_hash: "hash-abc", certificate_version: 1,
  evidence: {}, sample_size: null, cost_assumptions: null,
  risk_limits: { maxTradeUsd: 2000 },
  allowed_venues: ["binance"], allowed_symbols: ["BTC/USDT"],
  valid_from: "2020-01-01T00:00:00Z", valid_until: null,
  revoked_at: null, revoked_reason: null,
});
const CTX_AUTO: ContextoDeExecucao = {
  origin: "autopilot_cron", autonomous: true, walletAddress: "0xdono",
  strategyId: "estrategia-x", strategyVersion: 3, certificateId: CERT_ID,
  strategyHash: "hash-abc",
};
const ACEITA = { tipo: "aceita" as const,
  ordem: { id: "ORD-A110", filled: 10, average: 100, cost: 1000 } as never };

describe("⑦ A110 round 2 — a autorização final é transacional, no banco", () => {
  it("H1 ⚠️ o gêmeo positivo: certificado VÁLIDO deixa a ordem sair", async () => {
    // Sem este, um executor que recusasse tudo passaria em H2–H9.
    const b = bancoFalso();
    b.certificados.push(certVivo());
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX_AUTO, ORDEM, CREDS);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(r.desfecho).toBe("submetido");
    expect(b.intents[0].state).toBe("FILLED");
  });

  it("H2 ⚠️⚠️ certificado REVOGADO antes: ZERO createOrder", async () => {
    const b = bancoFalso();
    b.certificados.push({ ...certVivo(), revoked_at: new Date().toISOString(),
                          revoked_reason: "estrategia degradada" });
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX_AUTO, ORDEM, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    expect(r.desfecho).toBe("recusado");
    if (r.desfecho === "recusado") {
      expect(r.motivo).toBe("autorizacao_recusada");
      expect(r.porque).toMatch(/revogad/);
    }
    // ⚠️ Rastro, não silêncio: o intent morre ANTES do ponto sem volta.
    expect(b.intents[0].state).toBe("FAILED_PRE_SUBMIT");
  });

  it("H3 ⚠️⚠️ revogação ENTRE o precheck e o executor: ZERO createOrder", async () => {
    /**
     * A janela que o round 1 deixou aberta. A rota avaliou o certificado VIVO;
     * antes do submit, alguém revogou. A reserva de risco é o último gancho
     * antes do passo 6 — revogamos lá dentro, e a RPC tem de enxergar.
     */
    const b = bancoFalso();
    const cert = certVivo();
    b.certificados.push(cert);
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX_AUTO, ORDEM, CREDS,
      { reservar: async () => {
          cert.revoked_at = new Date().toISOString();   // a revogação no meio do voo
          cert.revoked_reason = "revogado apos o precheck";
          return { ok: true as const };
        } });
    expect(enviar).not.toHaveBeenCalled();
    expect(r.desfecho).toBe("recusado");
    if (r.desfecho === "recusado") expect(r.motivo).toBe("autorizacao_recusada");
  });

  it("H4 ⚠️ certificado de OUTRA estratégia: ZERO createOrder", async () => {
    // A FK garante que o certificate_id EXISTE; não que é desta estratégia.
    const b = bancoFalso();
    b.certificados.push({ ...certVivo(), strategy_id: "estrategia-alheia" });
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX_AUTO, ORDEM, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    if (r.desfecho === "recusado") expect(r.motivo).toBe("autorizacao_recusada");
  });

  it("H5 ⚠️ certificado de OUTRA versão: ZERO createOrder", async () => {
    const b = bancoFalso();
    b.certificados.push({ ...certVivo(), strategy_version: 4 });
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX_AUTO, ORDEM, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    if (r.desfecho === "recusado") expect(r.motivo).toBe("autorizacao_recusada");
  });

  it("H6 ⚠️⚠️ hash divergente — os parâmetros mudaram sob o certificado: ZERO createOrder", async () => {
    // Round 3: o hash do ctx é GRAVADO no intent na criação; a RPC o lê de
    // lá e o confere contra o certificado. Adulterado, não casa: recusa.
    const b = bancoFalso();
    b.certificados.push(certVivo());
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre },
      { ...CTX_AUTO, strategyHash: "hash-adulterado" }, ORDEM, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    if (r.desfecho === "recusado") expect(r.motivo).toBe("autorizacao_recusada");
    // ⚠️ E o hash adulterado ficou GRAVADO — a evidência da tentativa não some.
    expect(b.intents[0].strategy_hash).toBe("hash-adulterado");
  });

  it("H6b ⚠️⚠️ hash AUSENTE no intent — não medimos não passa: ZERO createOrder", async () => {
    // Uma compra autônoma real sem strategy_hash gravado (ctx veio sem ele)
    // não tem como provar que roda os parâmetros certificados.
    const b = bancoFalso();
    b.certificados.push(certVivo());
    const enviar = venue(ACEITA);
    const { strategyHash: _omitido, ...ctxSemHash } = CTX_AUTO;
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, ctxSemHash, ORDEM, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    if (r.desfecho === "recusado") {
      expect(r.motivo).toBe("autorizacao_recusada");
      expect(r.porque).toMatch(/strategy_hash/);
    }
    expect(b.intents[0].strategy_hash ?? null).toBeNull();
  });

  it("H7 ⚠️ venue fora do envelope certificado: ZERO createOrder", async () => {
    const b = bancoFalso();
    b.certificados.push(certVivo());
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX_AUTO,
      { ...ORDEM, exchangeId: "kraken" }, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    if (r.desfecho === "recusado") expect(r.motivo).toBe("autorizacao_recusada");
  });

  it("H8 ⚠️ símbolo fora do envelope certificado: ZERO createOrder", async () => {
    const b = bancoFalso();
    b.certificados.push(certVivo());
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX_AUTO,
      { ...ORDEM, symbol: "ETH/USDT" }, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    if (r.desfecho === "recusado") expect(r.motivo).toBe("autorizacao_recusada");
  });

  it("H9 ⚠️⚠️ nocional ACIMA do teto da evidência: ZERO createOrder", async () => {
    // O certificado cobre trades até $2000; o pedido é $5000. Operar acima é
    // usar a evidência para outra coisa.
    const b = bancoFalso();
    b.certificados.push(certVivo());
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX_AUTO,
      { ...ORDEM, qty: 50, notionalUsd: 5000 }, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    if (r.desfecho === "recusado") expect(r.motivo).toBe("autorizacao_recusada");
  });

  it("H10 ⚠️⚠️ EXCEÇÃO DOCUMENTADA: SELL com certificado revogado SAI", async () => {
    /**
     * Certificado porteia ENTRADA. Exigi-lo para vender prenderia a posição
     * de uma estratégia revogada — o controle criando o perigo que existe
     * para evitar. A saída passa pela MESMA RPC, que deliberadamente não a
     * valida para sell.
     */
    const b = bancoFalso();
    b.certificados.push({ ...certVivo(), revoked_at: new Date().toISOString(),
                          revoked_reason: "revogado — e a saida continua livre" });
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX_AUTO,
      { ...ORDEM, side: "sell" }, CREDS);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(r.desfecho).toBe("submetido");
  });

  it("⚠️ o simulado autônomo SEM certificado também sai — nenhum dinheiro se move", async () => {
    // Mesma isenção da constraint da 0052: exigir certificado do simulado
    // pararia a única coisa que hoje pode rodar sem risco.
    const b = bancoFalso();
    const enviar = venue({ tipo: "aceita", ordem: { id: "NAO-DEVE-SAIR" } as never });
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre },
      { origin: "dca_cron", autonomous: true, walletAddress: "0xdono" },
      { ...ORDEM, simulated: true }, null);
    expect(enviar).not.toHaveBeenCalled();   // simulado nunca fala com a venue
    expect(r.desfecho).toBe("submetido");
  });

  it("⚠️ o kill-switch continua ANTES da autorização (A106 não regride)", async () => {
    // Mesmo com certificado válido, o freio universal fecha tudo — e nem
    // chega a consultar o certificado: a ordem dos passos é a correção.
    const b = bancoFalso();
    b.certificados.push(certVivo());
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar,
        killSwitches: async () => ({ bloqueado: true, motivo: "disable_cex" as const }) },
      CTX_AUTO, ORDEM, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    if (r.desfecho === "recusado") expect(r.motivo).toBe("kill_switch");
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * ⑦b A110 ROUND 3 — O CALLER MENTIROSO DEIXOU DE EXISTIR.
 *
 * Até o round 2 a RPC recebia `p_venue/p_symbol/p_notional/p_strategy_hash`
 * do CALLER: a autorização final conferia o certificado contra o que quem
 * chama AFIRMOU. Desde a 0060 a assinatura é `cex_autorizar_e_submeter(uuid)`
 * e TUDO deriva da linha do intent. Um ctx/ordem com symbol divergente do
 * intent é IMPOSSÍVEL DE EXPRESSAR — a ordem É o que grava o intent; depois
 * disso, ninguém afirma mais nada.
 * ─────────────────────────────────────────────────────────────────────────
 */
describe("⑦b A110 round 3 — a autorização deriva DO INTENT, não do caller", () => {
  it("⚠️⚠️ a RPC é chamada com APENAS p_intent_id — não há parâmetro para mentir", async () => {
    // Espiona o transporte: se venue/símbolo/nocional/hash voltarem a viajar
    // como argumento, este teste quebra ANTES de qualquer outro.
    const b = bancoFalso();
    b.certificados.push(certVivo());
    const rpcReal = b.cliente.rpc.bind(b.cliente) as unknown as (
      nome: string, args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const chamadas: Record<string, unknown>[] = [];
    (b.cliente as { rpc: unknown }).rpc = async (
      nome: string, args: Record<string, unknown>,
    ) => {
      if (nome === "cex_autorizar_e_submeter") chamadas.push(args);
      return rpcReal(nome, args);
    };
    const enviar = venue(ACEITA);
    await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX_AUTO, ORDEM, CREDS);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(chamadas).toHaveLength(1);
    expect(Object.keys(chamadas[0])).toEqual(["p_intent_id"]);
  });

  it("⚠️ a seam não carrega dados de caller: exatamente (db, intentId)", async () => {
    const b = bancoFalso();
    const espiada = vi.fn(autorizarSubmissaoNoBanco);
    await executarOrdemCex(
      { db: b.cliente, enviar: venue(ACEITA), killSwitches: passaLivre,
        autorizarSubmissao: espiada },
      CTX, ORDEM, CREDS);
    expect(espiada).toHaveBeenCalledTimes(1);
    expect(espiada.mock.calls[0]).toHaveLength(2);
    expect(espiada.mock.calls[0]?.[1]).toBe(String(b.intents[0].id));
  });

  it("⚠️⚠️ AUTORIDADE DO BANCO: intent coerente autoriza SEM o caller dizer nada", async () => {
    /**
     * A chamada direta à RPC com um intent cuja linha já carrega venue,
     * símbolo, nocional e hash: a validação inteira acontece contra a LINHA.
     * É este teste que a quebra deliberada derruba — um banco que volte a
     * ler esses fatos dos argumentos (que não existem mais) recusa aqui.
     */
    const b = bancoFalso();
    b.certificados.push(certVivo());
    await b.cliente.from("cex_execution_intents").insert({
      id: "i-direto", client_order_id: "c-direto", origin: "autopilot_cron",
      autonomous: true, exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
      order_type: "market", requested_qty: 10, requested_notional_usd: 1000,
      strategy_id: "estrategia-x", strategy_version: 3, strategy_hash: "hash-abc",
      certificate_id: CERT_ID, state: "RESERVED",
    });
    const r = await autorizarSubmissaoNoBanco(b.cliente, "i-direto");
    expect(r.ok).toBe(true);
    expect(b.intents[0].state).toBe("SUBMITTING");
  });

  it("⚠️⚠️ venue DO INTENT fora do certificado → recusa (a autoridade é a linha)", async () => {
    // Não é um caller mentindo: é a prova de que a venue conferida é a da
    // linha. Um intent gravado com venue fora do envelope não passa, e nada
    // que o caller pudesse dizer mudaria isso.
    const b = bancoFalso();
    b.certificados.push(certVivo());
    await b.cliente.from("cex_execution_intents").insert({
      id: "i-kraken", client_order_id: "c-kraken", origin: "autopilot_cron",
      autonomous: true, exchange_id: "kraken", symbol: "BTC/USDT", side: "buy",
      order_type: "market", requested_qty: 10, requested_notional_usd: 1000,
      strategy_id: "estrategia-x", strategy_version: 3, strategy_hash: "hash-abc",
      certificate_id: CERT_ID, state: "RESERVED",
    });
    const r = await autorizarSubmissaoNoBanco(b.cliente, "i-kraken");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.porque).toMatch(/kraken.*(fora do certificado|nao esta entre)/);
    // ⚠️ E o intent NÃO transicionou: a recusa não é a marcação.
    expect(b.intents[0].state).toBe("RESERVED");
  });
});

describe("⑦c A110 round 3 — market autônomo: o nocional DURÁVEL decide", () => {
  /**
   * Ordem MARKET não tem preço no pedido — o nocional tem de vir medido do
   * servidor (a rota repassa `guard.realNotionalUsd`) e gravado no intent.
   * A RPC confere o teto do certificado contra `requested_notional_usd`.
   */
  const ORDEM_MARKET: OrdemPedida = {
    exchangeId: "binance", symbol: "BTC/USDT", side: "buy", type: "market",
    qty: 10, notionalUsd: 1500,
  };

  it("⚠️ nocional persistido DENTRO do teto → autoriza e envia", async () => {
    const b = bancoFalso();
    b.certificados.push(certVivo());   // teto 2000; pedido 1500
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX_AUTO, ORDEM_MARKET, CREDS);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(r.desfecho).toBe("submetido");
    expect(b.intents[0].requested_notional_usd).toBe(1500);
  });

  it("⚠️⚠️ nocional persistido ACIMA do teto → ZERO createOrder", async () => {
    const b = bancoFalso();
    b.certificados.push(certVivo());
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX_AUTO,
      { ...ORDEM_MARKET, qty: 50, notionalUsd: 5000 }, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    if (r.desfecho === "recusado") expect(r.motivo).toBe("autorizacao_recusada");
  });

  it("⚠️⚠️ nocional NULL com certificado com teto → ZERO createOrder (não medimos não passa)", async () => {
    // Sem referência de preço, a rota deixa null de propósito — e a recusa
    // do banco é o comportamento correto, não um acidente.
    const b = bancoFalso();
    b.certificados.push(certVivo());
    const enviar = venue(ACEITA);
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre }, CTX_AUTO,
      { ...ORDEM_MARKET, notionalUsd: null }, CREDS);
    expect(enviar).not.toHaveBeenCalled();
    if (r.desfecho === "recusado") {
      expect(r.motivo).toBe("autorizacao_recusada");
      expect(r.porque).toMatch(/nocional|teto/i);
    }
    expect(b.intents[0].requested_notional_usd ?? null).toBeNull();
  });
});

describe("⑧ guarda estrutural — a RPC da 0060 deriva do intent e nasce FECHADA", () => {
  /**
   * ⚠️ LÊ O SQL, não a memória. O banco-falso reproduz a decisão; esta guarda
   * garante que a RPC de verdade existe com a assinatura NOVA (só uuid), lê
   * tudo do próprio intent sob lock, que a assinatura ANTIGA foi apagada de
   * forma inequívoca, e que a ACL nasce fechada — a lição do A116 aplicada
   * no nascimento, não na varredura seguinte.
   */
  const SQL = readFileSync(
    "supabase/migrations/0060_autorizacao_deriva_do_intent.sql", "utf8").toLowerCase();

  it("⚠️⚠️ a assinatura ANTIGA é apagada, de forma inequívoca", () => {
    // `create or replace` NÃO remove overloads: sem este drop, a versão de
    // cinco parâmetros (a que confia no caller) seguiria callable.
    expect(SQL).toMatch(
      /drop function if exists public\.cex_autorizar_e_submeter\(uuid, text, text, text, numeric\)/);
  });

  it("a coluna durável strategy_hash é criada no intent", () => {
    expect(SQL).toMatch(
      /alter table public\.cex_execution_intents\s+add column if not exists strategy_hash text/);
  });

  it("a RPC nova recebe APENAS o id — security definer, search_path fixo", () => {
    const i = SQL.indexOf("function public.cex_autorizar_e_submeter(\n  p_intent_id uuid");
    expect(i, "a RPC nova (só uuid) não está na migration").toBeGreaterThanOrEqual(0);
    const corpo = SQL.slice(i, SQL.indexOf("$$;", i));
    // ⚠️ NENHUM parâmetro de caller: venue/símbolo/nocional/hash não existem
    // como entrada. Se voltarem, o caller mentiroso volta junto.
    expect(corpo).not.toMatch(/p_strategy_hash/);
    expect(corpo).not.toMatch(/p_venue/);
    expect(corpo).not.toMatch(/p_symbol/);
    expect(corpo).not.toMatch(/p_notional/);
    expect(corpo).toMatch(/security definer/);
    expect(corpo).toMatch(/set search_path = public/);
    // ⚠️ A autoridade é o PRÓPRIO intent, sob lock — e os fatos vêm DA LINHA.
    expect(corpo).toMatch(/from public\.cex_execution_intents\s+where id = p_intent_id for update/);
    expect(corpo).toMatch(/v_intent\.exchange_id = any\(v_cert\.allowed_venues\)/);
    expect(corpo).toMatch(/v_intent\.symbol = any\(v_cert\.allowed_symbols\)/);
    expect(corpo).toMatch(/v_intent\.requested_notional_usd/);
    expect(corpo).toMatch(/v_intent\.strategy_hash is null or v_intent\.strategy_hash <> v_cert\.strategy_hash/);
    // ⚠️ E a transição usa a MESMA máquina de estados — sem segundo critério.
    expect(corpo).toMatch(/cex_transicao_permitida/);
  });

  it("⚠️⚠️ REVOKE de public/anon/authenticated e GRANT só a service_role — na MESMA migration", () => {
    expect(SQL).toMatch(
      /revoke execute on function public\.cex_autorizar_e_submeter\(uuid\)\s+from public, anon, authenticated/);
    expect(SQL).toMatch(
      /grant execute on function public\.cex_autorizar_e_submeter\(uuid\)\s+to service_role/);
  });

  it("⚠️ a exceção SELL e a janela residual estão DOCUMENTADAS no SQL", () => {
    // A guarda estrutural das DECISÕES: se alguém remover a isenção da saída
    // ou esconder a janela pós-commit, este teste quebra e força a conversa.
    const i = SQL.indexOf("if v_intent.autonomous and v_intent.side = 'buy' and not v_intent.simulated");
    expect(i, "a validação tem de mirar só a entrada autônoma real").toBeGreaterThanOrEqual(0);
    expect(SQL).toMatch(/janela residual/);
  });
});

describe("A127.9 — executor fail-closed para browser real sem conexao_id", () => {
  it("recusa ANTES do intent, reserva e createOrder", async () => {
    const b = bancoFalso();
    const enviar = venue({ tipo: "aceita", ordem: { id: "X" } as never });
    const reservar = vi.fn(async () => ({ ok: true as const }));
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre },
      { origin: "autopilot_browser", autonomous: true, sessionId: "S1", conexaoId: null },
      { exchangeId: "binance", symbol: "BTC/USDT", side: "sell", type: "market", qty: 1 },
      CREDS,
      { reservar },
    );
    expect(r.desfecho).toBe("recusado");
    if (r.desfecho === "recusado") expect(r.motivo).toBe("conexao_ausente");
    expect(b.intents).toHaveLength(0);
    expect(reservar).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
  });

  it("simulado browser sem conexao_id preserva o contrato e não chama a venue", async () => {
    const b = bancoFalso();
    const enviar = venue({ tipo: "aceita", ordem: { id: "NAO-DEVE-SAIR" } as never });
    const r = await executarOrdemCex(
      { db: b.cliente, enviar, killSwitches: passaLivre },
      { origin: "autopilot_browser", autonomous: true, sessionId: "S1", conexaoId: null },
      /**
       * ⚠️ `precoDeReferencia` É OBRIGATÓRIO NUM SIMULADO A MERCADO, e a
       * primeira versão deste teste não o passava: `simularOrdem` recusava com
       * "simulado sem preco de referencia" — de propósito, porque simulação
       * sem preço inventaria execução — e o teste falhava por um motivo que
       * NADA tem a ver com o que ele afirma.
       *
       * O que ele afirma é que a guarda A127 (`conexao_ausente`) ISENTA o
       * simulado. Com o preço no lugar, é exatamente isso que ele mede.
       */
      { exchangeId: "binance", symbol: "BTC/USDT", side: "sell", type: "market",
        qty: 1, simulated: true, precoDeReferencia: 100 },
      null,
    );
    expect(r.desfecho).toBe("submetido");
    expect(b.intents).toHaveLength(1);
    expect(enviar).not.toHaveBeenCalled();
  });
});
