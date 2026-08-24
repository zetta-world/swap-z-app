/**
 * O CELEIRO — o registro dos agentes da segunda arena.
 *
 * Ver `docs/PLANO-O-CELEIRO.md`. Este arquivo é a fonte única de quem existe,
 * o que cada um faz, e — o campo que o registro antigo não tinha — o que cada
 * um NÃO faz.
 *
 * ⚠️⚠️ POR QUE NENHUM AGENTE **PREVÊ** DIREÇÃO — e por que alguns TOMAM lado.
 *
 * ⚠️ CORREÇÃO DE 22/08: a versão anterior dizia "nenhum agente aposta em
 * direção", e isso era uma GENERALIZAÇÃO ERRADA da medição abaixo. O que se
 * mediu foi LLM PREVENDO direção. Seguir tendência MEDIDA é outra coisa: é
 * reagir a um estado observável, e a #324 mediu que isso PAGA — 5,5× mais
 * quando a posição cresce.
 *
 * A regra correta é: o LADO vem do regime medido (`regime.ts`), nunca da
 * opinião de um modelo.
 *
 * Em 19/08 mediu-se o alpha de cada mesa contra a linha de base sem
 * inteligência nenhuma: num passeio aleatório, a chance de bater o alvo antes
 * do stop é `stop/(alvo+stop)`.
 *
 *   grok_scan      moeda 37,4%   IA 24,8%   alpha −12,6 pp
 *   self_scan      moeda 38,7%   IA 27,7%   alpha −11,0 pp
 *   kimi_scan      moeda 33,3%   IA 23,8%   alpha  −9,5 pp
 *   deepseek_scan  moeda 37,5%   IA 29,9%   alpha  −7,6 pp
 *   mistral_scan   moeda 35,9%   IA 29,2%   alpha  −6,7 pp
 *   strat_ai       moeda 30,4%   IA  0,0%   alpha −30,4 pp
 *
 * Seis modelos, 3.300 decisões, TODOS abaixo do acaso. Não é sinal fraco: é
 * informação negativa. Nenhum ajuste de prompt conserta seis modelos
 * independentes falhando na mesma direção — então a família inteira sai.
 *
 * ⚠️ E POR QUE `naoFaz` É UM CAMPO OBRIGATÓRIO.
 *
 * O modo de esta arena virar um painel gêmeo do antigo é um agente escorregar
 * de volta para "eu acho que sobe". `naoFaz` escreve a fronteira de cada um, e
 * `agentes.test.ts` a defende — inclusive proibindo que dois agentes tenham o
 * mesmo mecanismo, que foi o defeito das 24 mesas.
 */

/** Onde o agente opera. */
export type Modalidade = "spot_gate" | "margem_gate" | "futuros_gate" | "dex";

/**
 * Como a ordem chega ao livro.
 *
 * ⚠️ Mora AQUI, e não em `taxas.ts`, porque `taxas.ts` já importa `Modalidade`
 * daqui. Definir os dois lados um no outro fecharia um ciclo — inofensivo para
 * tipo puro, mas o primeiro valor em tempo de execução que cruzasse a fronteira
 * viraria `undefined` sem erro de compilação.
 */
export type Execucao = "maker" | "taker";

/** O ritmo da operação — o "swing e day" do mandato. */
export type Ritmo = "day" | "swing" | "continuo";

/**
 * ⚠️ NÃO EXISTE `"ia"` SOZINHO, e a ausência é o projeto.
 *
 * IA nunca decide operação neste registro. Onde ela entra (`bot_mais_ia`) é
 * para ESCOLHER ONDE operar — nunca para dizer para onde o preço vai. O uso
 * pesado de modelo mora no Investigador, que não opera.
 */
export type Motor = "bot" | "bot_mais_ia";

/** A faixa de capital. Ranking é por faixa — ver §6 do plano. */
export type Faixa = "semente" | "trabalho" | "renda";

export type Categoria = "renda" | "estrutura" | "tendencia" | "evento";

