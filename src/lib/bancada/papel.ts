/**
 * O PAPEL ADIANTE — a decisão pura de quem tick, quando abre e quando fecha.
 *
 * ⚠️⚠️ ESTE É O ÚNICO CUSTO DA BANCADA QUE RECORRE. Um backtest custa uma vez;
 * uma mesa viva custa a cada 30 minutos, para sempre, por cliente. Por isso ele
 * começa em `trader` (§6.3) e por isso cada guarda daqui é uma guarda de
 * dinheiro, não de correção.
 *
 * ⚠️ E ELE NÃO CRIA CRON NOVO. Entra no `/api/zion/backtest`, que já roda de 30
 * em 30 minutos, já está agendado no cron-job.org e já executa o papel da
 * própria casa (`runPaperAgent`). Criar rota nova exigiria que o dono fosse
 * agendá-la — e `/api/dca/cron` está escrito, testado e **nunca agendado**
 * desde 26/08, esperando no RUNBOOK §2.1. Uma rota de cron que ninguém agenda é
 * "atividade não é evidência de funcionamento" esperando para acontecer.
 *
 * ⚠️ NÃO ENTRA no cron do autopilot, que move DINHEIRO REAL. Um defeito meu no
 * papel do cliente não pode chegar perto daquele caminho.
 */

import { BANCADA_COTAS, type Tier } from "@/lib/tier/types";
import type { Dono } from "@/lib/bancada/dono";
import { ultimaVelaFechada, type VelaComTempo } from "@/lib/mercado/velas";
import { sinais } from "@/lib/bancada/motor";
import { taxaDaBancadaPct, type EstrategiaDoCliente } from "@/lib/bancada/vocabulario";
import { computeExitPath } from "@/lib/paper/saida";

/** Uma mesa viva: a estratégia do cliente mais onde ela olha. */
export interface Mesa {
  id: string;
  /**
   * ⚠️ `Dono`, NÃO `string` — a marca do tipo pegou isto ao escrever o tick
   * (06/09): eu tinha declarado `string` aqui, e `abrirPosicao` recusou em
   * tempo de compilação. A mesa vem do banco e o dono dela é reconstruído com
   * `donoDeLinhaDoBanco`; afrouxar o tipo aqui seria abrir a porta que o
   * `bancada/dono.ts` existe para fechar.
   */
  dono: Dono;
  /**
   * ⚠️⚠️ `null` NUMA INSTÂNCIA DE AGENTE (0043) — e é de propósito que o tipo
   * force a bifurcação.
   *
   * O agente da casa NÃO TEM alvo e stop fixos: o bracket sai da volatilidade a
   * cada operação. Guardar um `EstrategiaDoCliente` de fachada aqui (com
   * `alvoPct: 2.5`, digamos) faria o tick abrir posições com um alvo que a mesa
   * nunca declarou — e a mentira só apareceria no extrato do investidor.
   * `null` obriga quem lê a perguntar "qual dos dois é este?" antes de decidir.
   */
  params: EstrategiaDoCliente | null;
  /** ⚠️ Preenchido = instância de agente da casa (o `source` do desk). */
  mesa: string | null;
  simbolos: string[];
  intervalo: string;
  /** `abriu_em` da posição mais recente desta mesa. `null` se nunca abriu. */
  ultimaAberturaMs: number | null;
  temPosicaoAberta: boolean;
  criadaEm: string;
}

/**
 * ⚠️⚠️ QUAIS MESAS PODEM TICKAR — e o downgrade é o caso que importa.
 *
 * Um `trader` que cai para `pro` fica com 0 mesas. Se a checagem morasse só no
 * momento de LIGAR, ele continuaria consumindo cron para sempre depois de parar
 * de pagar por isso — e ninguém perceberia, porque nada quebra.
 *
 * ⚠️ A ORDEM É DETERMINÍSTICA (mais antigas primeiro). Cortar por uma ordem
 * arbitrária faria mesas diferentes sobreviverem a cada tick, e o cliente veria
 * a mesa dele parar e voltar sem explicação.
 */
export function mesasQuePodemTickar(mesas: Mesa[], tier: Tier): { tickam: Mesa[]; cortadas: Mesa[] } {
  const teto = BANCADA_COTAS[tier].mesasDePapel;
  const ordenadas = [...mesas].sort((a, b) => a.criadaEm.localeCompare(b.criadaEm) || a.id.localeCompare(b.id));
  return { tickam: ordenadas.slice(0, teto), cortadas: ordenadas.slice(teto) };
}

/**
 * Uma mesa do VOCABULÁRIO DO CLIENTE — a única que `decidirAbertura` sabe ler.
 *
 * ⚠️ O tipo é a trava: passar uma instância de agente aqui não compila, e é
 * exatamente o erro que se quer impossível. O agente decide em `agente.ts`, com
 * o seletor real; `sinais()` não tem o que dizer sobre ele.
 */
export type MesaPropria = Mesa & { params: EstrategiaDoCliente };

