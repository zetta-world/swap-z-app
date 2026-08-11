/**
 * DUAS MESAS MECÂNICAS SOBRE PREÇO — C9 (rotação por momento) e C10 (grade).
 *
 * ⚠️ POR QUE AS DUAS NO MESMO MÓDULO: elas compartilham a régua (fechamento
 * diário), o competidor (comprar e segurar os MESMOS ativos na MESMA janela) e
 * o modelo de custo. Separá-las duplicaria as três coisas, e duplicação de
 * CONTA é o que a invariante nº 7 do laboratório proíbe. O que NÃO se mistura é
 * o registro: cada uma tem slug, capital e rodada próprios.
 *
 * ⚠️ NENHUM PARÂMETRO FOI ESCOLHIDO OLHANDO O RESULTADO (invariante nº 12).
 * Os valores abaixo são de livro e estão declarados antes da primeira rodada.
 * No instante em que eu varrer parâmetros procurando o melhor, o número vira
 * sobreajuste com cara de descoberta.
 */

import { median } from "@/lib/zion/stats";
import type { LabStatus } from "./registry";

/** Mesmo custo do resto do laboratório — ida e volta, taxa + slippage. */
export const CUSTO_PCT = Number(process.env.BACKTEST_COST_PCT ?? 0.2);

/* ─────────────────────────────────────────────────────────────────────────
 * C9 — ROTAÇÃO POR MOMENTO
 * ───────────────────────────────────────────────────────────────────────── */

/** Quantos dias de retorno passado ordenam o ranking. Clássico, declarado. */
export const OLHAR_PARA_TRAS_DIAS = 90;
/** Quantos ativos ficam na carteira. O plano exige 5+ posições para a mesa existir. */
export const TOPO_N = 3;
/** De quantos em quantos dias a carteira é refeita. */
export const REBALANCE_DIAS = 30;

export interface PontoRotacao {
  /** Dia em que a carteira foi montada. */
  dia:        string;
  /** Os escolhidos naquele rebalanceamento — a parcela, sem a qual não é auditável. */
  escolhidos: string[];
  /** Retorno do período seguinte, já com o custo do giro. */
  retornoPct: number;
  /** Retorno de segurar TODOS os símbolos, peso igual, no MESMO período. */
  segurarPct: number;
}

/**
 * Roda a rotação sobre um mapa de séries diárias.
 *
 * ⚠️ O SINAL DE HOJE VALE PARA O PERÍODO SEGUINTE, nunca para o próprio. Ordenar
 * pelo retorno passado e aplicar ao retorno que já aconteceu é o lookahead
 * clássico, e é o que faz qualquer rotação parecer genial.
 *
 * ⚠️ E O CUSTO É COBRADO POR TROCA DE POSIÇÃO, não por rebalanceamento. Um
 * rebalanceamento que mantém os mesmos três ativos não custa nada; um que troca
 * os três custa seis pernas. Cobrar taxa fixa por rebalanceamento inventaria
 * custo onde não houve giro e o esconderia onde houve.
 */