export interface Agente {
  id: string;
  /** Descritivo, nunca mitológico — §3 do plano. O nome DIZ o que ele faz. */
  nome: string;
  categoria: Categoria;
  modalidade: Modalidade;
  /**
   * Como a ordem chega ao livro — e é ela que define a TAXA junto com a praça.
   *
   * ⚠️⚠️ NÃO É DETALHE. Em futuros, maker paga 0,015% e taker 0,05%: mais de
   * três vezes. O `maker_de_faixa` foi aposentado por líquido negativo com uma
   * taxa de spot-taker cobrada dele — enquanto o nome dele anuncia que ele
   * POSTA. Foi morto por um número que o modelo inventou.
   */
  execucao: Execucao;
  /**
   * ⚠️ CONTROLE DE DIREÇÃO ≠ CONTROLE DE RETORNO. `controle` marca o piso de
   * RETORNO (o Aluguel de Ocioso): "valeu arriscar em vez de deixar rendendo?".
   * Este marca o piso de DIREÇÃO: "o sinal sabe para que lado o mercado vai?".
   * Confundir os dois deixou o segundo sem resposta por semanas.
   */
  controleDeDirecao?: boolean;
  ritmo: Ritmo;
  motor: Motor;
  faixa: Faixa;
  /** Abaixo disto o agente não compete: a profundidade muda o retorno (1.3). */
  capitalMinimoUsd: number;

  /**
   * A BANCA do agente — o capital que ele administra.
   *
   * ⚠️⚠️ ELA NASCEU DE UM BURACO (22/08). Até aqui existiam DUAS noções de
   * capital que não conversavam: `CELEIRO_CAPITAL_PAPEL_USD = 1000` (a banca do
   * Aluguel e da Colheita) e um `Math.max(capitalMinimoUsd, 50)` com o **50
   * escrito na mão dentro do cron**.
   *
   * Isso produzia três incoerências:
   *
   *  · `capitalMinimoUsd` virava tamanho de aposta. "Preciso de $150 para o
   *    livro aguentar" NÃO é "aposto $150 por vez".
   *  · não havia teto de exposição — nada impedia o agente de empilhar posições.
   *  · o `vs. piso` comparava USDT produzido, e o piso rende sobre $1.000
   *    enquanto o Maker arriscava $50. **A comparação favorecia quem arriscava
   *    mais**, que é o pior viés possível num placar de risco.
   */
  bancaInicialUsd: number;

  /**
   * Que fração da banca vai em CADA posição.
   *
   * ⚠️ FRAÇÃO, NÃO VALOR FIXO: se a banca cresce, a aposta acompanha sem
   * ninguém editar código — e o teto de exposição continua valendo.
   */
  fracaoPorPosicao: number;

  /**
   * Quanto da banca pode estar exposto ao mesmo tempo.
   *
   * ⚠️ SEM ESTE TETO, "ambicioso" vira "alavancado sem perceber": três posições
   * de 20% já são 60% da banca em risco simultâneo, e ninguém decidiu isso.
   */
  tetoDeExposicao: number;

  /**
   * Teto DURO de alavancagem. A conta de `alavancagemCoerente` manda; isto é o
   * limite que ela nunca pode ultrapassar, por mais calmo que o mercado esteja.
   * `1` = o agente não alavanca.
   */
  alavancagemMaxima: number;
  /** COMO ganha USDT. Tem de ser único no registro — sem dois iguais. */
  mecanismo: string;
  /** A fronteira. O que este agente jamais faz, para não virar direcional. */
  naoFaz: string;
  /** De onde vem a receita, em causas do extrato (`celeiro_fluxos.causa`). */
  receitaVemDe: ReadonlyArray<"funding" | "aluguel" | "preco">;
  aposentaQuando: string;
  /** O piso contra o qual todos são medidos. Exatamente um agente o é. */
  controle?: true;
}

