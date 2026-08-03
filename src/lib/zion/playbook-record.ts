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
}

export interface PlaybookRecord {
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
export async function savePlaybookRecord(record: PlaybookRecord): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  try {
    const { error } = await db.from("admin_kv").upsert(
      { key: RECORD_KEY, value: JSON.stringify(record), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    return !error;
  } catch { return false; }
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
    if (here && here.decided >= threshold) {
      return { candidate: c, measuredNet: here.netPerTrade, unknown: false };
    }
    if (entry && entry.decided >= threshold && entry.netPerTrade != null) {
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
