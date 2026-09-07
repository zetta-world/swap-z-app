/**
 * RODAR A MESA DE VERDADE — o seletor da casa, sobre a janela do cliente.
 *
 * ⚠️⚠️ ISTO NÃO É UMA TRADUÇÃO DA MESA, É A MESA. O dono viu os cards com
 * "+4,34%" e nenhum botão e disse: *"não tem como escolher"*. Estava certo — e a
 * saída que eu tinha proposto (estender o formulário com bracket por ATR e os
 * playbooks) era a pior das duas.
 *
 * Os dois pedaços que decidem já são PUROS:
 *
 *     velas → `computeIndicators(símbolo, 1h, 4h, 1d, 1w)`   (market-indicators)
 *           → `candidateAttempts(indicadores)`                (zion/playbooks)
 *           → StrategyPlan { entry, target, stop, horizonHours, playbook }
 *
 * Então o cliente não recebe uma aproximação chamada FREYJA: ele roda **a mesma
 * linha de código** que a mesa roda, sobre os símbolos e a janela dele, com o
 * pedágio da praça dele. Nada aqui reimplementa regra nenhuma.
 *
 * ⚠️ E A SAÍDA CONTINUA SENDO A DA CASA: `computeExitPath` (stop-first,
 * `expirada` como classe própria), a mesma do papel da casa e do motor do
 * backtest do cliente.
 */

import { computeIndicators, type Candle } from "@/lib/api/market-indicators";
import { candidateAttempts } from "@/lib/zion/playbooks";
import { computeExitPath } from "@/lib/paper/saida";
import type { VelaComTempo } from "@/lib/mercado/velas";
import type { Operacao } from "@/lib/bancada/motor";

/**
 * ⚠️ QUANTAS BARRAS O INDICADOR PRECISA ATRÁS DE SI. `computeIndicators`
 * devolve vazio abaixo de 52 velas de 1h, e o EMA50/ADX só assentam bem depois
 * disso. Menos que isto não é "sinal fraco": é indicador que ainda não nasceu.
 */
const BARRAS_DE_AQUECIMENTO = 200;

/**
 * ⚠️⚠️ O TETO DE BARRAS AVALIADAS, e ele é DECLARADO, não silencioso.
 *
 * Cada barra recalcula os indicadores sobre a fatia até ela — é o que impede o
 * lookahead, e é o que custa. 4.000 barras de 1h são ~5,5 meses e alguns
 * segundos de CPU; acima disso a rota estoura o tempo da função serverless.
 *
 * Quem pedir mais recebe a janela CORTADA **e o aviso** — a régua da casa é
 * "sem teto silencioso": um corte que não se anuncia lê-se como cobertura
 * total.
 */
export const MAX_BARRAS_AVALIADAS = Number(process.env.BANCADA_MAX_BARRAS ?? 4000);

/**
 * Agrega velas de um prazo menor num maior — 7 diárias viram uma semanal.
 *
 * ⚠️⚠️ ISTO NÃO É APROXIMAÇÃO, É A DEFINIÇÃO. Uma vela semanal É o agregado das
 * suas diárias: máxima = maior máxima, mínima = menor mínima, fechamento = o
 * último, volume = a soma. Não há informação inventada nem perdida.
 *
 * ⚠️ E ELA EXISTE PORQUE `DURACAO_MS` NÃO TEM "1w". A primeira versão deste
 * arquivo passava as velas DIÁRIAS no lugar das semanais — uma substituição
 * silenciosa que faria o `htf1w` do seletor ler outra coisa do que lê ao vivo,
 * e a mesa se comportaria diferente sem nada denunciar.
 */
export function agregar(velas: ReadonlyArray<VelaComTempo>, porBloco: number): VelaComTempo[] {
  if (porBloco < 2) return [...velas];
  const saida: VelaComTempo[] = [];
  for (let i = 0; i + porBloco <= velas.length; i += porBloco) {
    const bloco = velas.slice(i, i + porBloco);
    saida.push({
      t: bloco[0].t,
      high: Math.max(...bloco.map((b) => b.high)),
      low: Math.min(...bloco.map((b) => b.low)),
      close: bloco[bloco.length - 1].close,
      volume: bloco.reduce((a, b) => a + b.volume, 0),
    });
  }
  // ⚠️ O bloco INCOMPLETO do fim fica de fora: uma semana que ainda não fechou
  // não é uma vela semanal, é a mesma armadilha da vela corrente.
  return saida;
}

export interface VelasDaMesa {
  h1: VelaComTempo[];
  h4: VelaComTempo[];
  d1: VelaComTempo[];
  w1: VelaComTempo[];
}

export interface RodadaDaMesa {
  operacoes: Operacao[];
  /** Barras que o motor de fato avaliou. */
  barrasAvaliadas: number;
  /** ⚠️ `true` quando a janela pedida foi cortada pelo teto — ver acima. */
  cortadaPeloTeto: boolean;
  aindaAbertas: number;
  /** Quantas vezes cada playbook abriu. O cliente vê QUAL regra operou. */
  porPlaybook: Record<string, number>;
  /** Por que o seletor ficou de fora, quando ficou. Contado, não adivinhado. */
  porQueNaoAbriu: Record<string, number>;
}

