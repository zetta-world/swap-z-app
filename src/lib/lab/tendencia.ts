/**
 * MOTOR DE TENDÊNCIA DE BAIXA FREQUÊNCIA — deliberadamente burro.
 *
 * ⚠️ A HIPÓTESE QUE ELE TESTA NÃO É "TENDÊNCIA FUNCIONA?" (14/08).
 *
 * Isso já foi medido: `trend_ma50_long_only`, três janelas de 174 dias em
 * 04/08. Mercado a −63% deu **+27,7%**; mercado a +0,1% deu **+18,5%**; queda
 * sem direção matou. É a única estratégia VERDE da família direcional.
 *
 * A pergunta aqui é outra, e sai dos nossos próprios números:
 *
 *     Grade                     bruto  3,39%  ·  custo  54,27%  →  −50,87%
 *     LP em AMM                 bruto  2,53%  ·  custo   0,73%  →   +0,82%
 *     DEX ↔ CEX                 bruto  0,12%  ·  custo   0,10%  →   +0,02%
 *     Biblioteca de playbooks                                    →  −0,610%/trade
 *
 * Filtrar a biblioteca para o melhor terreno leva de −0,610% a −0,440% por
 * trade e custa 41% dos trades: continua negativo. **Não falta borda. A borda é
 * menor que o pedágio.**
 *
 * Então a hipótese é:
 *
 *     > segurar por semanas AMORTIZA o pedágio que matou a alta frequência?
 *
 * Se a resposta for não, o achado vale mais que o motor: quer dizer que o
 * problema não é a estratégia nem a frequência, e sim o NÍVEL de custo com que
 * operamos — e aí a conversa passa a ser sobre corretora e execução, não sobre
 * sinal.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POR QUE OS INDICADORES VÊM PRONTOS NO `DiaMercado`.
 *
 * O walk-forward entrega FATIAS. Uma fatia de teste de 90 dias não tem como
 * calcular uma EMA de 200 — ela nasceria zerada e o motor operaria um
 * indicador que ainda está aquecendo, em toda dobra.
 *
 * Por isso EMA e ATR são calculados UMA VEZ sobre a série inteira e viajam
 * dentro de cada dia. **Isso não é olhar o futuro:** EMA e ATR em D usam
 * exclusivamente dados até D. Pré-computar algo causal e depois fatiar é
 * seguro; o que não seria seguro é normalizar por média da série inteira, ou
 * escolher período de indicador olhando o resultado — e nada disso acontece
 * aqui. Fica escrito porque a construção PARECE vazamento e não é, e uma
 * revisão futura vai olhar para ela com desconfiança justificada.
 */

import { calcEMA, calcATRSerie } from "@/lib/api/market-indicators";
import { CUSTO_POR_PERNA_PCT } from "@/lib/zion/custo";

/** Períodos dos indicadores. Declarados aqui porque são parte da ESTRATÉGIA —
 *  a rota só escolhe janela e símbolos. */
export const EMA_CURTA = 50;
export const EMA_LONGA = 200;
export const ATR_PERIODO = 14;

/** O que o motor sabe de um símbolo num dia. Tudo causal, tudo até `dia`. */
export interface PontoSimbolo {
  alta: number;
  baixa: number;
  fecha: number;
  /** EMA curta (50). `null` durante o aquecimento. */
  emaCurta: number | null;
  /** EMA longa (200). `null` durante o aquecimento. */
  emaLonga: number | null;
  /** ATR de Wilder. `null` durante o aquecimento. */
  atr: number | null;
}

export interface DiaMercado {
  dia: string;
  porSimbolo: Map<string, PontoSimbolo>;
}

export interface ParamsTendencia {
  /** Multiplicador do ATR que define a distância do stop. */
  atrStop: number;
  /** Fração do patrimônio arriscada por trade, em %. É o parâmetro que o
   *  walk-forward escolhe — a escalada 0,5 → 0,75 → 1,0. */
  riscoPct: number;
  /** Pedágio por PERNA, em %. Entrada e saída cobram cada uma. */
  custoPct: number;
}

export const PARAMS_PADRAO: ParamsTendencia = {
  atrStop: 2,
  riscoPct: 0.5,
  // ⚠️ POR PERNA, e este arquivo sempre esteve certo: `rodar()` multiplica por
  // 2 na linha do custo. Passa a ler do primitivo nomeado para que a
  // convenção seja legível no tipo, e não só no comentário lá embaixo.
  custoPct: CUSTO_POR_PERNA_PCT,
};