export function rodarRotacao(
  series: Map<string, Map<string, number>>,
  opts?: { olharDias?: number; topoN?: number; rebalanceDias?: number; custoPct?: number },
): PontoRotacao[] {
  const olhar   = opts?.olharDias ?? OLHAR_PARA_TRAS_DIAS;
  const topoN   = opts?.topoN ?? TOPO_N;
  const passo   = opts?.rebalanceDias ?? REBALANCE_DIAS;
  const custo   = opts?.custoPct ?? CUSTO_PCT;

  const simbolos = [...series.keys()];
  if (simbolos.length === 0) return [];

  // ⚠️ O CALENDÁRIO É A INTERSEÇÃO, não a união. Um símbolo que só existe na
  // metade da janela entraria com retorno indefinido nos dias que faltam, e a
  // falta viraria zero — que é retorno, não ausência.
  let dias: string[] | null = null;
  for (const s of simbolos) {
    const d = [...series.get(s)!.keys()].sort();
    dias = dias === null ? d : dias.filter((x) => series.get(s)!.has(x));
  }
  if (!dias || dias.length < olhar + passo + 1) return [];

  const pontos: PontoRotacao[] = [];
  let anteriores: string[] = [];

  for (let i = olhar; i + passo < dias.length; i += passo) {
    const diaMonta = dias[i];
    const diaFecha = dias[i + passo];
    const diaOlha  = dias[i - olhar];

    const ranking = simbolos
      .map((s) => {
        const ini = series.get(s)!.get(diaOlha);
        const fim = series.get(s)!.get(diaMonta);
        return { s, mom: ini && fim && ini > 0 ? fim / ini - 1 : null };
      })
      .filter((x): x is { s: string; mom: number } => x.mom != null)
      .sort((a, b) => b.mom - a.mom);
    if (ranking.length < topoN) continue;

    const escolhidos = ranking.slice(0, topoN).map((x) => x.s);

    const retornoDe = (s: string): number | null => {
      const a = series.get(s)!.get(diaMonta);
      const b = series.get(s)!.get(diaFecha);
      return a && b && a > 0 ? b / a - 1 : null;
    };

    const rets = escolhidos.map(retornoDe).filter((r): r is number => r != null);
    if (rets.length === 0) continue;
    const bruto = rets.reduce((x, y) => x + y, 0) / rets.length;

    // Pernas giradas: quem saiu + quem entrou. Manter não custa.
    const saiu   = anteriores.filter((s) => !escolhidos.includes(s)).length;
    const entrou = escolhidos.filter((s) => !anteriores.includes(s)).length;
    const custoDoGiro = ((saiu + entrou) / Math.max(1, topoN)) * (custo / 100);

    const todos = simbolos.map(retornoDe).filter((r): r is number => r != null);
    const segurar = todos.length ? todos.reduce((x, y) => x + y, 0) / todos.length : 0;

    pontos.push({
      dia: diaMonta,
      escolhidos,
      retornoPct: Number(((bruto - custoDoGiro) * 100).toFixed(4)),
      segurarPct: Number((segurar * 100).toFixed(4)),
    });
    anteriores = escolhidos;
  }
  return pontos;
}

/* ─────────────────────────────────────────────────────────────────────────
 * C10 — GRADE (GRID)
 * ───────────────────────────────────────────────────────────────────────── */

/** Largura da faixa, para cada lado do preço inicial. Declarada. */
export const FAIXA_PCT = 20;
/** Quantos degraus de cada lado. */
export const DEGRAUS = 10;

export interface ResultadoGrade {
  simbolo:      string;
  /** Retorno TOTAL da grade: lucro realizado + o que sobrou no estoque. */
  totalPct:     number;
  /** Só o que os degraus capturaram — o número que as propagandas mostram. */
  realizadoPct: number;
  /**
   * ⚠️ O PREJUÍZO NÃO REALIZADO do que sobrou no estoque — `valor de mercado
   * MENOS o que foi pago por ele`. É a metade que some das propagandas de grid:
   * quando o preço fura a faixa por baixo, a grade fica COMPRADA no fundo e
   * para de ganhar.
   *
   * ⚠️ A PRIMEIRA VERSÃO ESTAVA ALGEBRICAMENTE ERRADA e ninguém percebeu na
   * leitura: ela calculava `estoque − (1 − caixa)`, que se expande em
   * `estoque − gasto + recebido` — ou seja, exatamente o TOTAL. Na rodada de
   * 10/08 as duas colunas saíram IDÊNTICAS em todas as dez linhas, e
   * `realizado + estoque` não fechava com o total em nenhuma.
   *
   * Agora `realizado + estoque === total`, e há teste exigindo isso.
   */
  estoquePct:   number;
  /** Quantos preenchimentos aconteceram — cada um paga taxa. */
  fills:        number;
  /** A faixa foi rompida? Para que lado? */
  rompeu:       "nao" | "abaixo" | "acima" | "ambos";
  segurarPct:   number;
}

/**
 * Roda uma grade simétrica sobre uma série de fechamentos.
 *
 * ⚠️ MODELO DECLARADO, e o que ele simplifica está dito: os preenchimentos são
 * detectados no FECHAMENTO diário, então uma oscilação intradiária que cruzasse
 * vários degraus no mesmo dia conta como um só. Isso SUBESTIMA a grade — é o
 * lado conservador, e o lado que não vende a mesa.
 */
