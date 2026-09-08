/**
 * AS MESAS DO TORNEIO NA BANCADA DO CLIENTE — vitrine, não clone.
 *
 * ⚠️⚠️ POR QUE ELAS NÃO SÃO CLONÁVEIS (06/09). O dono pediu para trazer os
 * agentes do torneio para a bancada, e ele está certo: eles são o que a casa de
 * fato roda. Ao ler o código, eles **não cabem no vocabulário do cliente**, e
 * não por detalhe:
 *
 *   · alvo e stop NÃO são percentuais fixos. Saem da volatilidade —
 *     `stopFloorPct = max(ATR% × 1,5, piso)` e o alvo é limitado a
 *     `ATR% × √horas × 2,0` (`zion/bracket.ts`), por símbolo e por momento,
 *     mais um piso de RR de 1,8;
 *   · a entrada NÃO é "média/canal/RSI". É um seletor entre **10 playbooks
 *     escolhidos por regime de mercado** (`zion/playbooks.ts`), cada um lendo
 *     estrutura de preço: suporte testado, recuo até a EMA, pivô S1/S2, OBV.
 *
 * O formulário do cliente aceita `media | canal | rsi` com alvo e stop em %
 * fixo. ⚠️ Aproximar uma mesa nisso e pôr o nome dela em cima seria o cliente
 * rodando uma coisa achando que é outra, com a nossa marca — e os números que
 * justificam a mesa vieram da regra REAL, não da aproximação.
 *
 * Então elas entram como VITRINE: o que a mesa é, o que ela testa, e o que ela
 * de fato mediu. O botão de clonar vem quando o vocabulário souber expressar
 * bracket por volatilidade e os playbooks — fase própria, não remendo.
 */

import { DESKS, type Desk } from "@/lib/zion/desks";

/**
 * ⚠️⚠️ SÓ MESA MECÂNICA E VIVA. Duas exclusões, cada uma com motivo medido:
 *
 *   · `brain !== "none"` fica FORA. O repositório mediu 3.300 decisões e achou
 *     que LLM PREVENDO direção fica de −6,7 a −30,4 pontos ABAIXO do passeio
 *     aleatório. Oferecer uma dessas a um cliente seria vender o que a própria
 *     casa aposentou — e os números confirmam: `grok_scan` −0,99%/op,
 *     `kimi_scan` −1,22%/op, `self_scan` −1,13%/op, líquidos de custo.
 *   · `status !== "live"` fica FORA. Mesa arquivada é história nossa, não
 *     produto — e o Valhalla existe para guardar quem tombou.
 */
export function mesasElegiveis(): Desk[] {
  return DESKS.filter((d) => d.brain === "none" && d.status === "live");
}

/**
 * ⚠️⚠️ QUAIS MESAS O BOTÃO "RODAR ESTA" PODE DE FATO RODAR — e a lista é curta
 * porque a verdade é curta.
 *
 * ACHADO NO BANCO (07/09). O dono clicou em ULLR e depois em FREYJA, sobre BTC
 * e 365 dias, e as duas devolveram `+2,140788280112371%` — o MESMO número, até
 * a última casa decimal, com uma operação cada. Não é coincidência: `rodarMesa`
 * (`mesa-real.ts`) NÃO recebe a mesa. Ela roda um único caminho — o cardápio de
 * `candidateAttempts` com a política "primeiro playbook com plano" — e o nome
 * da mesa era só o rótulo colado em cima do resultado.
 *
 * ⚠️ E as dez mesas de `mesasElegiveis` NÃO fazem isso. As quatro de arbitragem
 * (Setor B) não tomam trade direcional nenhum: vivem de spread e funding, em
 * outro livro. A URÐR ordena os candidatos pelo histórico medido e VETA os que
 * mediram negativo naquele regime. A SKAÐI aplica o filtro de clima e revalida
 * a geometria no prazo curto. A HEIMDALL é um scanner de evento. E a ULLR caça
 * pool RECÉM-NASCIDA (2 a 48h de vida, TVL ≥ US$ 80 mil) com bracket fixo de
 * 18%/9% — ela nem olha BTC.
 *
 * Rodar qualquer uma delas por aqui não é uma aproximação da mesa: é a FREYJA
 * com outro nome na etiqueta. É exatamente o que o cabeçalho deste arquivo diz
 * que não se faz — *"o cliente rodando uma coisa achando que é outra, com a
 * nossa marca"* — e entrou pela porta do botão, três dias depois de escrito.
 *
 * ⚠️ ELAS CONTINUAM NA VITRINE. O card, a medição e as ressalvas são honestos e
 * são o produto: o que sai é a promessa de reproduzir o que não reproduzimos.
 * Quando `mesa-real.ts` souber a política de cada mesa, cada uma volta — uma a
 * uma, com o teste que prova que a política mudou o resultado.
 */
