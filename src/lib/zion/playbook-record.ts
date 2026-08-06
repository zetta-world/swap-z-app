/**
 * O HISTÓRICO DE CADA PLAYBOOK, na mão de quem decide.
 *
 * O backtest mede cada estratégia isolada. Até agora esse número aparecia no
 * painel e morria ali — informação que não muda decisão nenhuma é decoração,
 * que é exatamente o defeito que esta semana inteira perseguiu.
 *
 * Este módulo entrega a medição ao MÍMIR na hora de escolher. É o que o plano
 * chamava de "escolha informada": a mesa de IA decidindo com o histórico do
 * playbook na mão, em vez de escolher às cegas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A REGRA QUE MANDA AQUI, E POR QUE ELA É MAIS IMPORTANTE QUE O NÚMERO:
 *
 *   AMOSTRA PEQUENA NÃO VIRA NÚMERO NO PROMPT.
 *
 * Um modelo que recebe "absorção: +2,1%" trata aquilo como fato, mesmo que os
 * +2,1% venham de TRÊS trades. Ele não tem como desconfiar — o número chegou
 * com a mesma autoridade dos outros. Seria o defeito do Valhalla (ruído com
 * cara de resultado) transplantado para dentro da decisão, onde faz muito mais
 * estrago do que numa tela.
 *
 * Então abaixo do limiar o histórico é entregue como AUSÊNCIA explícita — "sem
 * amostra (n=3)" — e não como valor. A IA fica sabendo que não sabe.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE ISTO FAZ COM O DUELO — e não dá para esconder:
 *
 * O VÖLUNDR continua escolhendo pela prioridade declarada, sem histórico. O
 * MÍMIR passa a escolher com ele. Isso significa que o duelo deixou de comparar
 * só "IA vs regra fixa": agora compara "IA COM evidência" contra "regra fixa
 * SEM evidência".
 *
 * Isso é defensável — a tese do dono é que a IA ANALISA o mercado e escolhe a
 * estratégia adequada, e escolher sem saber o que funciona não é analisar, é
 * adivinhar. Mas tem um custo honesto: se o MÍMIR ganhar, não saberemos de
 * imediato se venceu a IA ou o histórico.
 *
 * A resposta para isso é uma TERCEIRA mesa — mecânica, ordenada pelo histórico
 * medido — e ela está no fim deste arquivo: URÐR, a Norna do passado. Com ela
 * cada comparação volta a isolar uma coisa só (ver `rankByRecord`).
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { NOISE_THRESHOLD } from "@/lib/admin/sample";
import type { MarketRegime } from "@/lib/api/market-indicators";

/** Onde o resultado do backtest fica guardado para as mesas lerem. */
export const RECORD_KEY = "playbook_record";

