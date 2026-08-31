"use client";

import { useEffect, useMemo, useState } from "react";
import { Droplet, DollarSign, Activity, Percent, Clock, Users } from "lucide-react";
import { compactNumber, formatPct } from "@/lib/format";
import type { PoolMeta } from "@/lib/api/geckoterminal";
import { lerParticipacao, idadeDaPool } from "@/lib/pro/participacao";

/**
 * Pro pool stats — TVL, 24h volume, 24h change, fee tier, vol/TVL ratio.
 * Polls /api/pool-meta every 60s so a pro can read the context of the
 * pair they're trading at a glance.
 */
export default function ProPoolStats({
  chain, pool, feeTier,
}: {
  chain:    string;
  pool:     string;
  feeTier?: string;
}) {
  const [meta, setMeta] = useState<PoolMeta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    async function load() {
      try {
        const res = await fetch(`/api/pool-meta?chain=${chain}&pool=${pool}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json() as { meta?: PoolMeta };
        if (cancelled) return;
        setMeta(body.meta ?? null);
      } catch {
        /* leave previous meta in place — pro UI prefers stable to flicker */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; ctrl.abort(); clearInterval(id); };
  }, [chain, pool]);

  // Vol / TVL turnover ratio — a pro signal for how active the pool is.
  // <0.1 = sleepy, 0.1-0.5 = healthy, >0.5 = hot.
  const turnover = meta && meta.tvlUsd > 0 ? meta.volume24h / meta.tvlUsd : null;

  const participacao = useMemo(() => lerParticipacao(meta), [meta]);
  const idade = useMemo(() => idadeDaPool(meta?.criadaEmMs ?? null), [meta]);

  /**
   * ⚠️ FDV SOBRE MARKET CAP — a razão que denuncia desbloqueio futuro. 3× quer
   * dizer que dois terços do supply ainda não circulam, e vão circular um dia.
   * `null` quando falta qualquer um dos dois: uma razão com metade dos dados é
   * um número inventado.
   */
  const razaoFdv = useMemo(() => {
    const mc = meta?.marketCapUsd, fdv = meta?.fdvUsd;
    if (mc == null || fdv == null || !(mc > 0)) return "";
    const r = fdv / mc;
    return r >= 1.15 ? `${r.toFixed(1)}× o mcap` : "";
  }, [meta]);

  return (
    <div className="rounded-lg border border-white/5 bg-black/40">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase inline-flex items-center gap-1.5">
          <Droplet className="w-3 h-3 text-cyan" />
          Pool Stats
        </span>
        <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">
          {loading ? "loading…" : "60s refresh"}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-white/[0.04]">
        <Cell Icon={DollarSign} label="TVL"      value={meta ? `$${compactNumber(meta.tvlUsd)}`    : "—"} />
        <Cell Icon={Activity}   label="Vol 24h"  value={meta ? `$${compactNumber(meta.volume24h)}` : "—"} />
        <Cell
          Icon={Percent}
          label="Turnover"
          value={turnover !== null ? `${(turnover * 100).toFixed(1)}%` : "—"}
          tone={
            turnover === null         ? undefined :
            turnover >  0.5           ? "green"   :
            turnover >= 0.1           ? "cyan"    :
                                        undefined
          }
          subtext={
            turnover === null         ? "" :
            turnover >  0.5           ? "hot"     :
            turnover >= 0.1           ? "healthy" :
                                        "sleepy"
          }
        />
        <Cell
          Icon={Percent}
          label="Δ 24h"
          value={meta ? formatPct(meta.change24h) : "—"}
          tone={meta ? (meta.change24h >= 0 ? "green" : "red") : undefined}
          subtext={
            meta?.change1h !== null && meta?.change1h !== undefined
              ? `1h ${formatPct(meta.change1h)}`
              : (feeTier ? `fee ${feeTier}` : "")
          }
        />
      </div>

      {/*
        ⚠️⚠️ SEGUNDA FILA — TUDO AQUI JÁ CHEGAVA NA MESMA RESPOSTA (31/08).
        `market_cap_usd`, `fdv_usd`, `pool_created_at` e `transactions.h24` são
        declarados em `GTPoolAttrs`, vêm no mesmo `fetch`, e o objeto de retorno
        os descartava. Zero requisição nova.
      */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-white/[0.04] border-t border-white/5">
        <Cell Icon={DollarSign} label="Market cap"
          value={meta?.marketCapUsd != null ? `$${compactNumber(meta.marketCapUsd)}` : "—"} />
        <Cell Icon={DollarSign} label="FDV"
          value={meta?.fdvUsd != null ? `$${compactNumber(meta.fdvUsd)}` : "—"}
          subtext={razaoFdv} />
        <Cell Icon={Clock} label="Idade da pool" value={idade ?? "—"} />
        <Cell Icon={Activity} label="Vol 1h"
          value={meta?.volume1h != null ? `$${compactNumber(meta.volume1h)}` : "—"} />
      </div>

      {/*
        ⚠️⚠️ A LINHA QUE NENHUM OUTRO PAINEL RESPONDE. O `ORDER FLOW` mostra
        VOLUME de compra contra venda — e volume não distingue mil carteiras
        comprando de uma carteira comprando mil vezes. `buyers`/`sellers` são
        carteiras ÚNICAS, e vinham de graça desde sempre.
      */}
      <div className="px-3 py-2 border-t border-white/5 flex items-center gap-2">
        <Users className="w-3 h-3 flex-shrink-0" style={{
          color: participacao.classe === "concentrado" ? "#F5A623"
               : participacao.classe === "sem_dado"    ? "rgba(255,255,255,0.35)"
               : "#00E8FF",
        }} />
        <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase flex-shrink-0">
          Carteiras 24h
        </span>
        <span className="font-mono text-[10px] text-ink-2 truncate">
          {participacao.leitura}
        </span>
      </div>
    </div>
  );
}

function Cell({
  Icon, label, value, tone, subtext,
}: {
  Icon:    React.ComponentType<{ className?: string }>;
  label:   string;
  value:   string;
  tone?:   "green" | "red" | "cyan";
  subtext?: string;
}) {
  const valCls =
    tone === "green" ? "text-green" :
    tone === "red"   ? "text-red"   :
    tone === "cyan"  ? "text-cyan"  : "text-ink";
  return (
    <div className="px-3 py-2.5">
      <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase inline-flex items-center gap-1">
        <Icon className="w-2.5 h-2.5 text-ink-4" />
        {label}
      </div>
      <div className={`font-display font-bold text-sm tabular-nums mt-0.5 ${valCls}`}>{value}</div>
      {subtext && (
        <div className="font-mono text-[9px] text-ink-4 tracking-wider uppercase mt-0.5">{subtext}</div>
      )}
    </div>
  );
}
