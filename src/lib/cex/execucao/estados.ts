/**
 * A MÁQUINA DE ESTADOS DO INTENT DE EXECUÇÃO — achados A80, A104, A109.
 *
 * ⚠️⚠️ A REGRA QUE ESTE ARQUIVO EXISTE PARA CARREGAR:
 *
 *     DE `SUBMITTING` NUNCA SE CHEGA A `FAILED_PRE_SUBMIT`.
 *
 * `SUBMITTING` é gravado imediatamente ANTES da chamada externa. A partir dali,
 * "nada aconteceu" deixou de ser algo que se possa CONCLUIR — só olhar a
 * corretora resolve. Timeout, ECONNRESET, crash e redeploy caem todos em
 * `UNKNOWN`, que é um estado de dúvida, não de falha.
 *
 * O código do DCA já descrevia esta dúvida por extenso e a resolvia no chute,
 * porque não havia terceira opção:
 *
 *     "uma ordem a mercado que estourou por timeout pode ter sido aceita pela
 *      corretora. Repetir arrisca comprar DUAS vezes; consumir o ciclo e seguir
 *      arrisca comprar uma vez a menos."
 *
 * ⚠️ POR QUE A TABELA VIVE EM DOIS LUGARES. A autoridade é o banco
 * (`cex_transicao_permitida`, migration 0051): é lá que a transição é aplicada
 * sob `for update`, e código de aplicação não pode ser a única trava do
 * caminho de dinheiro. Esta cópia existe para o executor DECIDIR antes de ir ao
 * banco e para ser testável sem banco.
 *
 * Duas cópias da mesma regra divergem na primeira correção — por isso
 * `estados.test.ts` LÊ o SQL da migration e exige que as duas concordem,
 * transição por transição. Divergir passa a quebrar o teste.
 */

export const ESTADOS_DO_INTENT = [
  "CREATED",
  "AUTHORIZED",
  "RESERVED",
  "SUBMITTING",
  "SUBMITTED",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCEL_PENDING",
  "CANCELED",
  "UNKNOWN",
  "RECONCILIATION_REQUIRED",
  "QUARANTINED",
  "FAILED_PRE_SUBMIT",
] as const;

export type EstadoDoIntent = (typeof ESTADOS_DO_INTENT)[number];

/** Espelho de `cex_transicao_permitida`. A autoridade é o SQL. */
export const TRANSICOES: Readonly<Record<EstadoDoIntent, readonly EstadoDoIntent[]>> = {
  CREATED:    ["AUTHORIZED", "FAILED_PRE_SUBMIT", "QUARANTINED"],
  AUTHORIZED: ["RESERVED", "FAILED_PRE_SUBMIT", "QUARANTINED"],
  RESERVED:   ["SUBMITTING", "FAILED_PRE_SUBMIT", "QUARANTINED"],
  /**
   * ⚠️ Sem FAILED_PRE_SUBMIT aqui, de propósito. Ver o cabeçalho.
   *
   * ⚠️ `CANCELED` ESTÁ AQUI PARA A RECUSA PROVADA — a corretora respondeu e
   * disse não (saldo insuficiente, símbolo inválido, chave sem permissão).
   * Nada executou e nada ficou vivo: `filled_qty` 0, `canceled_qty` igual ao
   * pedido. Não é `FAILED_PRE_SUBMIT` porque a requisição CHEGOU — a diferença
   * importa para quem for ler o histórico depois.
   *
   * ⚠️ E SÓ SE CHEGA AQUI POR UMA LISTA CURTA E EXPLÍCITA de erros
   * (`RECUSA_PROVADA` em `venue-primitivo.ts`). O default da classificação é
   * `UNKNOWN`: um erro que não sabemos ler NÃO vira "nada aconteceu".
   */
  SUBMITTING: ["SUBMITTED", "UNKNOWN", "CANCELED", "QUARANTINED"],
  SUBMITTED:  ["PARTIALLY_FILLED", "FILLED", "CANCEL_PENDING", "CANCELED",
               "UNKNOWN", "RECONCILIATION_REQUIRED", "QUARANTINED"],
  PARTIALLY_FILLED: ["PARTIALLY_FILLED", "FILLED", "CANCEL_PENDING", "CANCELED",
               "UNKNOWN", "RECONCILIATION_REQUIRED", "QUARANTINED"],
  CANCEL_PENDING: ["CANCELED", "PARTIALLY_FILLED", "FILLED",
               "UNKNOWN", "RECONCILIATION_REQUIRED", "QUARANTINED"],
  UNKNOWN:    ["SUBMITTED", "PARTIALLY_FILLED", "FILLED", "CANCELED",
               "RECONCILIATION_REQUIRED", "QUARANTINED"],
  RECONCILIATION_REQUIRED: ["SUBMITTED", "PARTIALLY_FILLED", "FILLED", "CANCELED",
               "UNKNOWN", "QUARANTINED"],
  // ⚠️ Quarentena só sai por reexame humano, nunca por automação que desiste.
  QUARANTINED: ["RECONCILIATION_REQUIRED"],
  FILLED:            [],
  CANCELED:          [],
  FAILED_PRE_SUBMIT: [],
} as const;

