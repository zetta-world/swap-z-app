/**
 * ENVIO PRIVADO EM SOLANA — a única rede em que a proteção depende de nós.
 *
 * CONTEXTO (auditoria 01/08, continuação de `mev-guard.ts`):
 *
 * O `mev-guard` mostrou que a plataforma afirmava "mempool privado ·
 * anti-sandwich" sem nada por trás, e passou a MEDIR a exposição em vez de
 * fingir proteção. Ficou registrada uma dívida: em EVM quem transmite é a
 * carteira do usuário, pelo RPC dela, e o site não tem como forçar nada — mas
 * em SOLANA quem transmite somos nós (`connection.sendRawTransaction`). Ali a
 * proteção é implementável, e não estava implementada.
 *
 * Isto é a implementação.
 *
 * COMO FUNCIONA:
 *
 * Solana não tem mempool, mas o líder do slot enxerga e reordena. O caminho
 * privado é o block engine da Jito: a transação leva uma instrução de gorjeta
 * (tip) e é entregue ao engine em vez do RPC público, entrando no bloco como
 * bundle em vez de ficar exposta na fila do líder.
 *
 * AS TRÊS DECISÕES QUE IMPORTAM:
 *
 * 1. A GORJETA NUNCA PODE CUSTAR MAIS QUE O ROUBO QUE EVITA. Pagar $0,30 para
 *    proteger $0,50 é transferir o prejuízo de lugar, não evitá-lo. Por isso o
 *    tip é uma FRAÇÃO da exposição calculada pelo `mev-guard` — e abaixo de um
 *    piso de exposição a resposta certa é NÃO USAR Jito, porque não há o que
 *    proteger.
 *
 * 2. FALHA DO JITO NÃO PODE QUEBRAR O SWAP. Se o block engine estiver fora, cai
 *    para o RPC normal. A transação continua válida — o tip vira uma taxa paga
 *    sem o benefício, o que é ruim mas é MUITO melhor que um swap que não
 *    executa. O chamador recebe `usedJito: false` para poder dizer a verdade na
 *    tela em vez de exibir um escudo que não houve.
 *
 * 3. NASCE DESLIGADO. Mesma disciplina do `solana-guard`: eu não consigo
 *    exercitar o block engine da Jito daqui, e ligar por padrão um caminho de
 *    dinheiro que nunca vi rodar é exatamente o erro que essa auditoria inteira
 *    existe para não repetir. `SOLANA_JITO=on` liga quando alguém tiver olhado
 *    uma execução real acontecer.
 */

/** Endpoints do block engine. Regionais — o mais próximo entrega mais rápido. */
export const JITO_ENDPOINTS = {
  mainnet:    "https://mainnet.block-engine.jito.wtf/api/v1/transactions",
  amsterdam:  "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/transactions",
  frankfurt:  "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/transactions",
  ny:         "https://ny.mainnet.block-engine.jito.wtf/api/v1/transactions",
  tokyo:      "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/transactions",
} as const;

export type JitoRegion = keyof typeof JITO_ENDPOINTS;

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Abaixo desta exposição não vale a pena: o sanduíche não pagaria o próprio
 * custo, e a gorjeta seria despesa pura. É o mesmo limiar do aviso do
 * `mev-guard` — as duas decisões têm de concordar, senão a tela avisa de um
 * risco que o envio ignora, ou o envio cobra por um risco que a tela não vê.
 */
export const JITO_MIN_EXPOSURE_USD = 25;

/** Fatia da exposição que aceitamos gastar em gorjeta. */
export const JITO_TIP_SHARE = 0.05;   // 5% do que estaria em risco

/** Piso: abaixo disto o bundle não é competitivo e simplesmente não entra. */
export const JITO_TIP_FLOOR_LAMPORTS = 10_000;      // ~0,00001 SOL
/** Teto: proteção não pode virar a maior linha de custo da troca. */
export const JITO_TIP_CAP_LAMPORTS = 5_000_000;     // 0,005 SOL

