"use client";

import { useState } from "react";
import TerminalPanel from "../TerminalPanel";

type Finding = {
  id: string; name: string; category: string; severity: string;
  pass: boolean; detail: string; whyRuntime: string; inconclusive?: boolean;
  durationMs?: number; calls?: number;
};
type Report = {
  findings: Finding[];
  score: number; grade: string;
  passed: number; failed: number; inconclusive: number;
  blocking: Finding[];
  verdict: string; ranAt: string;
  totalMs: number; totalCalls: number;
};

const SEV_COLOR: Record<string, string> = {
  critical: "var(--adm-red)", high: "var(--adm-amber)",
  medium: "var(--adm-ink-3)", low: "var(--adm-ink-4)",
};
const SEV_LABEL: Record<string, string> = {
  critical: "CRÍTICO", high: "ALTO", medium: "MÉDIO", low: "BAIXO",
};

function icon(f: Finding): string {
  if (f.inconclusive) return "◌";   // não rodou — buraco, não aprovação
  return f.pass ? "✓" : "✕";
}
function color(f: Finding): string {
  if (f.inconclusive) return "var(--adm-amber)";
  return f.pass ? "var(--adm-green)" : "var(--adm-red)";
}

export default function AuditBenchPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const run = async () => {
    setRunning(true); setErr(null);
    try {
      // O que o NAVEGADOR realmente recebeu, assado no build. Precisa ser
      // escrito literal, uma chave por linha: o Next.js substitui
      // `process.env.NEXT_PUBLIC_X` por texto na hora de compilar, e uma leitura
      // dinâmica (`process.env[k]`) não é substituída — viria vazia e a bancada
      // acusaria uma dessincronia que não existe.
      //
      // O servidor compara isto com o que ele próprio lê. Divergência = build
      // desatualizado, que é invisível de qualquer outra forma: cada lado,
      // sozinho, está dizendo a verdade.
      const browserEnv = {
        NEXT_PUBLIC_SOLANA_TX_GUARD:       process.env.NEXT_PUBLIC_SOLANA_TX_GUARD ?? null,
        NEXT_PUBLIC_SOLANA_JITO:           process.env.NEXT_PUBLIC_SOLANA_JITO ?? null,
        NEXT_PUBLIC_ALLOWED_SWAP_TARGETS:  process.env.NEXT_PUBLIC_ALLOWED_SWAP_TARGETS ?? null,
        NEXT_PUBLIC_ALLOWED_SWAP_SPENDERS: process.env.NEXT_PUBLIC_ALLOWED_SWAP_SPENDERS ?? null,
        NEXT_PUBLIC_IMPACT_WARN_PCT:       process.env.NEXT_PUBLIC_IMPACT_WARN_PCT ?? null,
        NEXT_PUBLIC_IMPACT_BLOCK_PCT:      process.env.NEXT_PUBLIC_IMPACT_BLOCK_PCT ?? null,
      };
      const res = await fetch("/admin/api/audit-bench", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ browserEnv }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? json.error ?? res.status);
      setReport(json);
    } catch (e) { setErr(String(e)); }
    finally { setRunning(false); }
  };

  const gradeColor = !report ? "var(--adm-ink-3)"
    : report.score >= 9.5 ? "var(--adm-green)"
    : report.score >= 7 ? "var(--adm-amber)" : "var(--adm-red)";

  return (
    <TerminalPanel
      id="audit-bench"
      title="BANCADA DE AUDITORIA"
      subtitle="o que só o sistema vivo responde"
      icon="⚖"
      source="produção · banco · rede"
    >
      <div style={{ fontSize: 8, color: "var(--adm-ink-4)", lineHeight: 1.6, marginBottom: 8 }}>
        Verifica o que leitura de código não alcança: migration aplicada, RLS valendo na
        instância, rota de admin exposta, segredo em variável pública, endpoint de terceiro
        desligado. Inclui sondas de ATAQUE disparadas de fora contra a própria produção —
        reflexão de entrada, vazamento em erro, CORS, redirect aberto, rate limit, nonce.
        Só leitura, cargas inertes, volume mínimo: não escreve, não gasta token, não move fundo.
      </div>

      <button onClick={run} disabled={running}
        style={{ fontSize: 9, letterSpacing: "0.05em", padding: "6px 12px", borderRadius: 3,
          cursor: running ? "wait" : "pointer", color: "var(--adm-cyan)",
          background: "rgba(0 229 255 / 0.06)", border: "1px solid rgba(0 229 255 / 0.25)" }}>
        {running ? "auditando o sistema vivo…" : "⚖ rodar auditoria completa"}
      </button>

      {err && <div style={{ color: "var(--adm-red)", fontSize: 10, marginTop: 8 }}>{err}</div>}

      {report && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 26, color: gradeColor, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
              {report.score.toFixed(1)}
            </span>
            <span style={{ fontSize: 12, color: gradeColor }}>{report.grade}</span>
            <span style={{ fontSize: 8, color: "var(--adm-ink-4)" }}>
              {report.passed} ok · {report.failed} falhou{report.inconclusive > 0 ? ` · ${report.inconclusive} não rodou` : ""}
            </span>
          </div>

          {/* O RECIBO. "Rodou rápido demais pra ter testado algo" é desconfiança
              legítima — a resposta honesta é o cronômetro, não pedir confiança. */}
          <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginBottom: 8, lineHeight: 1.6 }}>
            {(report.totalMs / 1000).toFixed(1)}s de parede · {report.totalCalls} chamadas reais
            (rede + banco) · verificações rodam em PARALELO, por isso o total é menor
            que a soma das partes — abra cada linha para ver o tempo dela.
          </div>

          <div style={{
            fontSize: 9, padding: "6px 8px", borderRadius: 3, marginBottom: 8, lineHeight: 1.5,
            color: report.verdict.startsWith("🟢") ? "var(--adm-green)" : report.verdict.startsWith("🟡") ? "var(--adm-amber)" : "var(--adm-red)",
            background: "var(--adm-bg-raise)",
          }}>
            {report.verdict}
          </div>

          {report.findings.map((f) => {
            const isOpen = open === f.id;
            return (
              <div key={f.id} style={{
                marginBottom: 4, padding: "5px 7px", borderRadius: 3, cursor: "pointer",
                background: f.pass && !f.inconclusive ? "transparent" : "rgba(255 255 255 / 0.02)",
                borderLeft: `2px solid ${color(f)}`,
              }} onClick={() => setOpen(isOpen ? null : f.id)}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ color: color(f), fontSize: 10, width: 10 }}>{icon(f)}</span>
                  <span style={{ fontSize: 9, color: "var(--adm-ink-2)", flex: 1 }}>{f.name}</span>
                  <span style={{ fontSize: 7, color: SEV_COLOR[f.severity], letterSpacing: "0.06em" }}>
                    {SEV_LABEL[f.severity]}
                  </span>
                  <span style={{ fontSize: 7, color: "var(--adm-ink-4)" }}>{isOpen ? "▲" : "▼"}</span>
                </div>
                {/* Detalhe é evidência, não opinião — sempre visível quando falha. */}
                {(!f.pass || isOpen) && (
                  <div style={{ fontSize: 8, color: f.pass ? "var(--adm-ink-4)" : color(f), marginTop: 3, paddingLeft: 17, lineHeight: 1.5, wordBreak: "break-word" }}>
                    {f.detail}
                  </div>
                )}
                {isOpen && (
                  <>
                    <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginTop: 3, paddingLeft: 17, fontStyle: "italic", lineHeight: 1.5 }}>
                      por que só em execução: {f.whyRuntime}
                    </div>
                    <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginTop: 2, paddingLeft: 17, fontFamily: "monospace" }}>
                      {f.durationMs ?? 0}ms · {f.calls ?? 0} chamada(s){(f.calls ?? 0) === 0 ? " — só leitura de ambiente/memória" : ""}
                    </div>
                  </>
                )}
              </div>
            );
          })}

          <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginTop: 8, fontStyle: "italic", lineHeight: 1.6 }}>
            ◌ = não pôde rodar. Conta como buraco de cobertura, nunca como aprovação — é
            assim que uma auditoria mente sem mentir. Nota ponderada por severidade: um
            crítico reprovado não é diluído por dez aprovações cosméticas.
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