export const AGENTES: readonly Agente[] = [
  // ── CATEGORIA RENDA — recebe por existir, não por acertar ────────────────
  {
    id: "aluguel_ocioso",
    nome: "Aluguel de Ocioso",
    categoria: "renda",
    modalidade: "margem_gate",
    /** empresta USDT — a oferta fica postada, nunca cruza livro. */
    execucao: "maker",
    ritmo: "continuo",
    motor: "bot",
    faixa: "renda",
    capitalMinimoUsd: 0,
    bancaInicialUsd: 1000,
    fracaoPorPosicao: 1.0,
    tetoDeExposicao: 1.0,
    alavancagemMaxima: 1,
    mecanismo:
      "empresta o USDT parado à taxa de margem da Gate.io e recebe juro; "
      + "não abre posição em nenhum ativo",
    naoFaz:
      "não compra nada, não vende nada, não olha preço. Risco de mercado ZERO — "
      + "é a única linha do Celeiro cujo retorno não depende de mercado nenhum.",
    receitaVemDe: ["aluguel"],
    /**
     * ⚠️ O CONTROLE. Agente que rende menos que este está DESTRUINDO valor —
     * bastaria deixar o dinheiro parado rendendo. É a mesma função que o
     * HEIMDALL tem na arena antiga, e pela mesma razão: sem piso não há régua.
     */
    controle: true,
    aposentaQuando:
      "nunca: controle sem tratamento é a linha de base do experimento",
  },
  {
    id: "colheita_funding",
    nome: "Colheita de Funding",
    categoria: "renda",
    modalidade: "futuros_gate",
    /** carry de dias: monta com limitada dos dois lados. */
    execucao: "maker",
    ritmo: "swing",
    motor: "bot",
    /**
     * ⚠️ FAIXA RENDA, E NÃO SEMENTE. São QUATRO pernas de corretagem (0,45%
     * pagas uma vez) contra um funding que se acumula a cada 8h — o ponto de
     * equilíbrio mediano MEDIDO é 42 dias. Capital pequeno paga a entrada e
     * sai antes de colher.
     */
    faixa: "renda",
    capitalMinimoUsd: 400,
    bancaInicialUsd: 1000,
    fracaoPorPosicao: 0.5,
    tetoDeExposicao: 0.5,
    alavancagemMaxima: 1,
    mecanismo:
      "comprado no spot e vendido no perpétuo do MESMO ativo, mesmo tamanho: "
      + "as pernas cancelam a direção e sobra o funding contratual de 8 em 8h",
    naoFaz:
      "não tem opinião sobre o preço. Se o ativo dobrar ou cair pela metade o "
      + "resultado é o mesmo — só sai se o funding virar contra ou a margem apertar.",
    receitaVemDe: ["funding"],
    aposentaQuando:
      "o funding mediano anualizado ficar abaixo do que o Aluguel de Ocioso "
      + "paga sem risco — aí a complexidade não está comprando nada",
  },

  // ── CATEGORIA ESTRUTURA — ganha de desalinhamento, não de previsão ───────
  {
    id: "convergencia_base",
    nome: "Convergência de Base",
    categoria: "estrutura",
    modalidade: "futuros_gate",
    /** espera a base abrir; entrar com pressa comeria a sobra. */
    execucao: "maker",
    ritmo: "day",
    motor: "bot",
    faixa: "trabalho",
    capitalMinimoUsd: 150,
    bancaInicialUsd: 1000,
    fracaoPorPosicao: 0.15,
    tetoDeExposicao: 0.45,
    alavancagemMaxima: 1,
    mecanismo:
      "entra quando a base perpétuo-spot passa de um limiar medido e fecha na "
      + "convergência: ganha da distância entre duas pontas do mesmo ativo",
    naoFaz:
      "não pergunta para onde o ativo vai. Pergunta se as duas pontas dele "
      + "estão com preços diferentes demais entre si.",
    receitaVemDe: ["preco"],
    aposentaQuando:
      "a base mediana ficar abaixo do custo das pernas por 30 dias seguidos",
  },
  // ── CATEGORIA TENDÊNCIA — o lado vem do REGIME MEDIDO ───────────────────
  //
  // ⚠️⚠️ ESTA CATEGORIA NASCEU DE UM CADÁVER (22/08). O Maker de Faixa ficou
  // NEGATIVO acertando 65,5%: preço +3,1557 contra taxa −3,3750. O trade médio
  // ganhava $0,1088 e pagava $0,1125 de pedágio — perdia por CONSTRUÇÃO, com
  // alvo de 0,6% contra ida-e-volta de 0,225%.
  //
  // Ele foi APOSENTADO e não ajustado: subir o alvo dele para 1,35% consertaria
  // a aritmética e destruiria a tese, porque uma faixa em que o preço percorre
  // 1,35% para cada lado não é faixa estreita. Ver PLANO-CELEIRO-AMBICIOSO.md.
  {
    id: "cacador_de_tendencia",
    nome: "Caçador de Tendência",
    categoria: "tendencia",
    modalidade: "spot_gate",
    /** entra quando o sinal aparece — esperar o livro perde a tendência. */
    execucao: "taker",
    /**
     * ⚠️ SWING, NÃO DAY — e é a lição do cadáver. O pedágio é proporcional ao
     * nocional, então aumentar a aposta não muda a razão: o que muda é o
     * TAMANHO DO MOVIMENTO por operação. Operação de 2h com alvo de 0,6% morre
     * na corretagem por mais que acerte.
     */
    ritmo: "swing",
    motor: "bot",
    faixa: "trabalho",
    capitalMinimoUsd: 200,
    bancaInicialUsd: 1000,
    /**
     * ⚠️ 25% POR POSIÇÃO É AMBIÇÃO DECLARADA, não descuido. O mandato pede os
     * agentes mais ambiciosos "sem medo de perder capital"; o `tetoDeExposicao`
     * é o "sem suicídio" do lado oposto — no máximo 3 posições vivas.
     */
    fracaoPorPosicao: 0.25,
    tetoDeExposicao: 0.75,
    alavancagemMaxima: 1,
    mecanismo:
      "compra em alta MEDIDA e segura o movimento inteiro, com alvo que limpa o "
      + "pedágio por múltiplo declarado; sai quando o regime deixa de ser alta",
    naoFaz:
      "não PREVÊ direção: o lado vem do regime medido. E não vende — em spot, "
      + "vender na baixa é apenas sair, não é lucrar com a queda. Na baixa e no "
      + "mercado sangrando ele fica de fora.",
    receitaVemDe: ["preco"],
    aposentaQuando:
      "render menos que o Aluguel de Ocioso com 100+ posições fechadas — aí o "
      + "risco de mercado não está comprando nada; OU render menos que o "
      + "Comprador Cego — aí o sinal não sabe direção e só paga corretagem",
  },
  {
    /**
     * ⚠️⚠️ O CONTROLE DE DIREÇÃO — e ele NÃO é o mesmo que o controle de
     * retorno (24/08).
     *
     * O Aluguel de Ocioso responde "valeu a pena arriscar em vez de deixar o
     * USDT rendendo?". Ele não responde "o sinal sabe para que lado o mercado
     * vai?", e essas são perguntas diferentes que estavam sendo confundidas.
     *
     * MEDIDO EM 41 DIAS, ~285 AMOSTRAS POR ATIVO: o filtro de tendência de 20h
     * ganha do "compra às cegas" no BTC (+2,9pp) e no SOL (+4,6pp), e PERDE no
     * ETH (−4,6pp). Efeito médio ≈ zero. O que parecia borda era o mercado, que
     * subiu 22–32% no período.
     *
     * Este agente existe para que essa comparação seja PERMANENTE e automática
     * em vez de um script que alguém rodou uma vez. Um sinal que não bate o
     * escuro não é sinal — é enfeite que paga corretagem.
     */
    id: "comprador_cego",
    nome: "Comprador Cego (controle de direção)",
    categoria: "tendencia",
    modalidade: "spot_gate",
    /** compra a mercado, igual ao Caçador — a única diferença tem de ser o sinal. */
    execucao: "taker",
    ritmo: "swing",
    motor: "bot",
    faixa: "trabalho",
    /**
     * ⚠️ MESMO MÍNIMO DO CAÇADOR, de propósito. A regra do Celeiro diz que só o
     * controle de RETORNO opera sem mínimo — e este aqui não é aquele. Ele é um
     * agente de tendência de verdade, que compra e paga corretagem; dar a ele
     * um piso diferente faria a comparação medir tamanho em vez de sinal.
     */
    capitalMinimoUsd: 200,
    bancaInicialUsd: 1000,
    fracaoPorPosicao: 0.25,
    tetoDeExposicao: 0.75,
    alavancagemMaxima: 1,
    controleDeDirecao: true,
    mecanismo:
      "COMPRA, sempre, sem olhar sinal nenhum — mesma geometria de alvo e stop "
      + "do Caçador de Tendência, mesma corretagem, mesmo tamanho",
    naoFaz:
      "não PREVÊ direção — e não lê sinal nenhum para escolher lado, que é a "
      + "única diferença dele para o Caçador. Em spot ele não vende: sem "
      + "futuros, 'vender na baixa' é apenas sair. Ele não é uma estratégia; é "
      + "a régua contra a qual as direcionais se medem.",
    receitaVemDe: ["preco"],
    aposentaQuando:
      "nunca — controle não se aposenta. Se ele render MAIS que os agentes de "
      + "tendência, quem se aposenta são eles",
  },
  {
    id: "alavancado_de_tendencia",
    nome: "Alavancado de Tendência",
    categoria: "tendencia",
    modalidade: "futuros_gate",
    /** mesmo sinal do Caçador, mesma pressa. */
    execucao: "taker",
    ritmo: "swing",
    motor: "bot",
    faixa: "renda",
    capitalMinimoUsd: 300,
    bancaInicialUsd: 1000,
    fracaoPorPosicao: 0.2,
    tetoDeExposicao: 0.6,
    /**
     * ⚠️⚠️ O TETO É DURO E A CONTA MANDA ABAIXO DELE. `alavancagemCoerente`
     * dimensiona pelo PIOR movimento contra já medido, com folga — este 10 é o
     * limite que ela nunca ultrapassa, por mais calmo que o mercado pareça.
     *
     * "Sem suicídio" precisa de número. Com pior movimento contra de 8% e folga
     * 2×, a conta devolve 6× — não 10, e não 20.
     */
    alavancagemMaxima: 10,
    mecanismo:
      "toma o lado do regime medido no perpétuo — comprado na alta, VENDIDO na "
      + "baixa — com alavancagem dimensionada pela distância da liquidação",
    naoFaz:
      "não PREVÊ direção e não alavanca por apetite. A alavanca sai do pior "
      + "movimento contrário já observado, e pode dar 1× — isso é resultado, "
      + "não falha. Em mercado sangrando não abre nada.",
    receitaVemDe: ["preco"],
    aposentaQuando:
      "uma liquidação apagar o ganho de semanas, ou render menos que o "
      + "Caçador de Tendência sem alavanca — aí a alavanca só comprou risco; "
      + "OU render menos que o Comprador Cego — aí nem o sinal nem a alavanca "
      + "estão comprando alguma coisa",
  },

  // ── CATEGORIA EVENTO — assimetria, perda limitada por construção ─────────
  {
    id: "pool_novo",
    nome: "Pool Novo com Portão de Sobrevivência",
    categoria: "evento",
    modalidade: "dex",
    /** swap em pool: não existe ordem limitada. */
    execucao: "taker",
    ritmo: "day",
    motor: "bot",
    faixa: "semente",
    capitalMinimoUsd: 50,
    bancaInicialUsd: 300,
    /** ⚠️ Aposta pequena de propósito: a assimetria paga a série, não o tamanho. */
    fracaoPorPosicao: 0.1667,
    tetoDeExposicao: 0.5,
    alavancagemMaxima: 1,
    mecanismo:
      "aposta fixa e pequena em pool recém-criado, atrás de portões mecânicos "
      + "de liquidez travada, distribuição de detentores e teste de honeypot",
    naoFaz:
      "não tenta escolher qual pool vai subir. Trata cada tentativa como bilhete "
      + "de perda limitada e deixa a assimetria pagar a série.",
    receitaVemDe: ["preco"],
    aposentaQuando:
      "a munição diária for consumida sem lucro líquido em 60 dias",
  },
] as const;

