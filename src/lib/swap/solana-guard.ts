/**
 * GUARD DE SOLANA — verifica a transação do Jupiter ANTES de assinar.
 *
 * POR QUE ISTO EXISTE, E POR QUE A ALLOWLIST DE EVM NÃO SERVE AQUI:
 *
 * No EVM o usuário assina uma chamada para UM endereço, e dá pra fixar esse
 * endereço numa allowlist (`trusted-targets.ts`): o `to` da transação e o
 * `spender` do approve. Em Solana, via Jupiter, o fluxo é outro — a API devolve
 * uma `swapTransaction` PRONTA, em base64, e a carteira assina o pacote
 * INTEIRO de instruções. Não existe `approve`, não existe spender, não existe
 * endereço de router para fixar.
 *
 * O risco é maior, não menor: no EVM você assina uma chamada conferível; aqui
 * você assina um blob opaco montado por terceiro. Se aquele blob trouxer uma
 * instrução a mais — um `SetAuthority` numa conta de token, um `CloseAccount`
 * mandando o saldo pra outro lugar, um `Assign` do System Program — a
 * assinatura autoriza isso junto, e não há como voltar atrás.
 *
 * Então a proteção equivalente é OUTRA: decodificar a transação e verificar
 * QUEM ela invoca. Um swap do Jupiter toca um conjunto pequeno e previsível de
 * programas. Qualquer coisa fora disso é motivo pra não assinar.
 *
 * FAIL-CLOSED POR PADRÃO: se a transação não puder ser lida, ela é RECUSADA.
 * "Não consegui verificar" nunca pode virar "então tá liberado" — é justamente
 * no caso ilegível que mora o ataque.
 */

import type { VersionedTransaction, PublicKey } from "@solana/web3.js";

/**
 * Programas que um swap legítimo do Jupiter invoca.
 *
 * Estes IDs são públicos e estáveis (programas on-chain são imutáveis no
 * endereço). A lista é deliberadamente CURTA: cada entrada é uma porta aberta,
 * então acrescentar uma exige saber exatamente por quê.
 */
export const JUPITER_ALLOWED_PROGRAMS: Record<string, string> = {
  // Jupiter Aggregator v6 — o roteador em si.
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": "Jupiter Aggregator v6",
  // SPL Token / Token-2022 — transferências dos próprios tokens do swap.
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "SPL Token-2022",
  // Associated Token Account — cria a conta de destino quando ela não existe.
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token Account",
  // System Program — criação de conta e wrap/unwrap de SOL.
  "11111111111111111111111111111111": "System Program",
  // Compute Budget — prioridade/fee, presente em praticamente toda tx moderna.
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  // Memo — Jupiter às vezes anexa referência; inofensivo.
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo",
};

export interface GuardVerdict {
  ok: boolean;
  /** Programas invocados que NÃO estão na lista — o motivo da recusa. */
  unknownPrograms: string[];
  /** Todos os programas invocados, para log/diagnóstico. */
  programs: string[];
  /** Mensagem curta e legível pro usuário quando `ok` é false. */
  reason?: string;
}

/**
 * Extrai os program IDs invocados por uma transação já desserializada.
 *
 * Cada instrução aponta para o programa via `programIdIndex`, que indexa as
 * contas da mensagem. Em transações versionadas parte das contas vem de
 * Address Lookup Tables e NÃO está em `staticAccountKeys` — se um índice cair
 * fora do array estático, não temos como saber que programa é aquele sem
 * resolver a ALT na rede. Esse caso devolve `null` (ilegível), e quem chama
 * trata como RECUSA. Um índice que "some" é exatamente onde alguém esconderia
 * uma instrução maliciosa.
 */
export function extractProgramIds(tx: VersionedTransaction): string[] | null {
  try {
    const msg = tx.message;
    const keys: PublicKey[] = msg.staticAccountKeys;
    if (!keys || keys.length === 0) return null;

    const out: string[] = [];
    for (const ix of msg.compiledInstructions) {
      const key = keys[ix.programIdIndex];
      if (!key) return null; // índice fora do estático (ALT) → ilegível
      out.push(key.toBase58());
    }
    return out;
  } catch { return null; }
}

/**
 * O guard. Recusa a transação quando ela invoca qualquer programa fora da
 * lista, ou quando não dá pra ler quem ela invoca.
 */
export function verifyJupiterTransaction(tx: VersionedTransaction): GuardVerdict {
  const programs = extractProgramIds(tx);
  if (programs === null) {
    return {
      ok: false, programs: [], unknownPrograms: [],
      reason: "Não foi possível verificar as instruções desta transação.",
    };
  }
  if (programs.length === 0) {
    return {
      ok: false, programs: [], unknownPrograms: [],
      reason: "Transação sem instruções — nada a assinar.",
    };
  }
  const unknown = [...new Set(programs.filter((p) => !(p in JUPITER_ALLOWED_PROGRAMS)))];
  if (unknown.length > 0) {
    return {
      ok: false, programs, unknownPrograms: unknown,
      reason: `Transação invoca programa não reconhecido: ${unknown[0].slice(0, 8)}…`,
    };
  }
  return { ok: true, programs, unknownPrograms: [] };
}

/**
 * Escotilha de emergência. Se a Jupiter mudar de programa (uma v7, por
 * exemplo), o guard passa a recusar swaps legítimos — e o dono precisa
 * conseguir destravar sem esperar deploy.
 *
 * Só desliga com o valor exato "off", e é `NEXT_PUBLIC_` porque a checagem roda
 * no cliente, junto da assinatura. Desligar reabre o vetor: é interruptor de
 * incidente, não configuração de rotina.
 */
export function guardEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SOLANA_TX_GUARD !== "off";
}
