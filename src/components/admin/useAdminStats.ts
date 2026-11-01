"use client";

import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "./useAutoRefresh";
import type { RefreshScope } from "./AdminRealtimeProvider";
import type { EstadoResposta, OperationalMetric } from "@/lib/admin/metrica";

// Stable array identity — tier changes shift the distribution, so listen to both.
const STATS_SCOPES: RefreshScope[] = ["stats", "tier"];

type M<T> = OperationalMetric<T>;
export type StatsData = {
  estado: EstadoResposta;
  wallets: { total: M<number>; active7d: M<number>; active30d: M<number>; chainSplit: M<Record<string, number>> };
  tiers: { distribution: M<Record<string, number>> };
  autopilot: { sessions: M<number>; sessionsActive: M<number>; totalRuns: M<number>; pnlToday: M<number>; volumeTotal: M<number> };
  cex: { byExchange: M<Record<string, { total: number; active: number }>> };
  fetchedAt: string;
};

type State =
  | { status: "loading" }
  | { status: "ok"; data: StatsData; secondsAgo: number; refreshing: boolean; refresh: () => void }
  | { status: "error"; message: string; refresh: () => void };

/**
 * ⚠️ UMA BUSCA PARA OS QUATRO PAINÉIS (R3, Admin CC 2.0). Carteiras, planos, autopilot e
 * sessões CEX usavam este hook cada um com o SEU fetch — 4 leituras idênticas por minuto.
 * Agora o resultado é compartilhado no módulo: quem chega durante uma busca espera a mesma;
 * outra só sai depois de um intervalo mínimo (ou num "atualizar" explícito).
 *
 * ⚠️ Erro ZERA o dado (`data = null`): mostrar o número velho como atual depois de uma falha
 * é a mentira que o contrato de verdade existe para impedir.
 */
type Compartilhado = { data: StatsData | null; error: string | null; versao: number };
let atual: Compartilhado = { data: null, error: null, versao: 0 };
let emVoo: Promise<void> | null = null;
let ultimaBusca = 0;
const ouvintes = new Set<() => void>();
const MIN_ENTRE_BUSCAS_MS = 2_000;

export async function buscarStats(forcar = false): Promise<void> {
  if (emVoo) return emVoo;
  if (!forcar && ultimaBusca > 0 && Date.now() - ultimaBusca < MIN_ENTRE_BUSCAS_MS) return;
  emVoo = (async () => {
    try {
      const res = await fetch("/admin/api/stats", { cache: "no-store" });
      const json = await res.json().catch(() => null) as (StatsData & { error?: string }) | null;
      // 503 com o corpo de métricas ainda informa (fontes INDISPONÍVEIS); sem corpo, é erro.
      if (json && json.wallets && json.autopilot) atual = { data: json, error: null, versao: atual.versao + 1 };
      else atual = { data: null, error: `${res.status}${json?.error ? ` ${json.error}` : ""}`, versao: atual.versao + 1 };
    } catch (e) {
      atual = { data: null, error: String(e), versao: atual.versao + 1 };
    } finally {
      ultimaBusca = Date.now();
      emVoo = null;
      for (const f of ouvintes) f();
    }
  })();
  return emVoo;
}

/** Só para testes. */
export function _zerarStatsCompartilhado(): void {
  atual = { data: null, error: null, versao: 0 }; emVoo = null; ultimaBusca = 0; ouvintes.clear();
}

export function useAdminStats(): State {
  const [, setVersao] = useState(atual.versao);
  useEffect(() => {
    const f = () => setVersao(atual.versao);
    ouvintes.add(f);
    return () => { ouvintes.delete(f); };
  }, []);

  const load = useCallback(() => buscarStats(), []);
  const { secondsAgo, refreshing, forceRefresh } = useAutoRefresh({
    intervalMs: 60_000,
    onRefresh: load,
    scopes: STATS_SCOPES,
  });
  const refresh = useCallback(() => { void buscarStats(true).then(forceRefresh); }, [forceRefresh]);

  if (!atual.data && !atual.error) return { status: "loading" };
  if (!atual.data)                 return { status: "error", message: atual.error ?? "erro", refresh };
  return { status: "ok", data: atual.data, secondsAgo, refreshing, refresh };
}