/**
 * ⚠️ TETO DE PESO POR POSIÇÃO — a trava que impede a alavancagem acidental.
 *
 * O peso sai de `risco ÷ distância do stop`. Num ativo calmo, a distância do
 * stop encolhe e o peso EXPLODE: risco de 0,5% com stop a 0,1% pede 500% do
 * patrimônio numa única posição. A conta está certa e o resultado é ficção —
 * ninguém opera 5× alavancado num backtest sem dizer que está.
 *
 * O teto corta isso em 25% por posição. É convenção, não medição, e por isso
 * está exposto: quem quiser medir com outro teto muda e VÊ que mudou.
 */
export const TETO_PESO_PCT = 25;

/**
 * ⚠️ TETO DE EXPOSIÇÃO SOMADA. Sem ele, dez sinais simultâneos colocariam 250%
 * do patrimônio na rua. Quando o teto é alcançado, os sinais seguintes do dia
 * são IGNORADOS — não redimensionados. Redimensionar mudaria a estratégia em
 * silêncio (todo mundo ficaria menor num dia de muitos sinais), e o que se quer
 * medir é a regra, não a adaptação dela ao teto.
 */
export const TETO_EXPOSICAO_PCT = 100;

export interface TradeTendencia {
  simbolo: string;
  diaEntrada: string;
  diaSaida: string | null;
  precoEntrada: number;
  precoSaida: number;
  motivo: "stop" | "cruzamento" | "fim_da_janela";
  /** Quanto do patrimônio a posição tomou, em %. */
  pesoPct: number;
  /** Variação do PREÇO, em %, sem custo. */
  brutoPct: number;
  /** Pedágio das duas pernas, em % do patrimônio. */
  custoPct: number;
  /** Contribuição LÍQUIDA ao patrimônio, em %. */
  liquidoPct: number;
}

export interface ResultadoTendencia {
  trades: TradeTendencia[];
  /** Retorno do período, composto, em %. */
  retornoPct: number;
  /** O mesmo sem pedágio — existe só para a comparação com o líquido. */
  brutoPct: number;
  /** Pedágio total pago, em % do patrimônio inicial. */
  custoPct: number;
  /** Maior queda da curva, em % (magnitude positiva). */
  tomboMaxPct: number;
  /** Fração dos dias com ao menos uma posição aberta, em %. */
  exposicaoPct: number;
  /** Curva de capital, base 100, um ponto por dia. */
  curva: number[];
  /** Trades fechados no lucro ÷ trades fechados. `null` sem trade. */
  acertoPct: number | null;
}

interface Aberta {
  simbolo: string;
  diaEntrada: string;
  precoEntrada: number;
  stop: number;
  pesoPct: number;
}

/**
 * Roda o motor sobre uma sequência de dias.
 *
 * ⚠️ O SINAL DE HOJE ENTRA AMANHÃ. A decisão é tomada no FECHAMENTO de D e
 * executada no FECHAMENTO de D+1. Usar o mesmo fechamento que gerou o sinal é o
 * lookahead clássico — a mesma regra que `rodarRotacao` já segue, escrita lá
 * como "o sinal de hoje vale para o período seguinte, nunca para o próprio".
 *
 * ⚠️ E O STOP É CHECADO ANTES DA SAÍDA POR CRUZAMENTO. Se no mesmo dia a mínima
 * furou o stop E as médias cruzaram, registra-se o STOP. É o pessimismo
 * primeiro que o resto do laboratório usa: vela que toca os dois lados conta o
 * lado ruim, porque a vela diária não mostra a ORDEM em que os dois
 * aconteceram, e supor a ordem favorável é escolher o resultado.
 */
