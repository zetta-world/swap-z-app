/**
 * O VEREDITO — e ele vem ANTES do número na tela.
 *
 * ⚠️⚠️ TRÊS INVARIANTES ATRAVESSAM DO ADMIN PARA CÁ, e nenhuma é enfeite:
 *
 *  1. **veredito antes do placar.** Número grande primeiro faz retorno parecer
 *     aprovação. O olho vai no número colorido, não no parágrafo — foi assim
 *     que a grade apareceu VERDE tendo perdido metade do capital.
 *  2. **"não medido" nunca vira 0 e nunca vira vermelho.** `corDoResultado(null)`
 *     é cinza. Ausência de medição e prejuízo são coisas diferentes.
 *  3. **a amostra fica visível.** `shouldTint`/`sampleLabel`: um número com
 *     n=8 não ganha cor de veredito. O painel do Valhalla exibia +1,19% de UMA
 *     operação com o mesmo peso visual de uma média de 268.
 *
 * ⚠️ E O COMPETIDOR É PARTE DO VEREDITO, não um extra. Em 31/08 a Rotação
 * rendeu −1,61% por período e **ficar em caixa bateu**. Uma bancada que só diz
 * "você ganhou 0,3%" esconde que não fazer nada teria dado mais.
 */

import { classificarResultado, type ClasseResultado } from "@/lib/admin/cor-resultado";
import { gradeSample, shouldTint, sampleLabel, type SampleGrade } from "@/lib/admin/sample";
import { equilibrioExigido } from "@/lib/bancada/custo";
import type { EstrategiaDoCliente } from "@/lib/bancada/vocabulario";
import { taxaDaBancadaPct } from "@/lib/bancada/vocabulario";
import type { Operacao, RodadaDoMotor } from "@/lib/bancada/motor";
import type { Veredito as VereditoNoBanco } from "@/lib/bancada/store";

/**
 * ⚠️⚠️ O QUE ESTA BANCADA NÃO MEDE — e o nome de cada coisa.
 *
 * A quarta classe de `zion/descartadas.ts`: `nao_medido` ≠ zero. Uma lista
 * vazia significa "medimos tudo"; ausência de item NUNCA deve poder ser lida
 * como ausência de problema.
 */
export const NAO_MEDIDO = {
  derrapagem:
    "derrapagem — o backtest lê velas, e vela não tem livro de ofertas. "
    + "O resultado é OTIMISTA por uma margem desconhecida, e cresce com o tamanho da ordem.",
  gas:
    "gás — na DEX ele anda em linha própria e não está incluído na taxa do pool.",
  liquidez:
    "liquidez — não sabemos se o mercado daquele instante aguentava o seu tamanho.",
  /**
   * ⚠️ Numa mesa da casa o alvo e o stop NÃO são fixos: saem da volatilidade a
   * cada operação. Então não existe UM "acerto para empatar" — e publicar um
   * número único ali seria inventar uma régua que a estratégia não tem.
   */
  bracketVariavel:
    "acerto para empatar — nesta mesa o alvo e o stop mudam a cada operação (saem da volatilidade), então não existe um número único de equilíbrio.",
  competidor:
    "comparação com ficar em caixa — sem ela não dá para saber se valeu a pena AGIR.",
} as const;

export type ChaveNaoMedido = keyof typeof NAO_MEDIDO;

export interface ResumoDaRodada {
  /** Quantas operações FECHARAM. ⚠️ Expiradas contam aqui: elas aconteceram. */
  n: number;
  /** ⚠️ Só as que bateram o ALVO. Expirada no lucro não é acerto de tese. */
  acertos: number;
  /** As três classes, separadas — é a separação que o flywheel comprou caro. */
  porDesfecho: Record<"alvo" | "stop" | "expirada", number>;
  /** Taxa de acerto observada, em %. `null` sem operação nenhuma. */
  acertoPct: number | null;
  brutoPct: number;
  taxaPct: number;
  /**
   * ⚠️ A SOMA ARITMÉTICA das operações — "expectância por operação × n".
   * Útil para ler o custo por operação; ⚠️ **NÃO comparável com segurar**.
   */
  liquidoPct: number;
  /**
   * ⚠️⚠️ O QUE UMA CONTA TERIA FEITO — e é ESTE que se compara com segurar.
   *
   * Somar percentuais de operação e pôr o total ao lado do retorno da janela do
   * buy-and-hold é comparar unidades diferentes com o mesmo símbolo de
   * porcentagem: um é `Σ` de retornos por trade, o outro é o que aconteceu com
   * um dólar do começo ao fim. Como o motor garante UMA posição por vez e sem
   * sobreposição, a série é sequencial e compõe honestamente:
   *
   *     equity = Π (1 + líquido_i / 100)
   */
  liquidoCompostoPct: number;
  /** ⚠️ `null` SEMPRE nesta fase — ver `NAO_MEDIDO.derrapagem`. Nunca 0. */
  derrapagemPct: number | null;
}

