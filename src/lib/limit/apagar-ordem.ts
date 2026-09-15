/**
 * APAGAR O REGISTRO DE UMA ORDEM — e quando isso é uma mentira.
 *
 * ⚠️⚠️ ACHADO A24 DA AUDITORIA EXTERNA: excluir uma ordem CoW ATIVA apagava o
 * registro sem cancelá-la.
 *
 * O botão "excluir" chama `deletePendingOrder(id)`, que remove a linha do
 * `localStorage` — e só. Uma ordem enviada à CoW vive no ORDERBOOK DELES, sob
 * um `orderUid`, e continua lá: pode preencher horas depois, contra uma
 * carteira que o dono acredita estar limpa.
 *
 * ⚠️ E `cow.ts` NÃO TEM CANCELAMENTO. Só `submitCowOrder` e
 * `fetchCowOrderStatus`. O comentário de `CowSubmissionResult` chega a dizer
 * *"API slug used in subsequent requests (status / cancel)"* — o cancelamento
 * foi previsto e nunca escrito. O botão prometia o que o módulo não tem.
 *
 * ⚠️⚠️ E APAGAR ERA PIOR QUE NÃO FAZER NADA. O registro local é a ÚNICA coisa
 * que acompanha aquela ordem: o laço de 60s só consulta o status de ordens que
 * estão na lista. Apagado o registro, uma ordem que preencher não deixa rastro
 * nenhum na tela do dono.
 *
 * A regra desta casa vale aqui inteira: não se apaga o que não se consegue
 * parar, e "não sei" não é "está morta".
 */

export type StatusCow = "open" | "fulfilled" | "cancelled" | "expired" | "unknown";

export interface OrdemParaApagar {
  /** Ausente = ordem só local, que nunca foi para o orderbook de ninguém. */
  cow?: { lastStatus?: StatusCow } | null;
}

export type Veredito =
  | { pode: true }
  | { pode: false; porque: "viva" | "desconhecida" };

/**
 * Os três estados MORTOS na CoW. Fora deles, a ordem pode preencher.
 *
 * ⚠️ `unknown` fica de FORA de propósito. É o estado de "a consulta de status
 * não respondeu ainda", e tratá-lo como morto seria exatamente o defeito: o
 * dono apagaria o registro de uma ordem que pode estar viva, e perderia a
 * única coisa que a acompanha.
 */
const MORTAS: ReadonlySet<StatusCow> = new Set<StatusCow>(["fulfilled", "cancelled", "expired"]);

export function podeApagarORegistro(o: OrdemParaApagar): Veredito {
  // Ordem puramente local: apagar o registro É apagar a ordem.
  if (!o.cow) return { pode: true };
  const status = o.cow.lastStatus;
  if (status && MORTAS.has(status)) return { pode: true };
  // `open` explícito, ou status ainda não consultado.
  return { pode: false, porque: status === "open" ? "viva" : "desconhecida" };
}

/**
 * O link do explorer da CoW, que é onde o dono consegue de fato cancelar
 * enquanto este produto não tiver o cancelamento assinado.
 *
 * ⚠️ Os slugs são os MESMOS do `COW_API_SLUG` em `cow.ts`; a trava de teste
 * confere que as duas listas não divergem. Dois mapas do mesmo dado é a porta
 * dos fundos que esta auditoria já encontrou várias vezes.
 */
const EXPLORER_SLUG: Record<string, string> = {
  ethereum: "mainnet",
  arbitrum: "arbitrum_one",
  base:     "base",
};

export function linkDoExplorerCow(chain: string, orderUid: string): string | null {
  const slug = EXPLORER_SLUG[chain];
  if (!slug || !orderUid) return null;
  return `https://explorer.cow.fi/${slug}/orders/${orderUid}`;
}