export const MESAS_QUE_A_RODADA_REPRODUZ = [
  // VÖLUNDR — o controle: `selectPlaybook`, sem filtro de clima, sem histórico.
  // É literalmente a política que `mesa-real.ts` implementa.
  "strat_mech",
  // FREYJA — a MESMA seleção, na DEX. A pergunta dela é "a mesma regra paga na
  // DEX como na CEX?", e aqui quem escolhe a praça é o cliente — então as duas
  // devolvem o mesmo número quando ele escolhe a mesma praça. Isso é verdade
  // sobre as mesas, não defeito da conta, e a ressalva `mesmoSeletor` diz isso.
  "strat_dex",
] as const;

export function mesaPodeRodar(source: string): boolean {
  return (MESAS_QUE_A_RODADA_REPRODUZ as readonly string[]).includes(source);
}

/** O que a medição do banco devolve por mesa. */
export interface MedicaoDaMesa {
  source: string;
  /** ⚠️ `hit_target + hit_stop`. Expirada NÃO conta — cicatriz do flywheel. */
  decididos: number;
  alvo: number;
  stop: number;
  /** Contadas à parte, e MOSTRADAS: uma mesa que expira mais do que decide é
   *  outra coisa que uma que resolve, e o cliente precisa ver isso. */
  expiradas: number;
  /** Média de `outcome_pct` nas decididas — BRUTA, sem custo. */
  brutoPorOpPct: number;
  simbolos: number;
  dias: number;
  primeiroDia: string;
  ultimoDia: string;
}

/**
 * ⚠️ O CUSTO DESCONTADO É O DA PRAÇA DA MESA, não um número único.
 *
 * Foi uma taxa única aplicada a todo mundo que aposentou o Maker de Faixa por
 * engano. `venue` da mesa decide: DEX paga 0,30%/perna, CEX spot taker 0,20%.
 */
export function custoIdaEVoltaDaMesa(venue: Desk["venue"]): number {
  return venue === "dex" ? 0.60 : 0.40;
}

export type Sustentacao = "sustenta" | "ruido";

export interface CartaoDaMesa {
  source: string;
  nome: string;
  sigilo: string;
  subtitulo: string;
  /** A pergunta que a mesa existe para responder. */
  testa: string;
  venue: Desk["venue"];
  direcao: Desk["direction"];
  horizonteHoras: number | null;
  medicao: MedicaoDaMesa | null;
  /** Líquido por operação, já descontado o custo da praça. `null` sem medição. */
  liquidoPorOpPct: number | null;
  acertoPct: number | null;
  /** ⚠️ `ruido` abaixo do limiar: o número aparece SEM cor de veredito. */
  sustentacao: Sustentacao;
  /** As chaves de ressalva que a tela precisa mostrar junto do número. */
  ressalvas: ChaveDeRessalva[];
  /**
   * ⚠️ Se o botão "rodar esta" aparece. Ver `MESAS_QUE_A_RODADA_REPRODUZ`: um
   * botão que roda outra coisa é pior que botão nenhum.
   */
  podeRodar: boolean;
}

/**
 * ⚠️⚠️ AS RESSALVAS VIAJAM COM O NÚMERO, SEMPRE — decisão do dono (06/09),
 * perguntado explicitamente.
 *
 * É isto que separa a bancada de um backtester que vende esperança: publicar
 * "+4,54% por operação" sozinho é propaganda; publicá-lo com o que ele NÃO
 * prova é medição.
 */
export const RESSALVAS = {
  /** Expectância por operação não é retorno de conta. */
  porOperacao: "bancada.ressalvaPorOperacao",
  /** Símbolos que andam juntos: n independente << n. */
  correlacao: "bancada.ressalvaCorrelacao",
  /** Uma janela, um regime de mercado. */
  umRegime: "bancada.ressalvaUmRegime",
  /** Mais expirações do que decisões. */
  expiraMuito: "bancada.ressalvaExpiraMuito",
  /** Amostra abaixo do limiar. */
  amostraCurta: "bancada.ressalvaAmostraCurta",
  /**
   * ⚠️ As duas mesas rodáveis partilham UM seletor — ver
   * `MESAS_QUE_A_RODADA_REPRODUZ`. Sem esta linha, dois cards devolvendo o
   * mesmo número parecem defeito de conta em vez do que são: a mesma regra,
   * medida em praças diferentes, com a praça escolhida pelo cliente.
   */
  mesmoSeletor: "bancada.ressalvaMesmoSeletor",
} as const;

export type ChaveDeRessalva = (typeof RESSALVAS)[keyof typeof RESSALVAS];

