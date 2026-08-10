/**
 * A TAXA DE SWAP POR PLANO — C21/C22 do Mapa do Lucro (Fase 9).
 *
 * ⚠️ O DONO DECIDIU O TETO: **1% no Free**, e pediu que os outros degraus
 * saíssem do perfil de cada plano. A escada e o raciocínio de cada degrau
 * estão abaixo, declarados antes da primeira cobrança.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ O ACHADO QUE ORIGINOU ISTO (11/08, verificação de estado da Fase 9).
 *
 * Os três agregadores suportam taxa de parceiro — 0x (`swapFeeBps`), LI.FI
 * (`fee`) e Jupiter (`platformFeeBps`). **Nenhum recebia o parâmetro.** O
 * `integratorKey` que existia na LI.FI é o header `x-lifi-api-key`: chave de
 * API, não taxa. Então C21/C22 rendia zero não por falta de volume, mas por
 * nunca ter sido pedido.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ A LÓGICA DA ESCADA: quem paga mais assinatura paga menos por trade.
 *
 * O produto é a ASSINATURA — o plano é o que se vende. A taxa por operação
 * existe para (a) monetizar quem não assina e (b) fazer o upgrade se pagar
 * sozinho para quem opera volume. Uma taxa alta no plano caro seria cobrar
 * duas vezes pela mesma coisa e empurrar o cliente de maior volume — o mais
 * valioso — para outro agregador.
 *
 * Por isso cada degrau cai pela metade, e `equilibrioMensalUsd` diz em que
 * volume o upgrade passa a ser mais barato que a taxa. Esse número vai para a
 * tela: é ele que transforma a escada numa oferta em vez de num castigo.
 */

import type { Tier } from "@/lib/tier/types";

/**
 * Pontos-base cobrados por swap, por plano. 100 bps = 1%.
 *
 * ⚠️ DECLARADO ANTES DE COBRAR, e o motivo de cada linha vai junto — número de
 * dinheiro sem o porquê vira constante que ninguém confere (invariante nº 12).
 */
export const TIER_FEE_BPS: Record<Tier, number> = {
  /** Teto, definido pelo dono. Quem não assina paga o preço de lista. */
  free:   100,
  /** Metade do teto: o primeiro passo tem que doer menos que assinar de novo. */
  pro:     50,
  /** Metade de novo. Este é o plano de quem opera com frequência. */
  trader:  25,
  /** O mais baixo do mapa: quem roda automação traz volume, e volume é o ativo. */
  pilot:   10,
};

/** A taxa em %, para a tela. */
export function taxaPct(tier: Tier): number {
  return TIER_FEE_BPS[tier] / 100;
}

/**
 * A partir de que volume MENSAL o upgrade se paga sozinho.
 *
 * ⚠️ ESTE É O NÚMERO QUE DECIDE, e ele não é a taxa. Um usuário só troca de
 * plano se a conta fechar para ele: a economia de taxa tem que superar a
 * diferença de assinatura. Sem este número na tela, a escada parece punição.
 *
 * Devolve `null` quando o upgrade NÃO se paga em taxa nenhuma — o que é uma
 * resposta legítima e tem que aparecer, não virar um número grande qualquer.
 */
export function equilibrioMensalUsd(
  de: Tier, para: Tier, precoDeUsd: number, precoParaUsd: number,
): number | null {
  const economiaBps = TIER_FEE_BPS[de] - TIER_FEE_BPS[para];
  const custoExtra  = precoParaUsd - precoDeUsd;
  // Upgrade que não baixa a taxa nunca se paga por taxa.
  if (economiaBps <= 0) return null;
  // Upgrade mais barato se paga na hora — não existe volume de equilíbrio.
  if (custoExtra <= 0) return 0;
  return Number(((custoExtra / (economiaBps / 10_000))).toFixed(2));
}

/**
 * Receita da taxa sobre um volume, em dólares.
 *
 * ⚠️ NUNCA NEGATIVA e nunca "grátis por omissão": volume inválido devolve 0,
 * que aqui é a resposta certa (não houve volume), diferente de `null` que
 * significaria "não medimos".
 */
export function receitaUsd(volumeUsd: number, tier: Tier): number {
  if (!(volumeUsd > 0) || !Number.isFinite(volumeUsd)) return 0;
  return Number((volumeUsd * (TIER_FEE_BPS[tier] / 10_000)).toFixed(4));
}

/**
 * A carteira que recebe a taxa nas cadeias EVM — dada pelo dono em 11/08.
 *
 * ⚠️ NÃO É SEGREDO, e por isso mora no código: endereço de recebimento é
 * público por construção (aparece em toda transação on-chain). O que ele
 * precisa é ser CONFERÍVEL numa revisão, e uma variável de ambiente esconderia
 * justamente isso de quem lê o PR.
 *
 * ⚠️ CHECKSUM EIP-55 CONFERIDO antes de gravar. Um endereço com um caractere
 * trocado é sintaticamente válido para quase toda biblioteca e manda a taxa
 * para um lugar que ninguém controla — e não há como desfazer.
 *
 * `SWAP_FEE_RECIPIENT` no ambiente sobrescreve, para poder trocar sem deploy.
 */
export const CARTEIRA_TAXA_EVM = "0x904126D219dC6c1f7c019303EC743Ad45F473c1F";

/**
 * ⚠️ SOLANA NÃO TEM DESTINATÁRIO, E ISSO NÃO É DESCUIDO.
 *
 * A Jupiter não aceita um endereço de carteira: o `platformFeeBps` exige um
 * `feeAccount`, que é uma CONTA DE TOKEN do lado Solana. Um endereço EVM ali
 * não é "menos ideal", é inválido — a cotação seria recusada, ou pior,
 * aceita apontando para lugar nenhum.
 *
 * Então a taxa em Solana fica DESLIGADA até existir uma conta própria. Aplicar
 * a carteira EVM ali seria inventar um destinatário, que é exatamente o
 * defeito que a trava abaixo existe para impedir.
 */
export const CARTEIRA_TAXA_SOLANA: string | null = null;

/**
 * ⚠️ A TRAVA DO CAMINHO DO DINHEIRO: sem destinatário para AQUELA cadeia,
 * taxa ZERO naquela cadeia.
 *
 * Cobrar sem ter para onde mandar é pior que não cobrar — o agregador pode
 * recusar a cotação, ou pior, aceitar e mandar para um endereço vazio. A
 * decisão é POR FAMÍLIA DE CADEIA, porque um destinatário de EVM não serve
 * para Solana e tratá-los como um só é como o dinheiro se perde.
 */
export type FamiliaCadeia = "evm" | "solana";

export function destinatarioDaTaxa(familia: FamiliaCadeia = "evm"): string | null {
  if (familia === "solana") {
    const s = (process.env.SWAP_FEE_ACCOUNT_SOLANA ?? "").trim();
    return s.length >= 32 ? s : CARTEIRA_TAXA_SOLANA;
  }
  const r = (process.env.SWAP_FEE_RECIPIENT ?? "").trim();
  return r.length >= 8 ? r : CARTEIRA_TAXA_EVM;
}

/** Os bps que de fato serão pedidos ao agregador — zero sem destinatário. */
export function bpsEfetivos(tier: Tier, familia: FamiliaCadeia = "evm"): number {
  return destinatarioDaTaxa(familia) ? TIER_FEE_BPS[tier] : 0;
}
