/**
 * O CELEIRO — o registro dos agentes da segunda arena.
 *
 * Ver `docs/PLANO-O-CELEIRO.md`. Este arquivo é a fonte única de quem existe,
 * o que cada um faz, e — o campo que o registro antigo não tinha — o que cada
 * um NÃO faz.
 *
 * ⚠️⚠️ POR QUE NENHUM AGENTE APOSTA EM DIREÇÃO (P1).
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

export type Categoria = "renda" | "estrutura" | "evento";

export interface Agente {
  id: string;
  /** Descritivo, nunca mitológico — §3 do plano. O nome DIZ o que ele faz. */
  nome: string;
  categoria: Categoria;
  modalidade: Modalidade;
  ritmo: Ritmo;
  motor: Motor;
  faixa: Faixa;
  /** Abaixo disto o agente não compete: a profundidade muda o retorno (1.3). */
  capitalMinimoUsd: number;
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
    ritmo: "continuo",
    motor: "bot",
    faixa: "renda",
    capitalMinimoUsd: 0,
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
    ritmo: "day",
    motor: "bot",
    faixa: "trabalho",
    capitalMinimoUsd: 150,
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
  {
    id: "maker_de_faixa",
    nome: "Maker de Faixa",
    categoria: "estrutura",
    modalidade: "spot_gate",
    ritmo: "day",
    /**
     * ⚠️ A IA AQUI ESCOLHE ONDE, NUNCA PARA ONDE. Ela lê qual par tem estrutura
     * de faixa e livro que aguenta o tamanho. Se algum dia esta linha virar
     * "a IA diz se sobe", o agente passou a ser o que 1.1 reprovou.
     */
    motor: "bot_mais_ia",
    faixa: "semente",
    capitalMinimoUsd: 50,
    mecanismo:
      "cota os dois lados do livro em par aprovado por teste estatístico de "
      + "lateralidade, com tamanho amarrado à profundidade real: ganha o spread",
    naoFaz:
      "não persegue rompimento e não escolhe lado. Se o par sair da faixa "
      + "medida ele PARA de cotar, em vez de virar direcional.",
    receitaVemDe: ["preco"],
    aposentaQuando:
      "o spread capturado mediano ficar abaixo da taxa paga por 30 dias",
  },

  // ── CATEGORIA EVENTO — assimetria, perda limitada por construção ─────────
  {
    id: "pool_novo",
    nome: "Pool Novo com Portão de Sobrevivência",
    categoria: "evento",
    modalidade: "dex",
    ritmo: "day",
    motor: "bot",
    faixa: "semente",
    capitalMinimoUsd: 50,
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