export function jitoEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SOLANA_JITO === "on";
}

export interface TipDecision {
  /** `false` = mandar pelo RPC normal, sem gorjeta. */
  useJito: boolean;
  tipLamports: number;
  reason: string;
}

/**
 * Quanto de gorjeta, ou nenhuma.
 *
 * `exposureUsd` vem do `mev-guard` (`notional × slippage`) — o teto do que um
 * sanduíche poderia extrair. `solUsd` converte a fatia dessa exposição em
 * lamports.
 */
export function decideTip(exposureUsd: number | null, solUsd: number | null): TipDecision {
  if (!jitoEnabled()) {
    return { useJito: false, tipLamports: 0, reason: "desligado (NEXT_PUBLIC_SOLANA_JITO)" };
  }
  if (exposureUsd == null || !Number.isFinite(exposureUsd) || exposureUsd < JITO_MIN_EXPOSURE_USD) {
    return { useJito: false, tipLamports: 0, reason: "exposição baixa demais para justificar a gorjeta" };
  }
  if (solUsd == null || !(solUsd > 0)) {
    // Sem preço do SOL não dá para dimensionar a gorjeta. Chutar um valor fixo
    // aqui poderia cobrar caro numa troca pequena — e a regra 1 diz que não.
    return { useJito: false, tipLamports: 0, reason: "sem preço do SOL para dimensionar a gorjeta" };
  }
  const tipUsd = exposureUsd * JITO_TIP_SHARE;
  const raw = Math.round((tipUsd / solUsd) * LAMPORTS_PER_SOL);
  const tipLamports = Math.min(JITO_TIP_CAP_LAMPORTS, Math.max(JITO_TIP_FLOOR_LAMPORTS, raw));
  return { useJito: true, tipLamports, reason: `gorjeta = ${(JITO_TIP_SHARE * 100).toFixed(0)}% da exposição` };
}

export interface JitoSendResult {
  signature: string | null;
  /** A verdade sobre o caminho usado — a tela não pode afirmar escudo sem isto. */
  usedJito: boolean;
  error?: string;
}

/**
 * Entrega a transação assinada ao block engine.
 *
 * NÃO faz fallback sozinho: quem chama decide, porque só o chamador sabe se já
 * existe uma conexão RPC pronta e se a transação ainda está dentro do
 * `lastValidBlockHeight`. Devolver o erro em vez de escondê-lo é o que permite
 * ao chamador cair para o RPC normal com honestidade.
 */
export async function sendViaJito(
  rawTxBase64: string,
  region: JitoRegion = "mainnet",
  fetchImpl: typeof fetch = fetch,
): Promise<JitoSendResult> {
  try {
    const res = await fetchImpl(JITO_ENDPOINTS[region], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "sendTransaction",
        params: [rawTxBase64, { encoding: "base64" }],
      }),
    });
    if (!res.ok) {
      return { signature: null, usedJito: false, error: `block engine HTTP ${res.status}` };
    }
    const j = await res.json() as { result?: string; error?: { message?: string } };
    if (j.error) return { signature: null, usedJito: false, error: j.error.message ?? "erro do block engine" };
    if (!j.result) return { signature: null, usedJito: false, error: "block engine não devolveu assinatura" };
    return { signature: j.result, usedJito: true };
  } catch (e) {
    return { signature: null, usedJito: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * O que a interface pode afirmar depois do envio — e o que NÃO pode.
 *
 * Existe para que nenhuma tela repita o erro do escudo verde: se o bundle não
 * foi usado, o texto tem que dizer isso, mesmo quando o swap deu certo.
 */
export function sendNarrative(r: JitoSendResult, tipLamports: number): string {
  if (r.usedJito) {
    return `Enviado por bundle privado (gorjeta de ${(tipLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL).`;
  }
  return "Enviado pelo RPC público — sem bundle privado."
    + (r.error ? ` Motivo: ${r.error}.` : "");
}