export interface PlaybookRecordEntry {
  playbook: string;
  decided: number;
  netPerTrade: number | null;
  byRegime: Partial<Record<MarketRegime, { decided: number; netPerTrade: number }>>;
  /**
   * ⚠️ POR CLIMA — e a razão de estar aqui é um erro meu, repetido.
   *
   * O filtro de regime foi construído com a quebra por clima medida no
   * backtest... e mostrada só na tela. O dono rodou, pediu para eu conferir a
   * quebra, e eu não tinha o que conferir: a medição existiu, foi correta, e
   * evaporou no fim da requisição.
   *
   * É a TERCEIRA vez que este defeito aparece — a sonda de orderbook gravava
   * num feed que ninguém agregava, a conferência de preço ao vivo não gravava
   * nada, e agora esta. As duas primeiras viraram documento
   * (`docs/LEITURA-SEGURA-DO-BANCO.md`), e mesmo assim repeti no dia seguinte.
   *
   * A regra que faltava é mais curta que o documento: NÚMERO QUE VAI DECIDIR
   * ALGUMA COISA TEM QUE SER GRAVADO ANTES DE SER EXIBIDO.
   */
  byWeather?: Partial<Record<"favoravel" | "misto" | "adverso", { decided: number; netPerTrade: number }>>;
  /**
   * ⚠️ O ESPELHO — o que a posição INVERTIDA teria rendido. E a razão de estar
   * aqui é o MESMO defeito, pela quarta vez (05/08).
   *
   * `playbook-backtest.ts` calcula `inverseNetPerTrade` desde 03/08: para cada
   * trade, monta a posição espelhada (o stop do long vira o alvo, o alvo vira o
   * stop) e a resolve contra as mesmas velas. Não é `−netPct` — é uma posição
   * DE VERDADE, com stop-first pessimista dos dois lados.
   *
   * É exatamente o número que responde "vale a pena dar short a estas mesas?".
   * E ele ia para a tela e evaporava.
   *
   * Descobri isto ao começar a implementar o short: fui ler o resultado do
   * espelho para decidir, e não havia o que ler. Estava prestes a construir
   * capacidade de venda por palpite — na semana em que a regra da casa virou
   * "mede antes de construir".
   *
   * A regra escrita quatro parágrafos acima, e violada de novo: NÚMERO QUE VAI
   * DECIDIR ALGUMA COISA TEM QUE SER GRAVADO ANTES DE SER EXIBIDO.
   */
  inverseNetPerTrade?: number | null;
}

export interface PlaybookRecord {
  /** O comprar-e-segurar mediano da janela — o denominador do veredito. */
  marketPct?: number | null;
  entries: PlaybookRecordEntry[];
  /** Janela testada, em dias. Vai junto porque um número sem janela mente. */
  windowDays: number;
  measuredAt: string;
}

/**
 * Como o histórico de um playbook chega ao prompt.
 *
 * Devolve `null` quando não há o que dizer — e o chamador OMITE a linha em vez
 * de escrever "sem dados", porque uma lista cheia de "sem dados" vira ruído que
 * o modelo aprende a pular, levando junto as linhas que importam.
 */
export function formatRecord(
  entry: PlaybookRecordEntry | undefined,
  regime: MarketRegime,
  threshold = NOISE_THRESHOLD,
): string | null {
  if (!entry) return null;

  // O histórico NO REGIME ATUAL vale mais que o geral: uma estratégia raramente
  // é boa ou ruim em geral — ela é boa num terreno e péssima noutro, e o terreno
  // de agora é o que está em jogo.
  const here = entry.byRegime[regime];
  if (here && here.decided >= threshold) {
    return `histórico neste regime: ${here.netPerTrade > 0 ? "+" : ""}${here.netPerTrade.toFixed(2)}%/trade (n=${here.decided})`;
  }

  // Sem amostra no regime, cai para o geral — sinalizando que é o geral.
  if (entry.decided >= threshold && entry.netPerTrade != null) {
    const nota = here ? ` · neste regime só n=${here.decided}, insuficiente` : " · sem amostra neste regime";
    return `histórico GERAL: ${entry.netPerTrade > 0 ? "+" : ""}${entry.netPerTrade.toFixed(2)}%/trade (n=${entry.decided})${nota}`;
  }

  // AMOSTRA PEQUENA NÃO VIRA NÚMERO. A ausência é dita como ausência: sem isto
  // o modelo trataria três trades de sorte como evidência.
  return `sem amostra suficiente (n=${entry.decided}) — trate como DESCONHECIDO, não como neutro`;
}

