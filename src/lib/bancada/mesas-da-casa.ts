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
} as const;

export type ChaveDeRessalva = (typeof RESSALVAS)[keyof typeof RESSALVAS];

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

  return {
    ...base, medicao: m,
    liquidoPorOpPct: liquido,
    acertoPct: acerto,
    sustentacao: sustenta ? "sustenta" : "ruido",
    ressalvas,
  };
}