export function rodarTendencia(
  dias: readonly DiaMercado[],
  params: ParamsTendencia = PARAMS_PADRAO,
): ResultadoTendencia {
  const vazio: ResultadoTendencia = {
    trades: [], retornoPct: 0, brutoPct: 0, custoPct: 0,
    tomboMaxPct: 0, exposicaoPct: 0, curva: [], acertoPct: null,
  };
  if (dias.length < 2) return vazio;

  const abertas = new Map<string, Aberta>();
  const trades: TradeTendencia[] = [];
  const curva: number[] = [];
  let capital = 100;
  let pico = 100;
  let tombo = 0;
  let diasComPosicao = 0;

  /** Fecha uma posição e credita o resultado líquido no capital. */
  const fechar = (a: Aberta, dia: string, preco: number, motivo: TradeTendencia["motivo"]) => {
    const bruto = ((preco - a.precoEntrada) / a.precoEntrada) * 100;
    const custo = a.pesoPct * (params.custoPct / 100) * 2;   // entrada + saída
    const liquido = (a.pesoPct * bruto) / 100 - custo;
    capital *= 1 + liquido / 100;
    trades.push({
      simbolo: a.simbolo, diaEntrada: a.diaEntrada, diaSaida: dia,
      precoEntrada: a.precoEntrada, precoSaida: preco, motivo,
      pesoPct: a.pesoPct, brutoPct: bruto, custoPct: custo, liquidoPct: liquido,
    });
    abertas.delete(a.simbolo);
  };

  // Começa em 1: o dia 0 só produz sinal, nunca execução (ver o aviso acima).
  for (let i = 1; i < dias.length; i++) {
    const hoje = dias[i];
    const ontem = dias[i - 1];

    // ── 1. SAÍDAS, antes de qualquer entrada.
    for (const a of [...abertas.values()]) {
      const p = hoje.porSimbolo.get(a.simbolo);
      if (!p) continue;                       // símbolo sumiu da fonte: segura
      if (p.baixa <= a.stop) { fechar(a, hoje.dia, a.stop, "stop"); continue; }
      const o = ontem.porSimbolo.get(a.simbolo);
      if (o?.emaCurta != null && o.emaLonga != null && o.emaCurta < o.emaLonga) {
        fechar(a, hoje.dia, p.fecha, "cruzamento");
      }
    }

    // ── 2. ENTRADAS, pelo sinal de ONTEM.
    let exposicao = [...abertas.values()].reduce((s, a) => s + a.pesoPct, 0);
    for (const [simbolo, o] of ontem.porSimbolo) {
      if (abertas.has(simbolo)) continue;
      if (o.emaCurta == null || o.emaLonga == null || o.atr == null) continue;
      if (!(o.emaCurta > o.emaLonga && o.fecha > o.emaCurta)) continue;

      const p = hoje.porSimbolo.get(simbolo);
      if (!p || !(p.fecha > 0)) continue;

      const distancia = params.atrStop * o.atr;
      const distanciaPct = (distancia / p.fecha) * 100;
      if (!(distanciaPct > 0)) continue;      // ATR degenerado: não opera

      const peso = Math.min(params.riscoPct / (distanciaPct / 100), TETO_PESO_PCT);
      if (!(peso > 0)) continue;
      if (exposicao + peso > TETO_EXPOSICAO_PCT) continue;   // ignora, não encolhe

      abertas.set(simbolo, {
        simbolo, diaEntrada: hoje.dia, precoEntrada: p.fecha,
        stop: p.fecha - distancia, pesoPct: peso,
      });
      exposicao += peso;
    }

    // ── 3. MARCA O DIA.
    if (abertas.size > 0) diasComPosicao++;
    curva.push(capital);
    if (capital > pico) pico = capital;
    const queda = ((pico - capital) / pico) * 100;
    if (queda > tombo) tombo = queda;
  }

  // O que sobrou aberto fecha no último preço conhecido — e o motivo diz isso.
  // Deixar posição aberta fora da conta esconderia perda não realizada; fingir
  // que ela fechou no stop inventaria uma saída que não houve.
  const ultimo = dias[dias.length - 1];
  for (const a of [...abertas.values()]) {
    const p = ultimo.porSimbolo.get(a.simbolo);
    if (p) fechar(a, ultimo.dia, p.fecha, "fim_da_janela");
  }
  if (curva.length > 0) curva[curva.length - 1] = capital;

  const custoTotal = trades.reduce((s, t) => s + t.custoPct, 0);
  const fechados = trades.length;
  return {
    trades,
    retornoPct: capital - 100,
    // Bruto = o mesmo caminho sem pedágio. Não é `retorno + custo`: o custo
    // sai a cada trade e o que vem depois compõe sobre um capital menor.
    brutoPct: (trades.reduce((f, t) => f * (1 + (t.pesoPct * t.brutoPct) / 10_000), 1) - 1) * 100,
    custoPct: custoTotal,
    tomboMaxPct: tombo,
    exposicaoPct: ((diasComPosicao / (dias.length - 1)) * 100),
    curva,
    acertoPct: fechados > 0 ? (trades.filter((t) => t.liquidoPct > 0).length / fechados) * 100 : null,
  };
}

/**
 * A escolha de parâmetro para o walk-forward: a escalada de risco que a
 * auditoria externa propôs — 0,5% → 0,75% → 1,0%.
 *
 * ⚠️ ESCOLHE PELA RAZÃO RETORNO/TOMBO, NÃO PELO RETORNO. Escolher pelo retorno
 * elegeria sempre o maior risco, porque risco maior multiplica o resultado no
 * treino — e o treino é justamente onde o número é otimista. A razão é o que a
 * Fase 2 deste plano existe para introduzir, e é o critério certo aqui: um
 * ganho que só aparece dobrando a exposição não é uma descoberta sobre a regra.
 *
 * ⚠️ EMPATE VAI PARA O MENOR RISCO. Sem regra de desempate a escolha fica na
 * ordem do array, que é arbitrária e invisível.
 */
export const RISCOS_CANDIDATOS = [0.5, 0.75, 1.0] as const;