/**
 * ⚠️⚠️ AS RESSALVAS QUE VALEM PARA **TODOS** OS CARDS — para a tela dizê-las UMA
 * vez, no rodapé da seção, em vez de dez.
 *
 * O DEFEITO (07/09, medido numa auditoria): `montarCartao` empurra
 * `porOperacao` incondicionalmente, `correlacao` com mais de um símbolo,
 * `umRegime` abaixo de 90 dias e `amostraCurta` abaixo de 100 decididas. Como
 * as mesas da casa medem vários símbolos em janelas curtas, as quatro disparam
 * juntas em quase todo card — 40 elementos de lista tirados de 4 frases, 4.000
 * caracteres de texto idêntico numa rolagem de celular.
 *
 * E a repetição NÃO protege. O investidor lê o bloco no primeiro card,
 * reconhece o formato no segundo, e a partir do terceiro os olhos pulam a borda
 * cinza inteira — inclusive nos cards em que a ressalva MUDA (`expiraMuito` só
 * aparece na SKAÐI; `mesmoSeletor` só nas duas rodáveis). Ela treina o leitor a
 * não ver justamente a linha que era diferente e importava.
 *
 * ⚠️ MAS NADA SOME. A regra é a INTERSEÇÃO, calculada sobre os cards que a tela
 * de fato mostra: o que vale para todos vira nota da seção; o que distingue um
 * card continua NELE. Uma ressalva nova, ou um card que fuja do padrão, muda o
 * corte sozinho — não há lista fixa a envelhecer.
 */
export function ressalvasComuns(cartoes: ReadonlyArray<CartaoDaMesa>): ChaveDeRessalva[] {
  const comRessalva = cartoes.filter((c) => c.ressalvas.length > 0);
  // ⚠️ Menos de dois cards não tem interseção que valha: com um card só, mover
  // a ressalva para o rodapé só a afasta do número que ela qualifica.
  if (comRessalva.length < 2) return [];
  const [primeiro, ...resto] = comRessalva;
  return primeiro.ressalvas.filter((r) => resto.every((c) => c.ressalvas.includes(r)));
}

/**
 * ⚠️⚠️ A VITRINE, ORDENADA — as que pagam na frente, o resto RECOLHIDO (07/09).
 *
 * O DONO PEDIU: *"vamos deixar só mesas e agentes que estão verdes, nada
 * vermelho ou cinza"*. O pedido por trás é legítimo — a tela virava um cemitério
 * de números vermelhos, e ninguém quer isso como primeira impressão do produto.
 *
 * ⚠️ MAS FILTRAR PELO RESULTADO É A ARMADILHA QUE ESTA BASE JÁ NOMEOU. A nota
 * de `/api/bancada/mesas-da-casa` diz, sobre a janela de UMA mesa: *"incluir o
 * passado ruim é o que impede a vitrine de escolher a própria sorte"*. Deixar
 * só as verdes faz o mesmo um nível acima: em vez de escolher a boa JANELA de
 * uma mesa, escolhe as boas MESAS. O investidor veria cinco vencedoras e nunca
 * saberia que houve cinco perdedoras — que é a definição de viés de
 * sobrevivência, e ele está pagando para decidir com esses números.
 *
 * ⚠️ ENTÃO A SEPARAÇÃO É VISUAL, NUNCA UMA EXCLUSÃO. As que pagam vêm na
 * frente; as outras ficam recolhidas atrás de um botão que MOSTRA A CONTAGEM,
 * inclusive quantas são negativas. A tela fica limpa e ninguém perde a
 * informação de que elas existem. Esconder o número é a mentira; recolher
 * dizendo quantas são, não é.
 */
export interface VitrineOrdenada {
  /** Positivas E com amostra que sustenta. Vêm abertas, melhor primeiro. */
  verdes: CartaoDaMesa[];
  /** Negativas ou sem amostra. Recolhidas — nunca removidas. */
  oResto: CartaoDaMesa[];
  /** ⚠️ Quantas do resto de fato PERDERAM. Este número tem de aparecer. */
  quantasNegativas: number;
  /** Quantas não sustentam veredito (amostra curta). Também aparece. */
  quantasSemAmostra: number;
}

