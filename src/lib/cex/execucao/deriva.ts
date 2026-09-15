/**
 * ⚠️⚠️ DERIVA DE CONTA — achado A103.
 *
 * O sistema precisa detectar atividade que aconteceu FORA da Z-SWAP: um trade
 * manual feito pelo cliente no app da corretora, um depósito, um saque, uma
 * posição aberta por outro robô.
 *
 * ⚠️ POR QUE ISSO É CAMINHO DE DINHEIRO, e não curiosidade. O autopilot decide
 * quanto pode comprar a partir do que ele ACHA que tem. Se o saldo mudou por
 * fora, todas as contas dele passam a ser sobre uma conta que não existe:
 *
 *   · o teto de exposição libera capital que já foi gasto noutra coisa
 *   · o ramo de venda tenta vender uma bolsa que o cliente já vendeu
 *   · o P&L do dia mistura resultado que não é do robô
 *
 * ⚠️ E O BRIEFING É EXPLÍCITO: *"não consumir automaticamente saldo pessoal do
 * usuário só porque ele existe na exchange"*. Saldo que apareceu sem intent é
 * do cliente até prova em contrário — nunca munição do robô.
 *
 * ⚠️ A CONDUTA É FAIL-CLOSED: derivou, QUARENTENA. Nada automático prossegue
 * até mão humana ou reconciliação. Continuar operando "com cuidado" sobre um
 * estado que não fecha é a definição do problema.
 */

/** Um trade visto na corretora, com a ordem a que pertence. */
export interface TradeObservado {
  tradeId: string;
  orderId: string | null;
  symbol: string;
  qty: number;
  executedAtMs: number | null;
}

export interface JanelaDeAtribuicao {
  /** Ordens externas que NÓS criamos — de intents conhecidos. */
  ordensConhecidas: ReadonlySet<string>;
  /** Trades já no nosso livro, por id. */
  tradesNoLivro: ReadonlySet<string>;
  /**
   * ⚠️ Início da janela. Trades anteriores a isto NÃO são deriva: eles são de
   * antes de a sessão existir, e acusá-los faria o alarme tocar sempre — que é
   * o mesmo que não tocar nunca.
   */
  desdeMs: number;
}

export type MotivoDaDeriva =
  | "trade_nao_atribuivel"
  | "saldo_divergente";

export interface AchadoDeDeriva {
  motivo: MotivoDaDeriva;
  detalhe: string;
  /** Os trades que ninguém consegue explicar. */
  tradesOrfaos: TradeObservado[];
}

export type VereditoDeDeriva =
  | { derivou: false }
  | { derivou: true; achado: AchadoDeDeriva };

/**
 * Há trade na corretora que a Z-SWAP não consegue explicar?
 *
 * ⚠️ FUNÇÃO PURA. A decisão "esta conta ainda fecha?" precisa ser exercitável
 * sem corretora e sem banco.
 *
 * ⚠️ TRADE SEM `orderId` NÃO É DERIVA. Algumas venues não devolvem o id da
 * ordem no histórico de trades; acusar por ausência de campo transformaria uma
 * limitação de API num alarme de segurança, e o alarme que toca por engano é o
 * que ensina a ignorar alarme.
 */
export function detectarDeriva(
  trades: readonly TradeObservado[], janela: JanelaDeAtribuicao,
): VereditoDeDeriva {
  const orfaos: TradeObservado[] = [];
  for (const t of trades) {
    if (t.executedAtMs != null && t.executedAtMs < janela.desdeMs) continue;
    if (janela.tradesNoLivro.has(t.tradeId)) continue;
    // Sem id de ordem não dá para atribuir NEM para acusar — ver o cabeçalho.
    if (!t.orderId) continue;
    if (janela.ordensConhecidas.has(t.orderId)) continue;
    orfaos.push(t);
  }
  if (orfaos.length === 0) return { derivou: false };
  return { derivou: true, achado: {
    motivo: "trade_nao_atribuivel",
    detalhe: `${orfaos.length} trade(s) na corretora sem intent correspondente`,
    tradesOrfaos: orfaos,
  } };
}

/**
 * ⚠️ A TOLERÂNCIA DO SALDO. Corretoras arredondam, taxas saem em moedas
 * diferentes e o preço muda entre a leitura e a conta. Uma tolerância pequena
 * demais faz o alarme tocar toda passada; grande demais deixa passar um saque.
 *
 * 2% ou US$ 5 — o que for maior — cobre arredondamento e pedágio sem cobrir
 * movimentação de verdade.
 */
export const TOLERANCIA_DE_SALDO_PCT = 0.02;
export const TOLERANCIA_DE_SALDO_USD = 5;

/**
 * O saldo que a corretora reporta bate com o que o nosso livro explica?
 *
 * ⚠️ `esperadoUsd` NULO É AUSÊNCIA DE MEDIDA, e ausência não acusa nem absolve:
 * devolve `derivou: false` porque não há do que concluir, e quem chama continua
 * sem saber — em vez de receber um veredito inventado.
 */
export function conferirSaldo(
  observadoUsd: number | null, esperadoUsd: number | null,
): VereditoDeDeriva {
  if (observadoUsd == null || esperadoUsd == null) return { derivou: false };
  if (!Number.isFinite(observadoUsd) || !Number.isFinite(esperadoUsd)) {
    return { derivou: false };
  }
  const diff = Math.abs(observadoUsd - esperadoUsd);
  const limite = Math.max(TOLERANCIA_DE_SALDO_USD,
                          Math.abs(esperadoUsd) * TOLERANCIA_DE_SALDO_PCT);
  if (diff <= limite) return { derivou: false };
  return { derivou: true, achado: {
    motivo: "saldo_divergente",
    detalhe: `saldo observado ${observadoUsd.toFixed(2)} vs esperado `
      + `${esperadoUsd.toFixed(2)} (diferenca ${diff.toFixed(2)}, limite ${limite.toFixed(2)})`,
    tradesOrfaos: [],
  } };
}
