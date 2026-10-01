/**
 * ⚠️⚠️⚠️ O ÚNICO LUGAR DO REPOSITÓRIO QUE CHAMA `exchange.createOrder`.
 *
 * Achado A107: manual, autopilot e DCA tinham cada um a sua semântica de
 * execução, os três chamando `placeCexOrder` direto. Três executores, nenhuma
 * autoridade. Este arquivo é o primitivo; `executor.ts` é a autoridade; e a
 * guarda estrutural (`autoridade-do-executor.test.ts`) recusa qualquer outro
 * arquivo que importe daqui ou que contenha a chamada.
 *
 * ⚠️ POR QUE UM ARQUIVO SÓ PARA ISSO. Uma guarda que procura a string
 * `createOrder` no repositório inteiro pega comentário, pega nome de variável,
 * pega documentação — e a primeira vez que ela acusa código correto, alguém a
 * afrouxa. Com o primitivo isolado num arquivo, a pergunta vira estrutural:
 * QUEM IMPORTA DAQUI. Isso é grafo, não texto.
 *
 * ⚠️ ESTE ARQUIVO NÃO DECIDE NADA. Sem kill-switch, sem autorização, sem
 * reserva, sem registro. Ele recebe o que já foi decidido e fala com a
 * corretora. Toda decisão mora no executor — senão a autoridade estaria
 * espalhada de novo, só que num lugar novo.
 */

import ccxt, { type Exchange } from "ccxt";
import type { CexId, CexCredentials, CexOrder } from "@/lib/cex/types";
import { normalizeOrder, instanciarExchange } from "@/lib/cex/server";

/** O que a corretora devolveu — ou o fato de não sabermos. */
export type RespostaDaVenue =
  | { tipo: "aceita"; ordem: CexOrder }
  /**
   * ⚠️ `incerta` É A RESPOSTA MAIS IMPORTANTE DESTE MÓDULO (INVARIANTE 3).
   *
   * Timeout, ECONNRESET, socket fechado, processo morto: a chamada COMEÇOU e
   * não terminou de forma legível. A ordem pode estar na corretora. Quem chama
   * é obrigado a tratar isto como dúvida, nunca como falha.
   */
  | { tipo: "incerta"; porque: string }
  /**
   * ⚠️ `recusada` exige PROVA de que nada saiu: a corretora respondeu e disse
   * não. Erro de rede NÃO cai aqui — cai em `incerta`.
   */
  | { tipo: "recusada"; porque: string };

/**
 * Os erros que provam que a corretora PROCESSOU e RECUSOU.
 *
 * ⚠️ A LISTA É CURTA DE PROPÓSITO, e o default é a dúvida. Classificar errado
 * para o lado de `recusada` cria exatamente o fantasma que o A80 descreve;
 * classificar para o lado de `incerta` custa uma reconciliação a mais. Só um
 * dos dois erros gasta dinheiro do dono.
 *
 * ⚠️ HIPÓTESE DECLARADA SOBRE AS CORRETORAS: estes tipos do ccxt são mapeados
 * a partir de respostas HTTP com corpo de erro da venue — ou seja, a requisição
 * chegou e foi respondida. Isto vem da semântica documentada do ccxt, NÃO de
 * teste contra API real (o briefing proíbe usar dinheiro para validar).
 */
const RECUSA_PROVADA = new Set<string>([
  "InsufficientFunds",
  "InvalidOrder",
  "BadSymbol",
  "BadRequest",
  "AuthenticationError",
  "PermissionDenied",
  "AccountSuspended",
  "NotSupported",
  "ArgumentsRequired",
]);

/**
 * ⚠️ E ESTES SÃO INEQUIVOCAMENTE DÚVIDA, mesmo que o nome pareça uma falha:
 * a requisição pode ter chegado. `RequestTimeout` é o caso de manual.
 */
const DUVIDA_EXPLICITA = new Set<string>([
  "RequestTimeout",
  "NetworkError",
  "ExchangeNotAvailable",
  "DDoSProtection",
  "OnMaintenance",
  "InvalidNonce",
]);

export function classificarErroDaVenue(e: unknown): RespostaDaVenue {
  const nome = (e as { constructor?: { name?: string } })?.constructor?.name ?? "";
  const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
  if (DUVIDA_EXPLICITA.has(nome)) return { tipo: "incerta", porque: `${nome}: ${msg}` };
  if (RECUSA_PROVADA.has(nome)) return { tipo: "recusada", porque: `${nome}: ${msg}` };
  // ⚠️ O DEFAULT É A DÚVIDA. Um erro que não sabemos classificar não pode
  // virar "nada aconteceu" — essa é a conversão que o briefing proíbe.
  return { tipo: "incerta", porque: `${nome || "erro"}: ${msg}` };
}

/**
 * Manda a ordem. NADA é decidido aqui.
 *
 * ⚠️ `clientOrderId` VIAJA JUNTO (A80). É o que permite perguntar à corretora,
 * depois de um timeout, "esta ordem existe aí?" — sem ele a reconciliação vira
 * adivinhação por símbolo, lado e horário.
 *
 * ⚠️ HIPÓTESE DECLARADA: o ccxt normaliza `params.clientOrderId` para o campo
 * de cada venue (`newClientOrderId` na Binance, `clOrdId` na OKX, `orderLinkId`
 * na Bybit, `clientOid` na KuCoin). Isto vem da documentação do ccxt, não de
 * teste contra API real. Se alguma venue ignorar o campo, a reconciliação
 * daquela venue cai no caminho por ordem/trades, que existe justamente porque
 * `fetchOrder` não basta (A102).
 */
export async function enviarOrdemNaVenue(
  id: CexId,
  creds: CexCredentials,
  req: {
    symbol: string; side: "buy" | "sell"; type: "market" | "limit";
    amount: number; price?: number | null; clientOrderId: string;
  },
): Promise<RespostaDaVenue> {
  let exchange: Exchange;
  try {
    exchange = await instanciarExchange(id, creds);
  } catch (e) {
    // Instanciar não fala com a corretora: falhar aqui É prova de que nada saiu.
    return { tipo: "recusada", porque: `instanciar: ${(e as Error)?.message ?? String(e)}`.slice(0, 200) };
  }

  try {
    const raw = await exchange.createOrder(
      req.symbol, req.type, req.side, req.amount,
      req.type === "limit" ? (req.price ?? undefined) : undefined,
      { clientOrderId: req.clientOrderId },
    ) as unknown as Record<string, unknown>;
    return { tipo: "aceita", ordem: normalizeOrder(raw) };
  } catch (e) {
    return classificarErroDaVenue(e);
  }
}

// ⚠️ `ccxt` é importado só para o tipo `Exchange`; a instância vem de
// `instanciarExchange`, que concentra a configuração por venue.
void ccxt;