/**
 * As velas do nosso cache no formato que os indicadores esperam.
 *
 * ⚠️ EXPORTADA para `agente.ts` — a instância viva do investidor tem de chamar
 * `computeIndicators` com exatamente a mesma preparação do backtest. Uma
 * segunda cópia desta função seria uma segunda forma de montar a entrada do
 * seletor, e a divergência apareceria como "o backtest disse uma coisa e o
 * agente fez outra" — sem nada para apontar.
 */
export function paraCandle(v: ReadonlyArray<VelaComTempo>): Candle[] {
  // ⚠️ `open` não existe no nosso cache e os indicadores não o usam — nenhum
  // dos cálculos (RSI, EMA, MACD, ATR, ADX, OBV) lê abertura.
  return v.map((x) => ({ high: x.high, low: x.low, close: x.close, volume: x.volume }));
}

/** ⚠️ Exportada pelo mesmo motivo de `paraCandle`: uma preparação só. */
export function ateOInstante<T extends { t: number }>(velas: ReadonlyArray<T>, t: number): T[] {
  return velas.filter((v) => v.t <= t);
}

/**
 * Roda o seletor da casa barra a barra.
 *
 * ⚠️⚠️ SEM LOOKAHEAD, POR CONSTRUÇÃO. Em cada barra `i` os indicadores são
 * recalculados sobre as velas **até `i`, inclusive** — e nunca além. É por isso
 * que o custo é o que é: reaproveitar um cálculo feito com a série inteira
 * daria a cada decisão um pedaço do futuro, e transformaria qualquer regra em
 * ouro.
 *
 * ⚠️ UMA POSIÇÃO POR VEZ, como no motor do cliente: deixar o sinal reabrir com
 * posição aberta empilharia o mesmo movimento e o `n` contaria repetição como
 * evidência.
 */
export function rodarMesa(
  velas: VelasDaMesa,
  simbolo: string,
  custoIdaEVoltaPct: number,
): RodadaDaMesa {
  const h1 = velas.h1;
  const operacoes: Operacao[] = [];
  const porPlaybook: Record<string, number> = {};
  const porQueNaoAbriu: Record<string, number> = {};
  let aindaAbertas = 0;

  const primeira = BARRAS_DE_AQUECIMENTO;
  const total = Math.max(0, h1.length - primeira);
  const cortadaPeloTeto = total > MAX_BARRAS_AVALIADAS;
  const ultima = cortadaPeloTeto ? primeira + MAX_BARRAS_AVALIADAS : h1.length;

  let livreApartirDe = primeira;
  let barrasAvaliadas = 0;

  for (let i = primeira; i < ultima; i++) {
    barrasAvaliadas++;
    if (i < livreApartirDe) continue;

    const t = h1[i].t;
    const ind = computeIndicators(
      simbolo,
      paraCandle(h1.slice(0, i + 1)),
      paraCandle(ateOInstante(velas.h4, t)),
      paraCandle(ateOInstante(velas.d1, t)),
      paraCandle(ateOInstante(velas.w1, t)),
    );

    const tentativas = candidateAttempts(ind);
    const comPlano = tentativas.find((a) => a.plan !== null);
    if (!comPlano || !comPlano.plan) {
      // ⚠️ O MOTIVO DA RECUSA É CONTADO. Uma mesa parada é indistinguível de uma
      // mesa quebrada se só o que operou for registrado — é a mesma razão pela
      // qual `candidateAttempts` devolve o `reason` em vez de só o plano.
      const motivo = tentativas[0]?.reason ?? "sem candidato no regime";
      porQueNaoAbriu[motivo] = (porQueNaoAbriu[motivo] ?? 0) + 1;
      continue;
    }

    const plano = comPlano.plan;
    const abertaEm = t + 1;
    const expiraEm = abertaEm + plano.horizonHours * 3_600_000;
    const ate = Math.min(h1[h1.length - 1].t, expiraEm);

    const v = computeExitPath(
      {
        side: "buy",           // ⚠️ estas mesas são long-only, por construção
        entry_price: plano.entry,
        cost_usd: 1,
        target_price: plano.target,
        stop_price: plano.stop,
        opened_at: new Date(abertaEm).toISOString(),
        horizon_hours: plano.horizonHours,
      },
      h1.slice(i + 1).map((x) => ({ t: x.t, high: x.high, low: x.low, close: x.close })),
      undefined,
      ate,
      custoIdaEVoltaPct,
    );

    if (!v) {
      // A posição chegou viva ao fim da janela: ela ocupa a mesa até lá.
      aindaAbertas++;
      livreApartirDe = h1.length;
      continue;
    }

    porPlaybook[plano.playbook] = (porPlaybook[plano.playbook] ?? 0) + 1;
    operacoes.push({
      abriuEm: t,
      fechouEm: ate,
      entrada: plano.entry,
      saida: v.exit,
      desfecho: v.reason === "target" ? "alvo" : v.reason === "stop" ? "stop" : "expirada",
      brutoPct: v.netPct + custoIdaEVoltaPct,
      liquidoPct: v.netPct,
      playbook: plano.playbook,
      simbolo,
    });

    // A próxima entrada só nasce depois desta fechar.
    const iFechou = h1.findIndex((x) => x.t > ate);
    livreApartirDe = iFechou < 0 ? h1.length : Math.max(i + 1, iFechou);
  }

  return { operacoes, barrasAvaliadas, cortadaPeloTeto, aindaAbertas, porPlaybook, porQueNaoAbriu };
}