/**
 * Soma as operações.
 *
 * ⚠️ A SOMA É ARITMÉTICA, NÃO COMPOSTA, e a escolha tem consequência: composta
 * exigiria decidir quanto capital vai em cada operação, e essa decisão mudaria
 * o resultado sem mudar a estratégia. Aqui cada operação vale o mesmo, e o
 * número lê-se como "quanto rendeu por operação, somado" — que é o que o
 * cliente compara com o custo por operação.
 */
export function resumir(r: RodadaDoMotor, e: EstrategiaDoCliente): ResumoDaRodada {
  const ops: Operacao[] = r.operacoes;
  const porDesfecho = { alvo: 0, stop: 0, expirada: 0 };
  for (const o of ops) porDesfecho[o.desfecho]++;

  const brutoPct = ops.reduce((s, o) => s + o.brutoPct, 0);
  const liquidoPct = ops.reduce((s, o) => s + o.liquidoPct, 0);
  const equity = ops.reduce((eq, o) => eq * (1 + o.liquidoPct / 100), 1);
  const custoIdaEVolta = 2 * taxaDaBancadaPct(e.praca, e.papel);

  return {
    n: ops.length,
    acertos: porDesfecho.alvo,
    porDesfecho,
    acertoPct: ops.length > 0 ? (porDesfecho.alvo / ops.length) * 100 : null,
    brutoPct,
    // ⚠️ NEGATIVA, e o sinal é a mensagem: taxa é dinheiro que SAI. Uma coluna
    // "taxa 3,8%" ao lado de "bruto 4,1%" convida a somar os dois.
    taxaPct: -(ops.length * custoIdaEVolta),
    liquidoPct,
    liquidoCompostoPct: (equity - 1) * 100,
    derrapagemPct: null,
  };
}

export interface VeredictoDaBancada {
  veredito: VereditoNoBanco;
  /** A frase que a tela mostra ANTES do placar. */
  titulo: string;
  /** O parágrafo que explica, sem números novos. */
  porque: string;
  classe: ClasseResultado;
  amostra: SampleGrade;
  /** `false` quando a amostra não sustenta cor de veredito. */
  pinta: boolean;
  rotuloDaAmostra: string;
  /** Quanto o competidor rendeu, na mesma janela. `null` quando não medido. */
  competidorPct: number | null;
  /** O acerto que EMPATARIA, em %. `null` sem alvo e stop utilizáveis. */
  equilibrioPct: number | null;
  /**
   * ⚠️ O TEXTO EM PORTUGUÊS — para o BANCO, que é registro nosso.
   *
   * `titulo` e `porque` também. A tela do cliente NÃO os usa: ela monta a
   * frase a partir de `veredito` (o código) e dos números, pelo catálogo dos
   * quatro locales. Mandar prosa em português do servidor para uma interface em
   * inglês seria entregar a metade que ninguém revisou.
   */
  naoMedido: string[];
  /**
   * ⚠️ O MESMO CONTEÚDO EM CÓDIGO, para a tela traduzir. Ele existe porque a
   * lista de "não medido" é a parte do veredito que o cliente MAIS precisa
   * entender — e uma tela em chinês mostrando "derrapagem — o backtest lê
   * velas" não comunica nada.
   */
  naoMedidoChaves: ChaveNaoMedido[];
}

/**
 * O veredito completo.
 *
 * @param competidorPct  o que "não fazer nada" (ou segurar) teria rendido na
 *   MESMA janela. ⚠️ `null` é aceito e sai como não medido — inventar zero aqui
 *   afirmaria que o mercado ficou parado, que é uma medição que ninguém fez.
 */