export type PorQueNaoAbre =
  | "sem_velas"
  | "ja_tem_posicao"
  /** ⚠️ O sinal desta vela já foi avaliado num tick anterior. */
  | "vela_ja_avaliada"
  | "sem_sinal";

export type DecisaoDeAbertura =
  | { abre: true; velaMs: number; preco: number }
  | { abre: false; porque: PorQueNaoAbre };

/**
 * Abre posição nesta vela?
 *
 * ⚠️⚠️ SÓ VELA FECHADA, E SÓ UMA VEZ POR VELA. O cron roda a cada 30 minutos e
 * a vela pode ser de 1h: sem a segunda guarda, o MESMO sinal seria lido duas
 * vezes e abriria duas posições do mesmo movimento — a inflação de amostra que
 * o motor evita usando cruzamento, entrando pela porta do relógio.
 *
 * ⚠️ E a vela CORRENTE nunca decide: ela muda a cada negócio, então um sinal
 * lido nela pode desaparecer antes de a vela fechar. É o mesmo motivo pelo qual
 * ela não entra na `mercado_vela`.
 */
export function decidirAbertura(
  mesa: MesaPropria, velas: ReadonlyArray<VelaComTempo>, agoraMs: number,
): DecisaoDeAbertura {
  if (mesa.temPosicaoAberta) return { abre: false, porque: "ja_tem_posicao" };

  const fim = ultimaVelaFechada(mesa.intervalo, agoraMs);
  if (fim == null || velas.length === 0) return { abre: false, porque: "sem_velas" };

  const fechadas = velas.filter((v) => v.t <= fim);
  if (fechadas.length === 0) return { abre: false, porque: "sem_velas" };

  const ultima = fechadas[fechadas.length - 1];
  if (mesa.ultimaAberturaMs != null && ultima.t <= mesa.ultimaAberturaMs) {
    return { abre: false, porque: "vela_ja_avaliada" };
  }

  const marca = sinais(fechadas, mesa.params);
  if (!marca[marca.length - 1]) return { abre: false, porque: "sem_sinal" };
  if (!(ultima.close > 0)) return { abre: false, porque: "sem_velas" };

  return { abre: true, velaMs: ultima.t, preco: ultima.close };
}

/** Alvo e stop em PREÇO, a partir da entrada. */
export function alvoEStop(params: EstrategiaDoCliente, entrada: number): { alvo: number; stop: number } {
  const dir = params.direcao === "compra" ? 1 : -1;
  return {
    alvo: entrada * (1 + dir * (params.alvoPct / 100)),
    stop: entrada * (1 - dir * (params.stopPct / 100)),
  };
}

export interface Fechamento {
  status: "ganhou" | "perdeu" | "expirada";
  saida: number;
  resultadoPct: number;
}

/**
 * A posição fechou?
 *
 * ⚠️ REUSA `computeExitPath` — a MESMA convenção de saída do papel da casa e do
 * motor do backtest: stop-first pessimista, `expirada` como classe própria. Um
 * terceiro simulador seria uma terceira verdade sobre dinheiro.
 *
 * ⚠️ E O CUSTO É O DA PRAÇA DO CLIENTE, não o da casa: uma mesa de futuros
 * maker paga 0,03% e uma de spot taker paga 0,40%. Foi uma taxa única aplicada
 * a todo mundo que aposentou o Maker de Faixa por engano.
 */
export function decidirFechamento(
  params: EstrategiaDoCliente,
  posicao: { entrada: number; tamanhoUsd: number; abertaEmMs: number },
  velas: ReadonlyArray<VelaComTempo>,
  agoraMs: number,
): Fechamento | null {
  const { alvo, stop } = alvoEStop(params, posicao.entrada);
  return decidirFechamentoDaPosicao(
    {
      entrada: posicao.entrada, tamanhoUsd: posicao.tamanhoUsd, abertaEmMs: posicao.abertaEmMs,
      alvo, stop, horasLimite: params.horasLimite,
      lado: params.direcao === "compra" ? "long" : "short",
      custoIdaEVoltaPct: 2 * taxaDaBancadaPct(params.praca, params.papel),
    },
    velas, agoraMs,
  );
}

/** O bracket JÁ RESOLVIDO de uma posição — em preço, não em regra. */
export interface PosicaoParaFechar {
  entrada: number;
  tamanhoUsd: number;
  abertaEmMs: number;
  alvo: number;
  stop: number;
  horasLimite: number;
  lado: "long" | "short";
  /** ⚠️ Ida E volta, em %. A praça do DONO, nunca uma taxa única da casa. */
  custoIdaEVoltaPct: number;
}

/**
 * ⚠️⚠️ O FECHAMENTO LÊ O BRACKET **DA POSIÇÃO**, e isto conserta um defeito
 * latente do caminho antigo (0043).
 *
 * `decidirFechamento` relia o alvo e o stop da ESTRATÉGIA para fechar uma
 * posição já aberta. Editar a estratégia movia, retroativamente, o alvo de
 * posições vivas: o resultado mudava depois do fato, e nada denunciava — a
 * mesma família de "escolher a janela depois de ver o número".
 *
 * ⚠️ E É ISTO QUE O AGENTE DO INVESTIDOR EXIGE. O bracket dele é VARIÁVEL: sai
 * da volatilidade daquele instante, e duas posições da mesma instância têm
 * alvos diferentes. Não existe "a regra" de onde reler — só existe o que foi
 * decidido na hora, e é o que a linha guarda.
 */