export function ordenarVitrine(cartoes: ReadonlyArray<CartaoDaMesa>): VitrineOrdenada {
  const verdes: CartaoDaMesa[] = [];
  const oResto: CartaoDaMesa[] = [];
  let quantasNegativas = 0;
  let quantasSemAmostra = 0;

  for (const c of cartoes) {
    const sustenta = c.sustentacao === "sustenta";
    const paga = c.liquidoPorOpPct != null && c.liquidoPorOpPct > 0;
    // ⚠️ AS DUAS CONDIÇÕES, não só o sinal: um +12% de nove operações não é uma
    // mesa que paga, é ruído com sorte — e promovê-lo à vitrine seria repetir
    // o painel do Valhalla, que exibia +1,19% de UMA operação ao lado de uma
    // média de 268.
    if (paga && sustenta) { verdes.push(c); continue; }
    oResto.push(c);
    if (c.liquidoPorOpPct != null && c.liquidoPorOpPct < 0) quantasNegativas++;
    if (!sustenta) quantasSemAmostra++;
  }

  // ⚠️ Melhor primeiro DENTRO de cada grupo. `null` (sem medida) vai ao fim:
  // ausência de número nunca ganha de um número ruim.
  const porResultado = (a: CartaoDaMesa, b: CartaoDaMesa) =>
    (b.liquidoPorOpPct ?? -Infinity) - (a.liquidoPorOpPct ?? -Infinity);

  return {
    verdes: [...verdes].sort(porResultado),
    oResto: [...oResto].sort(porResultado),
    quantasNegativas, quantasSemAmostra,
  };
}

/** O que sobra num card depois de a seção já ter dito o que é comum a todos. */
export function ressalvasSoDeste(
  cartao: CartaoDaMesa, comuns: ReadonlyArray<ChaveDeRessalva>,
): ChaveDeRessalva[] {
  return cartao.ressalvas.filter((r) => !comuns.includes(r));
}

/** Abaixo disto o número não sustenta veredito — o mesmo 100 do torneio. */
export const DECIDIDOS_PARA_SUSTENTAR = 100;

/**
 * ⚠️ QUANDO A EXPIRAÇÃO PASSA A SER PARTE DA HISTÓRIA. A SKAÐI tem 185
 * expiradas contra 128 decididas: mais da metade dos sinais dela morre de
 * relógio, não de tese. Um cliente que lê só "acertou 49%" não sabe disso.
 */
export const EXPIRA_DEMAIS = 1.0;

/**
 * ⚠️⚠️ MESA SEM LINHA MEDIDA NÃO VIRA CARD — e isso não é esconder, é não mentir.
 *
 * Dez mesas passam em `mesasElegiveis`, mas as quatro de ARBITRAGEM
 * (RATATOSKR, JÖRMUNGANDR, NÍÐHÖGGR, FÁFNIR) não produzem sugestão: elas são
 * julgadas na carteira de USDT, noutro livro. Um card delas dizendo "ainda sem
 * operação decidida" afirmaria que não foram MEDIDAS, quando o certo é que são
 * medidas EM OUTRO LUGAR — e a arbitragem está morta desde 03/08, o que
 * tornaria o card duplamente errado.
 *
 * A vitrine é "as mesas que medimos ASSIM", não "todas as mesas".
 */
export function mereceCartao(m: MedicaoDaMesa | null | undefined): boolean {
  return !!m && (m.decididos > 0 || m.expiradas > 0);
}

export function montarCartao(d: Desk, m: MedicaoDaMesa | null): CartaoDaMesa {
  const base = {
    source: d.source, nome: d.name, sigilo: d.sigil, subtitulo: d.subtitle,
    testa: d.tests, venue: d.venue, direcao: d.direction, horizonteHoras: d.horizonHours,
    podeRodar: mesaPodeRodar(d.source),
  };
  if (!m || m.decididos === 0) {
    return { ...base, medicao: m, liquidoPorOpPct: null, acertoPct: null, sustentacao: "ruido", ressalvas: [] };
  }

  const liquido = m.brutoPorOpPct - custoIdaEVoltaDaMesa(d.venue);
  const acerto = (m.alvo / m.decididos) * 100;
  const sustenta = m.decididos >= DECIDIDOS_PARA_SUSTENTAR;

  const ressalvas: ChaveDeRessalva[] = [RESSALVAS.porOperacao];
  // ⚠️ Mais de um símbolo já basta: cripto major anda junto, e o `n` efetivo
  // cai muito abaixo do `n` contado (ver `effectiveSampleSize` em benchmarks).
  if (m.simbolos > 1) ressalvas.push(RESSALVAS.correlacao);
  // Uma janela curta é um regime só, por mais operações que ela tenha.
  if (m.dias <= 90) ressalvas.push(RESSALVAS.umRegime);
  if (m.expiradas >= m.decididos * EXPIRA_DEMAIS) ressalvas.push(RESSALVAS.expiraMuito);
  if (!sustenta) ressalvas.push(RESSALVAS.amostraCurta);
  // ⚠️ Só nas rodáveis: nas outras a frase não teria a que se referir, e
  // ressalva sem referente é ruído que ensina a ignorar as que importam.
  if (base.podeRodar) ressalvas.push(RESSALVAS.mesmoSeletor);

  return {
    ...base, medicao: m,
    liquidoPorOpPct: liquido,
    acertoPct: acerto,
    sustentacao: sustenta ? "sustenta" : "ruido",
    ressalvas,
  };
}
