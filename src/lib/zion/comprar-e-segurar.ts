/**
 * COMPRAR E SEGURAR — a régua que faltava no torneio.
 *
 * ⚠️⚠️ POR QUE ESTA COLUNA EXISTE (20/08).
 *
 * Nos sete dias até 20/08 as carteiras fecharam assim: SKAÐI +$14,92, radar
 * +$14,00, GERI +$13,98, VÖLUNDR +$9,96. A maioria no positivo, com 29, 18, 17
 * e 14 posições fechadas — não era anedota, era dinheiro.
 *
 * No MESMO período: BTC +15,03%, ETH +23,34%, SOL +14,92%.
 *
 * Os mesmos $1.000 parados em BTC teriam dado **+$150**. A melhor mesa fez
 * **+$14,92** — cerca de um DÉCIMO. O painel não tinha como mostrar isso, e sem
 * isso "estamos lucrando" e "estamos lucrando mais do que parados" pareciam a
 * mesma frase.
 *
 * ⚠️ A COMPARAÇÃO É COM OS SÍMBOLOS QUE A PRÓPRIA MESA ESCOLHEU, não com o BTC.
 * Comparar uma mesa de altcoin com "segurar BTC" mistura duas decisões: QUAL
 * ativo e QUANDO entrar. A pergunta honesta isola a segunda — *você escolheu
 * estes ativos; e se tivesse só segurado?* Um resultado ruim aqui não diz "você
 * escolheu mal", diz "sua entrada e saída tiraram valor".
 *
 * ⚠️ E ISTO NÃO É UM VEREDITO SOZINHO. Numa alta, ficar fora do mercado parte do
 * tempo perde para segurar — e é o mesmo comportamento que numa QUEDA protege.
 * A coluna responde "quanto da maré você capturou", não "você presta".
 */

/** O preço de um símbolo nas duas pontas da janela. */
export interface PontaDePreco {
  simbolo: string;
  inicio: number;
  fim: number;
}

export interface Referencia {
  /** Retorno de segurar a cesta, em %. `null` quando não deu para medir. */
  retornoPct: number | null;
  /** Os símbolos que entraram na conta. */
  usados: string[];
  /** Os que ficaram de fora, e o motivo fica visível na tela. */
  ignorados: string[];
  porque: string;
}

/**
 * O retorno de segurar, em partes iguais, os símbolos que a mesa operou.
 *
 * ⚠️ PESO IGUAL, E NÃO PONDERADO PELO QUE A MESA NEGOCIOU. Ponderar pelo volume
 * da mesa embutiria a decisão de alocação dela na própria referência — e a
 * referência viraria um espelho, incapaz de discordar. Peso igual é a alocação
 * mais burra possível, que é exatamente o ponto: é a barra que qualquer um
 * consegue pular sem pensar.
 *
 * ⚠️ SÍMBOLO SEM PREÇO SAI DA CONTA E APARECE EM `ignorados`. Tratá-lo como 0%
 * puxaria a referência para baixo e faria a mesa parecer melhor — um erro de
 * leitura viraria elogio.
 */
export function retornoDeSegurar(pontas: readonly PontaDePreco[]): Referencia {
  const bons: PontaDePreco[] = [];
  const ignorados: string[] = [];

  for (const p of pontas) {
    const ok = Number.isFinite(p.inicio) && p.inicio > 0
            && Number.isFinite(p.fim) && p.fim > 0;
    if (ok) bons.push(p); else ignorados.push(p.simbolo);
  }

  if (bons.length === 0) {
    return {
      retornoPct: null, usados: [], ignorados,
      porque: "nenhum preço legível na janela — sem referência não há comparação",
    };
  }

  const soma = bons.reduce((s, p) => s + (p.fim - p.inicio) / p.inicio * 100, 0);
  const retornoPct = soma / bons.length;

  return {
    retornoPct,
    usados: bons.map((p) => p.simbolo),
    ignorados,
    porque: `segurar ${bons.length} símbolo(s) em partes iguais na mesma janela`
      + (ignorados.length ? ` · ${ignorados.length} fora por falta de preço` : ""),
  };
}