export function escolherRisco(
  treino: readonly DiaMercado[],
  base: ParamsTendencia = PARAMS_PADRAO,
): { params: ParamsTendencia; resultadoPct: number } {
  let melhor: { params: ParamsTendencia; resultadoPct: number; razao: number } | null = null;

  for (const riscoPct of RISCOS_CANDIDATOS) {
    const params = { ...base, riscoPct };
    const r = rodarTendencia(treino, params);
    // Sem tombo observado a razão é indefinida; usa o retorno como desempate
    // fraco, mas nunca deixa isso ganhar de uma razão de verdade.
    const razao = r.tomboMaxPct > 0 ? r.retornoPct / r.tomboMaxPct : -Infinity;
    if (melhor === null || razao > melhor.razao) {
      melhor = { params, resultadoPct: r.retornoPct, razao };
    }
  }
  // `RISCOS_CANDIDATOS` nunca é vazio, mas o compilador não sabe.
  return melhor ?? { params: base, resultadoPct: 0 };
}

/** Vela crua vinda da fonte — o mínimo que o motor precisa. */
export interface VelaBruta {
  dia: string;
  alta: number;
  baixa: number;
  fecha: number;
}

/**
 * Monta a série de dias com os indicadores JÁ CALCULADOS.
 *
 * ⚠️ PRÉ-COMPUTAR E DEPOIS FATIAR NÃO É OLHAR O FUTURO. EMA e ATR em D usam
 * exclusivamente dados até D — são causais. O que seria vazamento é normalizar
 * pela média da série inteira, ou escolher o período do indicador olhando o
 * resultado; nada disso acontece. Está escrito porque a construção PARECE
 * vazamento, e uma revisão futura vai olhar para ela com desconfiança
 * justificada.
 *
 * ⚠️ O CALENDÁRIO É A UNIÃO, e cada símbolo entra só nos dias que tem. Um
 * símbolo listado depois (ARB, OP) não existe no começo da janela, e forçar a
 * interseção jogaria fora anos de BTC para acomodar quem nasceu ontem.
 */
export function montarSerie(porSimbolo: Map<string, ReadonlyArray<VelaBruta>>): DiaMercado[] {
  const pontos = new Map<string, Map<string, PontoSimbolo>>();

  for (const [simbolo, velas] of porSimbolo) {
    if (velas.length < EMA_LONGA + ATR_PERIODO) continue;   // nem aquece: fica fora
    const fechos = velas.map((v) => v.fecha);
    const curta = calcEMA(fechos, EMA_CURTA);
    const longa = calcEMA(fechos, EMA_LONGA);
    const atr = calcATRSerie(
      velas.map((v) => ({ high: v.alta, low: v.baixa, close: v.fecha, volume: 0 })),
      ATR_PERIODO,
    );
    for (let i = 0; i < velas.length; i++) {
      const v = velas[i];
      const mapa = pontos.get(v.dia) ?? new Map<string, PontoSimbolo>();
      /**
       * ⚠️⚠️ `calcEMA` NÃO DEVOLVE UMA SÉRIE ALINHADA ÀS VELAS — e a primeira
       * versão disto indexava por `i` direto (14/08).
       *
       * Ela devolve `n − período + 1` valores, e `out[0]` descreve a vela de
       * índice `período − 1` (a semente é a média das primeiras `período`).
       * Logo:
       *
       *     out[j]  ↔  vela[j + período − 1]
       *     vela[i] ↔  out[i − período + 1]
       *
       * Com `curta[i]`, a EMA de 200 saía `undefined` para toda vela a partir
       * da 201 (o array só tem 201 posições numa série de 400) e virava `null`
       * — o motor nunca entraria. E **não haveria erro**: a medição rodaria,
       * gravaria "0 trades" e o veredito sairia como notícia sobre o mercado.
       *
       * Erro de alinhamento não produz exceção, produz RESULTADO. É a pior
       * forma de errar num laboratório, e foi um teste de RELAÇÃO
       * ("em série que só sobe, a curta fica acima da longa") que pegou —
       * nenhum teste de "roda sem quebrar" veria isso.
       */
      const jCurta = i - EMA_CURTA + 1;
      const jLonga = i - EMA_LONGA + 1;
      mapa.set(simbolo, {
        alta: v.alta, baixa: v.baixa, fecha: v.fecha,
        emaCurta: jCurta >= 0 && Number.isFinite(curta[jCurta]) ? curta[jCurta] : null,
        emaLonga: jLonga >= 0 && Number.isFinite(longa[jLonga]) ? longa[jLonga] : null,
        atr: atr[i] ?? null,
      });
      pontos.set(v.dia, mapa);
    }
  }

  return [...pontos.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([dia, porSim]) => ({ dia, porSimbolo: porSim }));
}