/** Grava o resultado do backtest para as mesas lerem. Best-effort. */
/**
 * ⚠️ O HISTÓRICO DE MEDIÇÕES — o que faltava, e custou uma conclusão errada.
 *
 * Em 03/08 o backtest rodou às 13:24 e devolveu `pivot_reversion` com n=83 e
 * +0.202% líquido: o PRIMEIRO playbook positivo da biblioteca. Seis horas
 * depois, o MESMO backtest, na mesma janela de 174 dias rolando, devolveu n=92
 * e −0.069%.
 *
 * Nove trades novos — menos de 10% da amostra — inverteram o veredito. Eles
 * mediam −2.568% cada.
 *
 * Guardar só a ÚLTIMA medição faz cada rodada parecer um fato. Duas rodadas
 * lado a lado mostram o que ela é: um número que ainda não parou de se mexer.
 * A diferença não é acadêmica — a URÐR estava a um candidato de operar aquele
 * +0.202%, e teria colocado dinheiro em cima de ruído com a bênção de um
 * "histórico medido".
 *
 * Guardamos as últimas `HISTORY_MAX` rodadas. Não é auditoria completa: é o
 * mínimo para responder "este número é estável ou está balançando?".
 */
const HISTORY_KEY = "playbook_record:history";
const HISTORY_MAX = 12;

export interface RecordSnapshot {
  measuredAt: string;
  windowDays: number;
  /**
   * O que o MERCADO fez na mesma janela (mediana de comprar-e-segurar).
   *
   * Sem isto guardado, "estamos perdendo num mercado bom" é uma impressão. Com
   * ele, é uma conta: a expectância da biblioteca ao lado do que bastaria fazer
   * sem estratégia nenhuma.
   */
  marketPct?: number | null;
  /** playbook → o que foi medido naquele instante, clima incluído. */
  byPlaybook: Record<string, {
    decided: number;
    netPerTrade: number | null;
    byWeather?: Partial<Record<"favoravel" | "misto" | "adverso", { decided: number; netPerTrade: number }>>;
  }>;
}