export function decidirFechamentoDaPosicao(
  p: PosicaoParaFechar,
  velas: ReadonlyArray<VelaComTempo>,
  agoraMs: number,
): Fechamento | null {
  const v = computeExitPath(
    {
      side: p.lado === "long" ? "buy" : "sell",
      entry_price: p.entrada,
      cost_usd: p.tamanhoUsd,
      target_price: p.alvo,
      stop_price: p.stop,
      opened_at: new Date(p.abertaEmMs).toISOString(),
      horizon_hours: p.horasLimite,
    },
    velas.map((x) => ({ t: x.t, high: x.high, low: x.low, close: x.close })),
    undefined,
    agoraMs,
    p.custoIdaEVoltaPct,
  );
  if (!v) return null;

  /**
   * ⚠️ AS TRÊS CLASSES DO BANCO, e `expirada` NÃO vira ganho nem perda mesmo
   * fechando no lucro. `computeExitPath` devolve `win: true` para uma expirada
   * positiva — certo para o placar da casa, errado aqui: contá-la como vitória
   * infla a borda medida, e é cicatriz do flywheel.
   */
  const status: Fechamento["status"] =
    v.reason === "target" ? "ganhou" : v.reason === "stop" ? "perdeu" : "expirada";

  return { status, saida: v.exit, resultadoPct: v.netPct };
}

/**
 * ⚠️ O TETO DE TRABALHO DE UM TICK, global.
 *
 * O cron do `/api/zion/backtest` já faz muita coisa em 30 minutos, e uma mesa
 * que demora derruba o resto. Este número limita quantas mesas um tick
 * processa; as que sobram pegam o tick seguinte — ver `aVezDeQuem`, que é o que
 * de fato impede alguém de ficar para trás para sempre.
 */
export const MESAS_POR_TICK = Number(process.env.BANCADA_MESAS_POR_TICK ?? 40);

/**
 * ⚠️⚠️ O TETO SEPARADO DAS INSTÂNCIAS DE AGENTE — e o motivo é aritmética de
 * orçamento, não cautela genérica.
 *
 * As duas espécies de mesa custam coisas MUITO diferentes por símbolo:
 *
 *   · estratégia própria — 1 leitura de vela, e `sinais()` sobre ela;
 *   · instância de agente — **3 leituras** (1h, 4h, 1d), a agregação semanal, e
 *     `computeIndicators` sobre ~400 barras.
 *
 * Contar as duas contra o mesmo teto de 40 significa que 40 agentes de 5
 * símbolos pedem 600 leituras — dentro de uma função com `maxDuration = 60`
 * que ANTES disso já rodou o flywheel, o oráculo, o radar e o papel da casa.
 * O que estoura ali não é a bancada do cliente: é o tick inteiro.
 */
export const AGENTES_POR_TICK = Number(process.env.BANCADA_AGENTES_POR_TICK ?? 8);

/**
 * ⚠️⚠️ DE QUEM É A VEZ NESTE TICK — a janela ROLA, e sem isso o teto mente.
 *
 * O comentário de `MESAS_POR_TICK` dizia que "a ordem determinística garante
 * que ninguém fique para trás para sempre". Ele estava errado: com uma ordem
 * estável e um corte fixo, as mesmas primeiras `teto` mesas ganham em TODO
 * tick, e a de número `teto+1` nunca roda. Não é uma fila — é um corte.
 *
 * Aqui a ordem continua determinística (a lista chega ordenada por criação),
 * mas o PONTO DE PARTIDA anda a cada tick. Em `n/teto` ticks todo mundo passou,
 * e o cliente cuja mesa é a última a ser criada não fica invisível para sempre.
 *
 * ⚠️ `tick` vem do relógio dividido pela cadência, não de um contador guardado:
 * um contador em `admin_kv` seria mais uma escrita que pode falhar, e falhando
 * ele congelaria a janela exatamente onde estava.
 */
export function aVezDeQuem<T>(fila: ReadonlyArray<T>, teto: number, tick: number): T[] {
  const n = fila.length;
  if (n === 0 || teto <= 0) return [];
  if (n <= teto) return [...fila];
  // ⚠️ `((x % n) + n) % n` porque `%` em JS devolve negativo para entrada
  // negativa — e um relógio errado não pode virar um índice negativo.
  const inicio = (((tick * teto) % n) + n) % n;
  const saida: T[] = [];
  for (let i = 0; i < teto; i++) saida.push(fila[(inicio + i) % n]);
  return saida;
}

/** A cadência do cron que hospeda o tique. `aVezDeQuem` conta ticks com ela. */
export const CADENCIA_MS = 30 * 60_000;

export function tickAtual(agoraMs: number): number {
  return Math.floor(agoraMs / CADENCIA_MS);
}