const POR_ID = new Map(AGENTES.map((a) => [a.id, a]));

export function agentePor(id: string): Agente | null {
  return POR_ID.get(id) ?? null;
}

export function agentesDaFaixa(faixa: Faixa): Agente[] {
  return AGENTES.filter((a) => a.faixa === faixa);
}

/**
 * O agente-controle. Todo ranking o mostra como piso.
 *
 * ⚠️ Lança se não houver exatamente um: um Celeiro sem controle mede retorno
 * contra nada, e foi assim que "+7,04%" virou notícia boa na arena antiga.
 */
export function oControle(): Agente {
  const c = AGENTES.filter((a) => a.controle);
  if (c.length !== 1) {
    throw new Error(`o Celeiro precisa de exatamente 1 controle, achei ${c.length}`);
  }
  return c[0];
}

/** As faixas na ordem em que o painel as mostra. */
export const FAIXAS: readonly Faixa[] = ["semente", "trabalho", "renda"] as const;

export const ROTULO_DA_FAIXA: Record<Faixa, string> = {
  semente:  "Semente — funciona pequeno",
  trabalho: "Trabalho — precisa de livro que aguente",
  renda:    "Renda — lenta e composta",
};

export interface Tamanho {
  /**
   * A MARGEM — o capital da banca comprometido nesta posição.
   *
   * ⚠️ É ELA que o teto de exposição governa, nunca o nocional. Confundir os
   * dois foi o defeito de 23/08: o teto media nocional, então um agente com
   * alavanca declarada de 10× ficava preso abaixo de 0,6× da própria banca.
   */
  margemUsd: number;
  /** O NOCIONAL — o que o preço e a taxa mordem. margem × alavanca. */
  usd: number;
  /** Quantas vezes o nocional excede a margem. 1 = sem alavanca. */
  alavanca: number;
  /** Quanto da banca ficaria comprometido em MARGEM se esta posição abrir (0 a 1). */
  exposicaoDepois: number;
  cabe: boolean;
  porque: string;
}