export async function savePlaybookRecord(record: PlaybookRecord): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  try {
    const { error } = await db.from("admin_kv").upsert(
      { key: RECORD_KEY, value: JSON.stringify(record), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (error) return false;

    // O histórico é best-effort e SEPARADO: se ele falhar, a medição atual
    // continua valendo. O contrário não — sem a medição atual não há o que
    // historiar.
    const anterior = await loadHistory();
    const snap: RecordSnapshot = {
      measuredAt: record.measuredAt, windowDays: record.windowDays,
      marketPct: record.marketPct ?? null,
      byPlaybook: Object.fromEntries(record.entries.map((e) => [
        e.playbook,
        {
          decided: e.decided, netPerTrade: e.netPerTrade,
          byWeather: e.byWeather,
          // O espelho vai junto: é ele que decide se estas mesas ganham short.
          inverseNetPerTrade: e.inverseNetPerTrade,
        },
      ])),
    };
    const proximo = [snap, ...anterior].slice(0, HISTORY_MAX);
    await db.from("admin_kv").upsert(
      { key: HISTORY_KEY, value: JSON.stringify(proximo), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    return true;
  } catch { return false; }
}

/** As últimas rodadas, da mais nova para a mais velha. */
export async function loadHistory(): Promise<RecordSnapshot[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  try {
    const { data } = await db.from("admin_kv").select("value").eq("key", HISTORY_KEY).maybeSingle();
    if (!data?.value) return [];
    const parsed = JSON.parse(String(data.value)) as RecordSnapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/**
 * ESTE NÚMERO PAROU DE SE MEXER?
 *
 * A regra é o sinal: um playbook cujo líquido trocou de sinal entre rodadas
 * recentes não tem veredito, tem oscilação. `pivot_reversion` passou de +0.202%
 * para −0.069% em seis horas e continuaria sendo exibido como "medido" — com
 * amostra acima do limiar e tudo.
 *
 * Amostra grande e sinal instável é a combinação mais perigosa que existe aqui:
 * ela passa em todos os filtros de tamanho e mesmo assim não significa nada.
 *
 * Com menos de `minRuns` rodadas a resposta é `false` — não estável, porque
 * ainda não dá para saber. Ausência de evidência não vira estabilidade.
 */
export function isStableSign(
  playbook: string, history: RecordSnapshot[], minRuns = 3,
): boolean {
  const vistos = history
    .map((h) => h.byPlaybook[playbook]?.netPerTrade)
    .filter((v): v is number => v != null);
  if (vistos.length < minRuns) return false;
  const recentes = vistos.slice(0, minRuns);
  return recentes.every((v) => v > 0) || recentes.every((v) => v < 0);
}

/** Quanto o líquido oscilou entre as rodadas guardadas — o tamanho do balanço. */
export function swingPct(playbook: string, history: RecordSnapshot[]): number | null {
  const vistos = history
    .map((h) => h.byPlaybook[playbook]?.netPerTrade)
    .filter((v): v is number => v != null);
  if (vistos.length < 2) return null;
  return Math.max(...vistos) - Math.min(...vistos);
}

/**
 * Lê o histórico medido. `null` quando nunca foi medido — e o chamador deve
 * seguir SEM histórico, não inventar um.
 */
export async function loadPlaybookRecord(): Promise<PlaybookRecord | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  try {
    const { data } = await db.from("admin_kv").select("value").eq("key", RECORD_KEY).maybeSingle();
    if (!data?.value) return null;
    const parsed = JSON.parse(String(data.value)) as PlaybookRecord;
    return Array.isArray(parsed.entries) ? parsed : null;
  } catch { return null; }
}

/**
 * Um histórico velho é pior que nenhum: ele descreve um mercado que já passou e
 * chega com a mesma autoridade de um recente. Trinta dias é o limite — a janela
 * do próprio backtest.
 */
export const RECORD_STALE_DAYS = 30;

export function isStale(record: PlaybookRecord, nowMs: number, maxDays = RECORD_STALE_DAYS): boolean {
  const t = Date.parse(record.measuredAt);
  if (!Number.isFinite(t)) return true;
  return (nowMs - t) / 86_400_000 > maxDays;
}

// ── URÐR — escolher pelo que JÁ ACONTECEU ─────────────────────────────────

/**
 * A ordenação da terceira mesa.
 *
 * POR QUE ELA EXISTE: quando o MÍMIR passou a receber o histórico, o duelo
 * ganhou uma segunda variável. Ele deixou de comparar "IA vs regra fixa" e
 * passou a comparar "IA COM evidência" contra "regra fixa SEM evidência" — e se
 * o MÍMIR ganhasse, não daria para saber se venceu a IA ou o histórico.
 *
 * URÐR é a Norna do passado, "aquilo que já se tornou". Ela é MECÂNICA como o
 * VÖLUNDR e escolhe SÓ pelo registro. Com ela, cada comparação isola uma coisa:
 *
 *   VÖLUNDR × URÐR   → quanto vale a EVIDÊNCIA sozinha
 *   URÐR × MÍMIR     → quanto vale o JULGAMENTO da IA sobre a evidência
 *   VÖLUNDR × MÍMIR  → o efeito combinado
 *
 * AS TRÊS REGRAS, e a terceira é a que dá sentido à mesa:
 *
 *  1. Com amostra suficiente NO REGIME, ordena pelo líquido medido, melhor
 *     primeiro. É literalmente "faça o que funcionou aqui".
 *  2. Sem amostra, o playbook é DESCONHECIDO — não é ruim. Vai depois dos
 *     medidos-positivos, na ordem declarada. Excluí-lo impediria para sempre
 *     que ele acumulasse amostra, e a mesa nunca aprenderia nada novo.
 *  3. Medido NEGATIVO é EXCLUÍDO. Se a evidência diz que aquele setup perde
 *     dinheiro naquele terreno, seguir a evidência é não operá-lo — e se todos
 *     os candidatos forem assim, a mesa fica de FORA. É essa disciplina que a
 *     evidência compra, e é o comportamento que a distingue do VÖLUNDR, que
 *     tomaria o primeiro da lista de qualquer jeito.
 */
export interface RankedCandidate<T> {
  candidate: T;
  /** Líquido medido no regime, quando há amostra. */
  measuredNet: number | null;
  /** `true` quando não há amostra — desconhecido, não ruim. */
  unknown: boolean;
}

export function rankByRecord<T extends { playbook: string }>(
  candidates: T[],
  record: PlaybookRecord | null,
  regime: MarketRegime,
  threshold = NOISE_THRESHOLD,
  /**
   * ⚠️ ESTABILIDADE, além de amostra (03/08 — segunda correção do mesmo dia).
   *
   * A primeira versão exigia só `decided >= threshold`. Isso teria feito a URÐR
   * apostar no `pivot_reversion` a +0.202% às 13:24 — número que às 19:45, na
   * mesma janela rolada por seis horas, já era −0.069%.
   *
   * Ela passava em TODOS os filtros: amostra de 83, acima do limiar de 30,
   * regime coerente, sinal positivo. E era ruído.
   *
   * Amostra grande com sinal instável é a combinação mais perigosa aqui, porque
   * é a única que atravessa todas as defesas de tamanho. Sem o histórico, não há
   * como distinguir "medido" de "medido uma vez".
   */
  history: RecordSnapshot[] = [],
): RankedCandidate<T>[] {
  // SEM REGISTRO, URÐR NÃO OPERA — e isso é deliberado.
  //
  // Se ela caísse na ordem declarada, viraria um VÖLUNDR com outro nome, e o
  // ledger encheria de trades idênticos aos do controle sob a bandeira de um
  // terceiro braço. É exatamente a contaminação que o MÍMIR sofreu por semanas
  // e que só apareceu porque alguém foi olhar.
  if (!record) return [];

  const scored = candidates.map((c) => {
    const entry = record.entries.find((e) => e.playbook === c.playbook);
    const here = entry?.byRegime[regime];
    // AMOSTRA E ESTABILIDADE, nesta ordem. Amostra grande sem estabilidade é
    // um número que ainda está se mexendo — e tratá-lo como medido é o erro que
    // custou a conclusão de ontem.
    const estavel = isStableSign(c.playbook, history);
    if (here && here.decided >= threshold && estavel) {
      return { candidate: c, measuredNet: here.netPerTrade, unknown: false };
    }
    if (entry && entry.decided >= threshold && entry.netPerTrade != null && estavel) {
      return { candidate: c, measuredNet: entry.netPerTrade, unknown: false };
    }
    return { candidate: c, measuredNet: null, unknown: true };
  });

  // ⚠️ CORREÇÃO 03/08 — SEM NENHUMA MEDIÇÃO, A MESA NÃO OPERA.
  //
  // A primeira rodada do backtest voltou com TODOS os nove playbooks abaixo do
  // limiar (o maior tinha n=20). Nesse cenário a regra 2 sozinha entregava
  // todos os candidatos como DESCONHECIDO, na ordem declarada — ou seja, URÐR
  // escolheria exatamente o mesmo que o VÖLUNDR, tick após tick.
  //
  // Seria a contaminação do MÍMIR de novo, com outro nome: um "terceiro braço"
  // gravando trades idênticos ao controle e engordando o ledger com a mesma
  // decisão contada duas vezes. Dois números batendo perfeitamente pareceriam
  // confirmação quando seriam tautologia.
  //
  // A mesa existe para testar "seguir a evidência". Sem UMA evidência sequer,
  // ela não tem tese — e a resposta honesta é ficar de fora até o backtest
  // acumular amostra.
  if (scored.every((s) => s.unknown)) return [];

  const positivos = scored
    .filter((s) => !s.unknown && (s.measuredNet ?? 0) > 0)
    .sort((a, b) => (b.measuredNet ?? 0) - (a.measuredNet ?? 0));
  // Os desconhecidos mantêm a ordem em que chegaram, que já é a prioridade
  // declarada da biblioteca.
  const desconhecidos = scored.filter((s) => s.unknown);
  // Os medidos-negativos simplesmente não entram.
  return [...positivos, ...desconhecidos];
}
