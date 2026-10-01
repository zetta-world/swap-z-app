/**
 * A CHAVE DE IDEMPOTÊNCIA MANDADA À CORRETORA — achado A80.
 *
 * ⚠️⚠️ PARA QUE ELA EXISTE. Depois de um timeout, a única pergunta que importa
 * é "esta ordem existe aí?". Sem uma chave NOSSA viajando junto, a resposta
 * depende de casar símbolo, lado, quantidade e horário — que é adivinhação com
 * cara de reconciliação, e erra exatamente quando há duas ordens parecidas.
 *
 * Com a chave, a pergunta vira exata: a corretora devolve a ordem cujo
 * `clientOrderId` é este, ou nenhuma.
 *
 * ⚠️ O FORMATO É O MENOR DENOMINADOR COMUM DAS VENUES, e isso não é gosto:
 *
 *     OKX      `clOrdId`        1–32, letras e números
 *     Binance  `newClientOrderId` até 36, aceita `.:/_-`
 *     Bybit    `orderLinkId`    até 36
 *     KuCoin   `clientOid`      até 128, recomendam UUID
 *
 * Então: SÓ letras e números, 28 caracteres. Cabe nas quatro sem cada uma ter
 * um formato próprio — e um formato por corretora seria mais uma régua para
 * divergir.
 *
 * ⚠️ HIPÓTESE DECLARADA: estes limites vêm da documentação pública das venues,
 * NÃO de teste contra a API real (o briefing proíbe usar dinheiro real para
 * validar). Se alguma corretora recusar o formato, o intent vai para
 * `FAILED_PRE_SUBMIT` na primeira tentativa, antes de qualquer dinheiro sair —
 * é falha barulhenta, não silenciosa.
 */

/** O maior tamanho que cabe nas quatro venues suportadas. */
export const TAMANHO_DO_CLIENT_ORDER_ID = 28;

/** Só o que as quatro venues aceitam sem exceção. */
const PERMITIDO = /^[A-Za-z0-9]+$/;

/**
 * Gera a chave. `aleatorio` é injetado para o teste poder ser determinístico —
 * um gerador que o teste não controla só consegue provar o formato, nunca que
 * a mesma entrada dá a mesma saída.
 */
export function gerarClientOrderId(
  aleatorio: () => string = () => globalThis.crypto.randomUUID(),
): string {
  const cru = (aleatorio() + aleatorio()).replace(/[^A-Za-z0-9]/g, "");
  return ("zs" + cru).slice(0, TAMANHO_DO_CLIENT_ORDER_ID);
}

/**
 * A chave serve para ser mandada a esta corretora?
 *
 * ⚠️ Conferir na SAÍDA, e não só confiar no gerador: a chave também chega aqui
 * vinda do banco, de um intent gravado por uma versão anterior do código.
 */
export function clientOrderIdValido(id: string): boolean {
  return id.length > 0
      && id.length <= TAMANHO_DO_CLIENT_ORDER_ID
      && PERMITIDO.test(id);
}
