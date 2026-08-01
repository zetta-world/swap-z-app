/**
 * EXPOSIÇÃO A MEV — o escudo que era adesivo.
 *
 * O QUE ESTAVA ERRADO (auditoria de 01/08):
 *
 * A plataforma tinha um botão de escudo verde no card de swap (ligado por
 * padrão), um chip no dashboard escrito "Escudo MEV ativo", e um toggle nas
 * configurações com esta descrição:
 *
 *     "Envio criptografado · anti-sandwich · mempool privado"
 *
 * Nada disso existia. A flag `mevProtect` era lida por exatamente dois lugares:
 * os dois componentes que a DESENHAVAM. Nenhuma linha do caminho de execução a
 * consultava.
 *
 * Na prática:
 *   · EVM     → `sendTransactionAsync` entrega para a carteira do usuário, que
 *               transmite pelo RPC dela. Mempool pública, texto claro.
 *   · Solana  → `sendRawTransaction` pela nossa conexão, RPC público, sem bundle
 *               Jito.
 *
 * Isso é pior que o selo de risco do token. Aquele era um número sem lastro;
 * este era uma AFIRMAÇÃO NOMEADA de proteção — "anti-sandwich", "mempool
 * privado" — para um usuário que, confiando nela, escolheria slippage mais
 * larga do que escolheria sabendo a verdade. A mentira não era passiva: ela
 * mudava a decisão do usuário na direção do prejuízo.
 *
 * O QUE ESTE ARQUIVO FAZ:
 *
 * Não finge proteção. Mede a EXPOSIÇÃO e diz em dólar.
 *
 * O lucro de um sanduíche é limitado pela tolerância de slippage: o atacante
 * empurra o preço até exatamente o `minOut` que o usuário assinou, e embolsa a
 * diferença. Ou seja, o teto do roubo é `notional × slippage` — um número que a
 * plataforma sabe calcular ANTES de o usuário assinar.
 *
 * "3% de slippage" não comunica nada. "até $30 podem ser tirados de você nesta
 * troca por quem estiver olhando a mempool" comunica. É a mesma informação e a
 * mesma regra do `impact-guard`: porcentagem é a unidade que faz o usuário
 * aceitar o que não aceitaria em dinheiro.
 *
 * E NÃO BLOQUEIA. Slippage larga às vezes é necessária — token volátil, pool
 * rasa. Bloquear seria paternalismo; o `impact-guard` já barra o catastrófico.
 */

import type { ChainId } from "@/lib/chains";

/** Onde a transação fica visível antes de ser incluída num bloco. */
export type MempoolKind =
  /** Mempool pública: qualquer um lê a transação pendente e pode sanduichar. */
  | "public"
  /** Sequenciador único, sem mempool pública — sanduíche de terceiro não é
   *  viável hoje. O sequenciador em si continua sendo confiança depositada. */
  | "sequencer"
  /** Solana: não há mempool, mas o líder do slot (e quem paga bundle) enxerga e
   *  reordena. Sanduíche é real, o mecanismo é que é outro. */
  | "leader";

const MEMPOOL: Record<string, MempoolKind> = {
  ethereum:  "public",
  bsc:       "public",
  polygon:   "public",
  avalanche: "public",
  base:      "sequencer",
  arbitrum:  "sequencer",
  optimism:  "sequencer",
  zetta:     "sequencer",
  solana:    "leader",
};

export function mempoolKind(chain: ChainId | undefined): MempoolKind {
  return (chain && MEMPOOL[chain]) ?? "public";
}

/** Abaixo disto o sanduíche raramente paga o próprio gás — avisar seria gritar
 *  lobo e treinar o usuário a ignorar o aviso que importa. */
export const MEV_WARN_USD = 25;
/** Acima disto a troca é alvo atraente e o aviso muda de tom. */
export const MEV_HIGH_USD = 250;

export type MevLevel = "ok" | "warn" | "high";

export interface MevVerdict {
  level: MevLevel;
  /** Teto do que um sanduíche pode extrair, em dólar. `null` sem notional. */
  stealableUsd: number | null;
  /** Frase pronta, em dinheiro. Vazia quando `ok`. */
  message: string;
  /** Como a rede ordena transações — determina se o ataque é viável. */
  mempool: MempoolKind;
}

export interface MevArgs {
  chain: ChainId | undefined;
  notionalUsd: number | null;
  slippageBps: number;
}

/**
 * Avalia quanto desta troca está exposto a extração por reordenação.
 *
 * Em rede de sequenciador o veredito é sempre `ok`: não existe mempool pública
 * para o atacante ler, e inventar alarme ali queimaria a credibilidade do aviso
 * nas redes onde ele é verdade.
 */
export function assessMevExposure({ chain, notionalUsd, slippageBps }: MevArgs): MevVerdict {
  const mempool = mempoolKind(chain);
  const stealableUsd =
    notionalUsd != null && notionalUsd > 0 && Number.isFinite(slippageBps)
      ? (notionalUsd * Math.max(0, slippageBps)) / 10_000
      : null;

  if (mempool === "sequencer") {
    return { level: "ok", stealableUsd, message: "", mempool };
  }
  if (stealableUsd == null || stealableUsd < MEV_WARN_USD) {
    return { level: "ok", stealableUsd, message: "", mempool };
  }

  const money = `$${stealableUsd.toFixed(2)}`;
  const pct = (slippageBps / 100).toFixed(2);
  const where = mempool === "leader"
    ? "quem reordena o bloco"
    : "quem estiver lendo a mempool";

  if (stealableUsd >= MEV_HIGH_USD) {
    return {
      level: "high", stealableUsd, mempool,
      message: `Sua tolerância de ${pct}% deixa até ${money} desta troca ao alcance de ${where}. `
        + "Nesse valor a troca é alvo atraente: reduza a tolerância ou divida a ordem em partes menores.",
    };
  }
  return {
    level: "warn", stealableUsd, mempool,
    message: `Sua tolerância de ${pct}% deixa até ${money} desta troca ao alcance de ${where}. `
      + "Reduzir a tolerância reduz esse teto na mesma proporção.",
  };
}

/**
 * A plataforma roteia por relay privado?
 *
 * Hoje: NÃO, em nenhuma rede — e esta função existe para que nenhuma tela possa
 * afirmar o contrário sem alterá-la. Em EVM quem transmite é a carteira do
 * usuário: o RPC é escolha dela, e o site não tem como forçar. Em Solana somos
 * nós que transmitimos, então ali a proteção seria implementável (bundle Jito) —
 * e não está implementada.
 */
export function privateRelayActive(): false {
  return false;
}

/** O que o usuário pode fazer de fato, por rede. Instrução honesta no lugar de
 *  um escudo verde que não protege nada. */
export function mevAdvice(chain: ChainId | undefined): string {
  switch (mempoolKind(chain)) {
    case "sequencer":
      return "Esta rede não tem mempool pública: sanduíche de terceiro não é viável aqui. "
        + "A ordenação fica com o sequenciador da rede.";
    case "leader":
      return "A Z-SWAP não envia por bundle privado em Solana. A defesa que funciona é "
        + "tolerância de slippage curta — ela limita diretamente quanto pode ser extraído.";
    default:
      return "A Z-SWAP não transmite sua transação: quem transmite é sua carteira, pelo RPC dela. "
        + "Para envio privado de verdade, configure na carteira um RPC protegido (ex.: Flashbots "
        + "Protect ou MEV Blocker). Sem isso, a tolerância de slippage é o seu único limite.";
  }
}
