"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

type Infra = { key: string; label: string; usdPerMonth: number; updatedAt: string | null; staleDays: number | null };
type Report = {
  mrrUsd: number | null; aiMonthlyUsd: number;
  infra: Infra[]; infraMonthlyUsd: number; totalCostUsd: number;
  marginUsd: number | null; marginPct: number | null;
  verdict: string; incomplete: boolean;
  tierCounts: Record<string, number>;
  cashUsd: number | null; runwayMonths: number | null;
};

const usd = (n: number) => `$${n.toFixed(2)}`;

export default function MarginPanel() {
  const [d, setD] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/margin");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json); setErr(null);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (key: string) => {
    const n = Number(draft.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return;
    await fetch("/admin/api/margin", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, usd: n }),
    }).catch(() => {});
    setEdit(null); setDraft(""); await load();
  };

  const row = (key: string, label: string, value: number, meta?: string, stale?: boolean) => (
    <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 9, padding: "3px 0" }}>
      <span style={{ color: "var(--adm-ink-3)", flex: 1 }}>
        {label}
        {meta && <span style={{ fontSize: 7, color: stale ? "var(--adm-amber)" : "var(--adm-ink-4)" }}> · {meta}</span>}
      </span>
      {edit === key ? (
        <>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") save(key); if (e.key === "Escape") setEdit(null); }}
            style={{ width: 70, fontSize: 9, padding: "1px 4px", background: "var(--adm-bg)", color: "var(--adm-cyan)",
              border: "1px solid var(--adm-cyan)", borderRadius: 2, fontFamily: "monospace" }} />
          <button onClick={() => save(key)} style={{ fontSize: 8, color: "var(--adm-green)", background: "none", border: "none", cursor: "pointer" }}>✓</button>
        </>
      ) : (
        <span onClick={() => { setEdit(key); setDraft(String(value)); }}
          title="toque p/ editar"
          style={{ color: "var(--adm-ink-2)", fontVariantNumeric: "tabular-nums", cursor: "pointer", borderBottom: "1px dotted var(--adm-ink-4)" }}>
          {usd(value)}
        </span>
      )}
    </div>
  );

  return (
    <TerminalPanel id="margin" title="MARGEM" subtitle="receita − custos · a conta que decide se a empresa vive" icon="📊" source="admin_kv + eventos de IA">
      {loading && <div className="adm-shimmer" style={{ height: 90 }} />}
      {err && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{err}</div>}

      {d && (
        <div>
          <div style={{
            fontSize: 10, padding: "7px 9px", borderRadius: 3, marginBottom: 10, lineHeight: 1.5,
            color: d.verdict.startsWith("🟢") ? "var(--adm-green)" : d.verdict.startsWith("🟡") ? "var(--adm-amber)" : "var(--adm-red)",
            background: "var(--adm-bg-raise)",
          }}>
            {d.verdict}
          </div>

          <div className="adm-category">Receita mensal recorrente</div>
          <div style={{ fontSize: 9, color: "var(--adm-ink-3)", padding: "3px 0", lineHeight: 1.6 }}>
            {d.mrrUsd === null ? (
              <>
                <span style={{ color: "var(--adm-amber)" }}>ainda não existe</span> — os passes vendidos são
                receita ÚNICA, não recorrente. Transformar venda única em MRR seria inventar receita, então
                fica nulo até haver plano de assinatura.
              </>
            ) : usd(d.mrrUsd)}
          </div>

          <div className="adm-category" style={{ marginTop: 8 }}>Custos mensais</div>
          {row("__ai", "IA (modelos) · medido", d.aiMonthlyUsd, "últimos 30 dias, real")}
          {d.infra.map((i) => row(
            i.key, i.label, i.usdPerMonth,
            i.updatedAt === null ? "nunca preenchido" : `atualizado há ${i.staleDays}d`,
            i.updatedAt === null || (i.staleDays ?? 0) > 45,
          ))}
          <div style={{ display: "flex", gap: 8, fontSize: 10, padding: "5px 0", borderTop: "1px solid var(--adm-border)", marginTop: 4 }}>
            <span style={{ color: "var(--adm-ink-2)", flex: 1 }}>TOTAL</span>
            <span style={{ color: "var(--adm-red)", fontVariantNumeric: "tabular-nums" }}>{usd(d.totalCostUsd)}/mês</span>
          </div>

          <div className="adm-category" style={{ marginTop: 8 }}>Caixa e fôlego</div>
          {row("cash_reserve_usd", "Reserva em caixa", d.cashUsd ?? 0, d.cashUsd === null ? "não informado" : undefined, d.cashUsd === null)}
          <div style={{ fontSize: 9, color: "var(--adm-ink-3)", padding: "3px 0" }}>
            Fôlego: {d.runwayMonths === null
              ? <span style={{ color: "var(--adm-ink-4)" }}>—</span>
              : <span style={{ color: d.runwayMonths < 6 ? "var(--adm-red)" : "var(--adm-ink-2)" }}>{d.runwayMonths} meses</span>}
          </div>

          {d.incomplete && (
            <div style={{ fontSize: 8, color: "var(--adm-amber)", marginTop: 8, lineHeight: 1.5 }}>
              ⚠ Algum custo de infra nunca foi preenchido — a margem acima é um TETO otimista,
              não um resultado. Toque num valor para editar.
            </div>
          )}
          <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginTop: 8, fontStyle: "italic", lineHeight: 1.6 }}>
            Infra é entrada manual de propósito: integrar faturamento de Vercel e Supabase seria mais
            bonito e muito mais frágil. Um número digitado uma vez por mês é chato e confiável — e a data
            fica visível, para que um valor velho se denuncie sozinho em vez de mentir calado.
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