export interface Confronto {
  /** Retorno da mesa, em % do capital inicial. */
  mesaPct: number;
  referenciaPct: number | null;
  /** Positivo = a mesa capturou MAIS que segurar. */
  diferencaPp: number | null;
  /**
   * Que fração da maré a mesa capturou. `1` = empatou com segurar.
   * `null` quando a referência não se mexeu ou não foi medida.
   */
  fatiaDaMare: number | null;
  veredito: string;
}

/**
 * Confronta a mesa com a referência.
 *
 * ⚠️ `fatiaDaMare` NÃO É CALCULADA QUANDO A REFERÊNCIA FICOU PERTO DE ZERO.
 * Dividir por um denominador minúsculo produz números gigantes e sem sentido —
 * "capturou 4.000% da maré" seria lido como façanha quando significa apenas que
 * o mercado andou de lado. Mercado parado é uma janela em que esta pergunta não
 * se aplica, e dizer isso é mais honesto que devolver um número.
 */
export const MARE_MINIMA_PCT = 1;

export function confrontar(
  mesaPct: number,
  ref: Referencia,
  mareMinimaPct: number = MARE_MINIMA_PCT,
): Confronto {
  if (ref.retornoPct === null) {
    return {
      mesaPct, referenciaPct: null, diferencaPp: null, fatiaDaMare: null,
      veredito: "sem referência — " + ref.porque,
    };
  }
  const diferencaPp = mesaPct - ref.retornoPct;
  const mareGrande = Math.abs(ref.retornoPct) >= mareMinimaPct;

  if (!mareGrande) {
    return {
      mesaPct, referenciaPct: ref.retornoPct, diferencaPp, fatiaDaMare: null,
      veredito: `mercado andou ${ref.retornoPct.toFixed(2)}% na janela — de lado `
        + "demais para a pergunta valer",
    };
  }

  const fatiaDaMare = mesaPct / ref.retornoPct;
  const pct = (fatiaDaMare * 100).toFixed(0);

  if (diferencaPp > 0) {
    return {
      mesaPct, referenciaPct: ref.retornoPct, diferencaPp, fatiaDaMare,
      veredito: `bateu segurar por ${diferencaPp.toFixed(2)}pp`,
    };
  }
  return {
    mesaPct, referenciaPct: ref.retornoPct, diferencaPp, fatiaDaMare,
    veredito: `capturou ${pct}% do que segurar daria `
      + `(${ref.retornoPct.toFixed(2)}% na janela)`,
  };
}

/**
 * Lê as duas pontas de preço de um símbolo na Gate.io.
 *
 * ⚠️ Falha devolve as pontas ZERADAS em vez de lançar, e `retornoDeSegurar` as
 * joga em `ignorados`. O símbolo some da conta e aparece na tela como excluído —
 * em vez de derrubar a referência inteira por causa de um ticker ruim.
 */
export async function lerPontas(
  simbolo: string,
  dias: number,
  buscar: (url: string) => Promise<unknown> = padraoBuscar,
): Promise<PontaDePreco> {
  const url = "https://api.gateio.ws/api/v4/spot/candlesticks"
    + `?currency_pair=${simbolo.toUpperCase()}_USDT&interval=1d&limit=${Math.max(2, dias + 1)}`;
  try {
    const corpo = await buscar(url);
    return converterPontas(simbolo, corpo);
  } catch {
    return { simbolo, inicio: 0, fim: 0 };
  }
}

/**
 * Converte a resposta de velas nas duas pontas.
 *
 * ⚠️ O FECHAMENTO É O ÍNDICE 5 na vela da Gate.io, não o 2 nem o 4. Pegar a
 * coluna errada devolveria volume ou máxima com cara de preço — e a referência
 * inteira ficaria errada sem nenhum erro aparecer.
 */
export function converterPontas(simbolo: string, corpo: unknown): PontaDePreco {
  if (!Array.isArray(corpo) || corpo.length < 2) return { simbolo, inicio: 0, fim: 0 };
  const fechamento = (v: unknown) => Number(Array.isArray(v) ? v[5] : Number.NaN);
  const inicio = fechamento(corpo[0]);
  const fim = fechamento(corpo[corpo.length - 1]);
  return {
    simbolo,
    inicio: Number.isFinite(inicio) ? inicio : 0,
    fim: Number.isFinite(fim) ? fim : 0,
  };
}

async function padraoBuscar(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!r.ok) throw new Error(`gate.io respondeu ${r.status}`);
  return r.json();
}
