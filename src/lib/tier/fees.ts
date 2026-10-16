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
 * A carteira DONA das contas de taxa na Solana — dada pelo dono em 16/10 (substitui `EWPta…`, de 11/08).
 *
 * ⚠️ ELA NÃO É, SOZINHA, O QUE A JUPITER PEDE. O `feeAccount` é uma CONTA DE TOKEN desta carteira
 * para o mint em que a taxa é cobrada (USDC ou wSOL) — ver `lib/solana/conta-de-taxa.ts`, que também
 * confere na rede que a conta é desta dona. No LI.FI saindo da Solana, a taxa vai para a carteira SVM
 * cadastrada no portal (que é esta).
 *
 * `SWAP_FEE_WALLET_SOLANA` no ambiente sobrescreve.
 */
export const CARTEIRA_TAXA_SOLANA = "H7zwzP8PDfcp6ZQ4bd4zmXFRSpgwAYxjU7voJXMCKL5T";

/**
 * ⚠️⚠️ A SOLANA COBRA TAXA DESDE 16/10 — decisão do dono que REVERTE a de 11/08.
 *
 * Em 11/08 a Solana ficou sem taxa por quatro motivos. Revistos em 16/10 contra a API que o app
 * usa (Jupiter Metis `/swap/v1`), com cotação real:
 *   1. "piso de 50 bps" — NÃO vale na Metis: `platformFeeBps` 10/25/50/100 aceitos (era do programa
 *      de indicação antigo). A escada inteira cabe.
 *   2. "perde gás patrocinado" — não se aplica: gasless é da API Ultra, não da Metis.
 *   3. "Jupiter retém 20%" — não documentado para a Metis ("zero protocol fees"); conferir no
 *      primeiro recebimento.
 *   4. "API sem chave" — continua: chave da Jupiter pendente do dono. E (novo) a Metis "não é mais
 *      mantida ativamente"; migração para Swap V2 é rodada separada. Riscos aceitos pelo dono.
 * Plano: `docs/PLANO-TAXA-SOLANA.md`. Trava: `lib/solana/conta-de-taxa.ts`.
 */
export const SOLANA_COBRA_DESDE = "2026-10-16";

/** Como a Solana cobra — para a tela, o ZION e o painel de receita (o "porquê" de cada caso). */
export const REGRA_TAXA_SOLANA = [
  "mesma escada das EVM (free 1% · pro 0,50% · trader 0,25% · pilot 0,10%)",
  "Jupiter: cobrada em USDC quando um dos lados é USDC, em SOL quando um dos lados é SOL; outros pares sem taxa",
  "LI.FI saindo da Solana: cobrada com o integrator cadastrado",
  "conta de taxa ausente ou RPC fora: sem taxa e o swap segue (nunca quebra um swap)",
] as const;

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
    /**
     * ⚠️ Aqui vai a CARTEIRA dona (destino da família). A CONTA DE TOKEN que a Jupiter exige é
     * escolhida por PAR em `lib/solana/conta-de-taxa.ts` — par sem USDC/SOL sai sem taxa lá,
     * mesmo com a família tendo destino.
     */
    const s = (process.env.SWAP_FEE_WALLET_SOLANA ?? "").trim();
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) ? s : CARTEIRA_TAXA_SOLANA;
  }
  const r = (process.env.SWAP_FEE_RECIPIENT ?? "").trim();
  return r.length >= 8 ? r : CARTEIRA_TAXA_EVM;
}

/** Os bps que de fato serão pedidos ao agregador — zero sem destinatário. */
export function bpsEfetivos(tier: Tier, familia: FamiliaCadeia = "evm"): number {
  return destinatarioDaTaxa(familia) ? TIER_FEE_BPS[tier] : 0;
}