export function rodarGrade(
  closes: number[], opts?: { faixaPct?: number; degraus?: number; custoPct?: number },
): Omit<ResultadoGrade, "simbolo" | "segurarPct"> | null {
  const faixa   = opts?.faixaPct ?? FAIXA_PCT;
  const degraus = opts?.degraus ?? DEGRAUS;
  const custo   = (opts?.custoPct ?? CUSTO_PCT) / 100;
  if (closes.length < 2 || !(closes[0] > 0)) return null;

  const p0 = closes[0];
  const passo = (faixa / 100) / degraus;
  // Níveis de compra abaixo e de venda acima, simétricos em torno de p0.
  const niveis = Array.from({ length: degraus }, (_, k) => ({
    compra: p0 * (1 - passo * (k + 1)),
    venda:  p0 * (1 + passo * (k + 1)),
    cheio:  false,
  }));

  // Capital dividido igualmente entre os degraus de compra.
  const fatia = 1 / degraus;
  // ⚠️ `custoDaBase` é o que foi PAGO pelo estoque que ainda está na mão. Sem
  // ele não há como separar o realizado do não realizado — e foi a falta dele
  // que fez a coluna ESTOQUE virar uma cópia do TOTAL.
  let caixa = 1, base = 0, custoDaBase = 0, realizado = 0, fills = 0;
  let furouAbaixo = false, furouAcima = false;

  for (let i = 1; i < closes.length; i++) {
    const p = closes[i];
    if (!(p > 0)) continue;
    if (p < p0 * (1 - faixa / 100)) furouAbaixo = true;
    if (p > p0 * (1 + faixa / 100)) furouAcima = true;

    for (const n of niveis) {
      if (!n.cheio && p <= n.compra && caixa >= fatia) {
        const gasto = fatia;
        const qtdComprada = (gasto / p) * (1 - custo);
        caixa -= gasto;
        base  += qtdComprada;
        custoDaBase += gasto;
        n.cheio = true; fills++;
      } else if (n.cheio && p >= n.venda) {
        const qtd = fatia / n.compra;
        const vendeu = Math.min(base, qtd);
        if (vendeu > 0) {
          const recebe = vendeu * p * (1 - custo);
          // Baixa proporcional do custo — média ponderada, sem escolher lote.
          const custoBaixado = base > 0 ? custoDaBase * (vendeu / base) : 0;
          caixa += recebe;
          realizado += recebe - custoBaixado;
          base -= vendeu;
          custoDaBase -= custoBaixado;
          n.cheio = false; fills++;
        }
      }
    }
  }

  const pFim = closes[closes.length - 1];
  const estoque = base * pFim;
  const total = caixa + estoque - 1;
  // ⚠️ Não realizado = valor de mercado − o que foi pago. Com isto,
  // `realizado + naoRealizado === total`, e o teste cobra a identidade.
  const naoRealizado = estoque - custoDaBase;

  return {
    totalPct:     Number((total * 100).toFixed(4)),
    realizadoPct: Number((realizado * 100).toFixed(4)),
    estoquePct:   Number((naoRealizado * 100).toFixed(4)),
    fills,
    rompeu: furouAbaixo && furouAcima ? "ambos" : furouAbaixo ? "abaixo" : furouAcima ? "acima" : "nao",
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * VEREDITOS
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ PISO DE AMOSTRA EM REBALANCEAMENTOS, não em dias.
 *
 * Uma janela de um ano com giro de 30 dias dá DOZE decisões, não 365. Contar
 * dias aqui seria a invariante nº 5 outra vez: o mesmo mês contado trinta
 * vezes.
 */
export const MIN_REBALANCES = 8;
/** Grade: piso de símbolos, para uma moeda sortuda não virar veredito. */
export const MIN_SIMBOLOS_GRADE = 4;

export type Status = LabStatus;
export interface Veredito { status: Status; texto: string }

/**
 * ⚠️ O TERCEIRO COMPETIDOR: NÃO FAZER NADA.
 *
 * A rodada de 10/08 marcou VERDE as duas mesas — a rotação perdendo 3,01% por
 * período e a grade perdendo 54,11% do capital. Pela régua declarada estava
 * certo: as duas bateram comprar-e-segurar, que perdeu mais. E pela leitura de
 * quem olha a tela estava absurdo.
 *
 * O que faltava é que comprar-e-segurar NÃO é a única alternativa. Ficar em
 * CAIXA sempre está disponível, não custa nada e, num ano em que todos os dez
 * majors caíram, bateu as duas mesas com folga.
 *
 * Então: uma mesa com retorno absoluto negativo NÃO pode ser verde, por mais
 * que ganhe do índice. Ela vira CINZA e a tela diz as três posições em ordem —
 * senão "bateu o mercado" é lido como "funciona".
 */
export function perdeuParaOCaixa(absolutoPct: number): boolean {
  return absolutoPct <= 0;
}

export function vereditoRotacao(
  pontos: PontoRotacao[], minRebalances = MIN_REBALANCES,
): Veredito {
  if (pontos.length < minRebalances) {
    return {
      status: "inconclusiva",
      texto: `só ${pontos.length} rebalanceamento(s), abaixo do piso de ${minRebalances}. `
        + `A amostra desta mesa são as DECISÕES, não os dias — inconclusivo não é reprovado.`,
    };
  }
  const mesa    = median(pontos.map((p) => p.retornoPct)) ?? 0;
  const segurar = median(pontos.map((p) => p.segurarPct)) ?? 0;
  const vantagem = mesa - segurar;

  if (vantagem <= 0) {
    return {
      status: "morta",
      texto: `a rotação rende ${mesa.toFixed(2)}% por período contra ${segurar.toFixed(2)}% de `
        + `segurar todos com peso igual — ${vantagem.toFixed(2)} ponto(s) ABAIXO de não escolher nada. `
        + `Escolher os melhores não pagou o giro.`,
    };
  }
  /** ⚠️ Bateu o índice, mas PERDEU DINHEIRO. Ver `perdeuParaOCaixa`. */
  if (perdeuParaOCaixa(mesa)) {
    return {
      status: "morta",
      texto: `a rotação bateu segurar todos (+${vantagem.toFixed(2)} ponto(s)) — mas PERDEU `
        + `${Math.abs(mesa).toFixed(2)}% por período, em ${pontos.length} rebalanceamentos. `
        + `Os dois caminhos perderam; ficar em CAIXA bateu os dois. `
        + `"Menos ruim que o índice" não é uma mesa que se opera.`,
    };
  }
  return {
    status: "verde",
    texto: `a rotação rende ${mesa.toFixed(2)}% por período contra ${segurar.toFixed(2)}% de segurar `
      + `todos — +${vantagem.toFixed(2)} ponto(s), em ${pontos.length} rebalanceamentos.`,
  };
}

export function vereditoGrade(
  rs: ResultadoGrade[], minSimbolos = MIN_SIMBOLOS_GRADE,
): Veredito {
  if (rs.length < minSimbolos) {
    return {
      status: "inconclusiva",
      texto: `só ${rs.length} símbolo(s) medidos, abaixo do piso de ${minSimbolos}. `
        + `Uma moeda sortuda não é veredito.`,
    };
  }
  const total     = median(rs.map((r) => r.totalPct)) ?? 0;
  const realizado = median(rs.map((r) => r.realizadoPct)) ?? 0;
  const segurar   = median(rs.map((r) => r.segurarPct)) ?? 0;
  const romperam  = rs.filter((r) => r.rompeu !== "nao").length;

  /**
   * ⚠️ O TESTE É SOBRE O TOTAL, NUNCA SOBRE O REALIZADO.
   *
   * O realizado é o número das propagandas: só os degraus que fecharam. Ele
   * ignora o estoque preso no fundo quando o preço fura a faixa — que é
   * exatamente como a grade perde dinheiro. Julgar pelo realizado seria a
   * invariante nº 1 nesta família: um custo que some da conta.
   */
  if (total <= segurar) {
    return {
      status: "morta",
      texto: `a grade entrega ${total.toFixed(2)}% contra ${segurar.toFixed(2)}% de comprar e segurar. `
        + `O lucro dos degraus (${realizado.toFixed(2)}%) não cobre o estoque preso: `
        + `${romperam}/${rs.length} símbolo(s) romperam a faixa.`,
    };
  }
  /** ⚠️ Bateu o índice, mas PERDEU DINHEIRO. Ver `perdeuParaOCaixa`. */
  if (perdeuParaOCaixa(total)) {
    return {
      status: "morta",
      texto: `a grade perdeu ${Math.abs(total).toFixed(2)}% do capital — menos que os `
        + `${Math.abs(segurar).toFixed(2)}% de segurar, mas ainda assim PERDEU. Os degraus `
        + `renderam ${realizado.toFixed(2)}% e o estoque preso comeu o resto: `
        + `${romperam}/${rs.length} romperam a faixa. Ficar em CAIXA bateu as duas alternativas.`,
    };
  }
  return {
    status: "verde",
    texto: `a grade entrega ${total.toFixed(2)}% contra ${segurar.toFixed(2)}% de segurar, com `
      + `${realizado.toFixed(2)}% vindo dos degraus. ${romperam}/${rs.length} romperam a faixa.`,
  };
}