/**
 * O tamanho da próxima posição — e se ela cabe no teto de exposição.
 *
 * ⚠️⚠️ ISTO SUBSTITUI O `Math.max(capitalMinimoUsd, 50)` QUE VIVIA NO CRON, e o
 * erro que ele escondia: `capitalMinimoUsd` é "quanto preciso para o livro
 * aguentar", NÃO "quanto aposto". Usar um pelo outro fez a Convergência de Base
 * apostar $150 por posição sem ninguém ter decidido isso.
 *
 * ⚠️ E O TETO DE EXPOSIÇÃO É O "SEM SUICÍDIO" DO MANDATO. Sem ele, "ambicioso"
 * vira "alavancado sem perceber": três posições de 25% já são 75% da banca em
 * risco simultâneo. Aqui a recusa é explícita e o motivo vai para o extrato.
 */
export function tamanhoDaPosicao(
  a: Agente,
  /** Margem JÁ comprometida pelas posições abertas — não nocional. */
  expostoMargemUsd: number,
  /**
   * O SALDO REAL do agente — inicial mais tudo que o extrato lançou.
   *
   * ⚠️⚠️ NÃO É `a.bancaInicialUsd`, e a ordem dos parâmetros mudou de propósito
   * para que ninguém passe um pelo outro sem perceber (24/08).
   *
   * Até aqui o tamanho saía da banca INICIAL — um literal que o prejuízo nunca
   * tocava. O Alavancado queimou $53,17 e seguia apostando como se tivesse
   * $1.000 intactos: sem ruína, sem composição, e com `capitalMinimoUsd`
   * comparando contra um número que não se move, logo nunca disparando.
   */
  saldoUsd: number,
  alavanca = 1,
): Tamanho {
  const vezes = Number.isFinite(alavanca) && alavanca >= 1 ? alavanca : 1;
  const saldo = Number.isFinite(saldoUsd) ? saldoUsd : 0;
  const margemUsd = saldo * a.fracaoPorPosicao;
  const usd = margemUsd * vezes;
  const exposicaoDepois = saldo > 0 ? (expostoMargemUsd + margemUsd) / saldo : Infinity;

  /**
   * ⚠️⚠️ A RUÍNA EXISTE AGORA, e ela vem ANTES do teto de exposição.
   *
   * Um agente cujo saldo caiu abaixo do capital que ele declara precisar não
   * "opera menor" — ele PARA. Deixá-lo continuar em tamanho reduzido esconderia
   * a morte dentro de uma sequência de apostas cada vez menores, e o extrato
   * mostraria um agente vivo sangrando devagar em vez de um agente morto.
   */
  if (saldo <= 0) {
    return {
      margemUsd: 0, usd: 0, alavanca: vezes, exposicaoDepois: Infinity, cabe: false,
      porque: `saldo de $${saldo.toFixed(2)} USD — o agente quebrou e não opera mais`,
    };
  }
  if (saldo < a.capitalMinimoUsd) {
    return {
      margemUsd, usd, alavanca: vezes, exposicaoDepois, cabe: false,
      porque: `saldo de $${saldo.toFixed(2)} caiu abaixo do mínimo de `
        + `$${a.capitalMinimoUsd} que este agente declara precisar — parou`,
    };
  }

  if (exposicaoDepois > a.tetoDeExposicao + 1e-9) {
    return {
      margemUsd, usd, alavanca: vezes, exposicaoDepois, cabe: false,
      porque: `${(exposicaoDepois * 100).toFixed(0)}% da banca exposta passaria do teto `
        + `de ${(a.tetoDeExposicao * 100).toFixed(0)}% — a posição não cabe`,
    };
  }
  const fatia = `${(a.fracaoPorPosicao * 100).toFixed(0)}% do saldo de $${saldo.toFixed(2)}`;
  const expo = `exposição em margem ficaria em ${(exposicaoDepois * 100).toFixed(0)}%`;
  return {
    margemUsd, usd, alavanca: vezes, exposicaoDepois, cabe: true,
    porque: vezes > 1
      ? `${margemUsd.toFixed(2)} de margem (${fatia}) × ${vezes}× = `
        + `${usd.toFixed(2)} de nocional, ${expo}`
      : `${usd.toFixed(2)} (${fatia}), ${expo}`,
  };
}