export function transicaoPermitida(de: EstadoDoIntent, para: EstadoDoIntent): boolean {
  return TRANSICOES[de].includes(para);
}

/**
 * Estados dos quais nada mais sai — o intent acabou e a verdade dele é final.
 *
 * ⚠️ `QUARANTINED` NÃO ESTÁ AQUI. Ele é um estado de espera por mão humana, e
 * chamá-lo de terminal faria o recuperador parar de olhar para ele.
 */
export const TERMINAIS: readonly EstadoDoIntent[] = ["FILLED", "CANCELED", "FAILED_PRE_SUBMIT"];

export const ehTerminal = (e: EstadoDoIntent): boolean => TERMINAIS.includes(e);

/**
 * Estados PRÉ-ENVIO: provadamente nada saiu para a corretora.
 *
 * ⚠️ Um fill contra qualquer um destes é CONTRADIÇÃO, não dado — e o banco
 * recusa (`cex_intent_pre_submit_sem_fill`). Quem encontrar essa situação deve
 * levar o intent a `RECONCILIATION_REQUIRED` e olhar, nunca gravar por cima.
 */
export const PRE_ENVIO: readonly EstadoDoIntent[] =
  ["CREATED", "AUTHORIZED", "RESERVED", "FAILED_PRE_SUBMIT"];

export const ehPreEnvio = (e: EstadoDoIntent): boolean => PRE_ENVIO.includes(e);

/**
 * O que o recuperador precisa reabrir depois de um restart (INVARIANTE 7).
 *
 * ⚠️ `SUBMITTING` ENTRA NA LISTA, e é o caso mais importante dela: é o estado
 * de um processo que morreu com a chamada externa em voo. Se o recuperador não
 * olhasse para ele, o crash do Cenário C viraria exatamente o fantasma que
 * este modelo existe para impedir.
 */
export const PRECISAM_RECONCILIAR: readonly EstadoDoIntent[] = [
  "SUBMITTING",
  "SUBMITTED",
  "PARTIALLY_FILLED",
  "CANCEL_PENDING",
  "UNKNOWN",
  "RECONCILIATION_REQUIRED",
];

export const precisaReconciliar = (e: EstadoDoIntent): boolean =>
  PRECISAM_RECONCILIAR.includes(e);

/**
 * O intent pode fazer o dinheiro do produto ANDAR?
 *
 * ⚠️⚠️ ACHADO A104 EM UMA LINHA. O DCA fazia `submit → timeout → status falhou
 * → avança o ciclo`, e a ordem podia ter executado. Avançar ciclo, contar
 * trade, abrir posição, somar P&L: nada disso pode acontecer sobre dúvida.
 *
 * `FILLED` e `CANCELED` são conclusões; `PARTIALLY_FILLED` também libera, mas
 * só pelo que JÁ ESTÁ NO LIVRO — nunca pelo que foi pedido.
 */
export function podeLiquidar(e: EstadoDoIntent): boolean {
  return e === "FILLED" || e === "CANCELED" || e === "PARTIALLY_FILLED";
}

/** Dúvida: o mundo externo pode ter mudado e ainda não sabemos como. */
export const EM_DUVIDA: readonly EstadoDoIntent[] =
  ["SUBMITTING", "UNKNOWN", "RECONCILIATION_REQUIRED", "QUARANTINED"];

export const emDuvida = (e: EstadoDoIntent): boolean => EM_DUVIDA.includes(e);