export function julgar(
  resumo: ResumoDaRodada,
  e: EstrategiaDoCliente,
  competidorPct: number | null,
  extras: ChaveNaoMedido[] = [],
): VeredictoDaBancada {
  const custoIdaEVolta = 2 * taxaDaBancadaPct(e.praca, e.papel);
  const eq = equilibrioExigido(e.alvoPct, e.stopPct, custoIdaEVolta);

  /**
   * ⚠️ O QUE ENTRA NA COMPARAÇÃO É O COMPOSTO, nunca a soma aritmética — ver a
   * nota em `liquidoCompostoPct`. Usar a soma aqui compararia `Σ` de retornos
   * por trade com o retorno de janela do competidor, e o erro cresce com o
   * número de operações: quanto mais a estratégia opera, mais bonita ela fica
   * sem ter rendido nada a mais.
   */
  const vantagem = competidorPct == null ? null : resumo.liquidoCompostoPct - competidorPct;
  const classe = classificarResultado(resumo.n > 0 ? resumo.liquidoCompostoPct : null, vantagem);
  const amostra = gradeSample(resumo.n);
  const pinta = shouldTint(resumo.n);

  const chaves: ChaveNaoMedido[] = ["derrapagem"];
  if (e.praca === "dex") chaves.push("gas");
  for (const k of extras) if (!chaves.includes(k)) chaves.push(k);
  if (competidorPct == null) chaves.push("competidor");
  const naoMedido = chaves.map((k) => NAO_MEDIDO[k]);

  /**
   * ⚠️⚠️ A AMOSTRA TEM PRECEDÊNCIA SOBRE O SINAL. Um `+4%` com n=6 não é
   * vitória pequena, é ruído — e chamá-lo de vitória é o defeito exato que o
   * painel do Valhalla cometeu com cinco mesas de n=3, 5, 2, 14 e 268 exibidas
   * com o mesmo peso.
   */
  if (resumo.n === 0) {
    return {
      veredito: "ruido", titulo: "NÃO ABRIU NENHUMA OPERAÇÃO",
      porque: "O gatilho não disparou nenhuma vez na janela pedida. Isso não é um resultado ruim — "
        + "é a ausência de resultado. Tente uma janela maior, um período menor no gatilho, "
        + "ou um gatilho que dispare mais.",
      classe: "sem_dado", amostra, pinta: false,
      rotuloDaAmostra: sampleLabel(0),
      competidorPct, equilibrioPct: eq?.acertoParaEmpatarPct ?? null, naoMedido, naoMedidoChaves: chaves,
    };
  }

  if (!pinta) {
    return {
      veredito: "ruido", titulo: "DENTRO DO RUÍDO — não dá para ler",
      porque: `Foram ${resumo.n} operações. Abaixo de 30 a média ainda balança demais para `
        + "separar borda de sorte, então o número existe mas não sustenta veredito. "
        + "Ele fica visível e sem cor de propósito: 'ainda não sei' é diferente de 'deu errado'.",
      classe, amostra, pinta: false,
      rotuloDaAmostra: sampleLabel(resumo.n),
      competidorPct, equilibrioPct: eq?.acertoParaEmpatarPct ?? null, naoMedido, naoMedidoChaves: chaves,
    };
  }

  const veredito: VereditoNoBanco =
    classe === "perdeu" ? "perdeu"
    : classe === "so_perdeu_menos" ? "ganhou_perdendo_do_indice"
    : classe === "ganhou" ? "ganhou"
    : "ruido";

  return {
    veredito, titulo: tituloDe(veredito), porque: porqueDe(veredito, resumo, eq?.acertoParaEmpatarPct ?? null),
    classe, amostra, pinta,
    rotuloDaAmostra: sampleLabel(resumo.n),
    competidorPct, equilibrioPct: eq?.acertoParaEmpatarPct ?? null, naoMedido, naoMedidoChaves: chaves,
  };
}

function tituloDe(v: VereditoNoBanco): string {
  switch (v) {
    case "perdeu":                     return "PERDEU DINHEIRO";
    case "ganhou":                     return "GANHOU — e bateu ficar em caixa";
    case "ganhou_perdendo_do_indice":  return "RENDEU, mas não fazer nada teria rendido mais";
    case "ruido":                      return "DENTRO DO RUÍDO — não dá para ler";
  }
}

function porqueDe(v: VereditoNoBanco, r: ResumoDaRodada, equilibrioPct: number | null): string {
  const acerto = r.acertoPct == null ? "" :
    ` Você acertou o alvo em ${r.acertoPct.toFixed(0)}% das ${r.n} operações`
    + (equilibrioPct == null ? "." : `, e precisava de ${equilibrioPct.toFixed(1)}% só para empatar.`);

  switch (v) {
    case "perdeu":
      /**
       * ⚠️ A FRASE APONTA O PEDÁGIO QUANDO ELE FOI O ASSASSINO — bruto positivo
       * e líquido negativo. É literalmente o que aconteceu com o Maker de
       * Faixa: 70,4% de acerto e 121% do ganho entregue em taxa.
       */
      return (r.brutoPct > 0
        ? "O preço andou a seu favor e mesmo assim você terminou no vermelho: o pedágio comeu tudo."
        : "O preço andou contra.") + acerto;
    case "ganhou":
      return "Sobrou dinheiro depois do custo, e mais do que teria sobrado sem fazer nada." + acerto;
    case "ganhou_perdendo_do_indice":
      return "Você terminou com mais dinheiro, mas ficar parado teria dado mais — "
        + "correu risco e pagou custo para ficar atrás." + acerto;
    case "ruido":
      return "A amostra não sustenta leitura." + acerto;
  }
}
