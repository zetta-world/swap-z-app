"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import {
  X, Download, FileJson, FileText, Printer, Check, CheckCheck, Eraser,
} from "lucide-react";
import {
  TX_TYPE_LABELS_PT, STATUS_LABELS_PT, type TxHistoryEntry,
} from "@/lib/store/txHistory";
import { useTierAccent } from "@/components/tier/TierAccentProvider";
import { GOD_META, isPaidTier } from "@/lib/tier/gods";
import { cn } from "@/lib/cn";

/** Branding applied to the printable PDF — driven by the active god/tier. */
interface PrintTheme {
  accent:   string;
  gradient: string;
  glow:     string;
  god:      string | null;
  epithet:  string | null;
  rune:     string;
  watermark:string;
}

type ExportFormat = "csv" | "json" | "pdf";
type Scope        = "filtered" | "all";

type FieldKey =
  | "date" | "type" | "status" | "from" | "to"
  | "fromAmount" | "toAmount" | "valueUsd" | "feesUsd" | "pnlUsd"
  | "exchange" | "route" | "txHash" | "orderId" | "leverage" | "notes";

const FIELDS: { key: FieldKey; label: string; jsonKey: string }[] = [
  { key: "date",       label: "Data / Hora",    jsonKey: "data"          },
  { key: "type",       label: "Tipo",           jsonKey: "tipo"          },
  { key: "status",     label: "Status",         jsonKey: "status"        },
  { key: "from",       label: "De (token/rede)",jsonKey: "de"            },
  { key: "to",         label: "Para (token/rede)", jsonKey: "para"       },
  { key: "fromAmount", label: "Qtd. enviada",   jsonKey: "qtdEnviada"    },
  { key: "toAmount",   label: "Qtd. recebida",  jsonKey: "qtdRecebida"   },
  { key: "valueUsd",   label: "Valor (USD)",    jsonKey: "valorUsd"      },
  { key: "feesUsd",    label: "Taxas (USD)",    jsonKey: "taxasUsd"      },
  { key: "pnlUsd",     label: "P&L (USD)",      jsonKey: "pnlUsd"        },
  { key: "exchange",   label: "Exchange",       jsonKey: "exchange"      },
  { key: "route",      label: "Rota",           jsonKey: "rota"          },
  { key: "txHash",     label: "Hash",           jsonKey: "hash"          },
  { key: "orderId",    label: "Order ID",       jsonKey: "orderId"       },
  { key: "leverage",   label: "Alavancagem",    jsonKey: "alavancagem"   },
  { key: "notes",      label: "Notas",          jsonKey: "notas"         },
];

// Sensible default selection — the columns most clients care about.
const DEFAULT_FIELDS: FieldKey[] = [
  "date", "type", "status", "from", "to", "valueUsd", "feesUsd", "pnlUsd",
];

interface Props {
  open:        boolean;
  onClose:     () => void;
  filtered:    TxHistoryEntry[];   // entries matching current filters
  all:         TxHistoryEntry[];   // all entries
}

export default function HistoryExportModal({ open, onClose, filtered, all }: Props) {
  const [format, setFormat]   = useState<ExportFormat>("csv");
  const [scope,  setScope]    = useState<Scope>("filtered");
  const [fields, setFields]   = useState<FieldKey[]>(DEFAULT_FIELDS);

  const { tier, accentColor, glowColor, active } = useTierAccent();

  const rows = scope === "filtered" ? filtered : all;
  const selectedFields = useMemo(() => FIELDS.filter((f) => fields.includes(f.key)), [fields]);

  // The PDF inherits the member's god identity — gold FREYR, violet THOR,
  // prismatic ODIN — falling back to neutral Z-SWAP cyan on the free tier.
  const theme: PrintTheme = useMemo(() => {
    if (active && isPaidTier(tier)) {
      const g = GOD_META[tier];
      const gradient =
        tier === "pro"    ? "linear-gradient(120deg, #F5A623, #C9A955)" :
        tier === "trader" ? "linear-gradient(120deg, #9F5FFF, #7C3AED)" :
                            "linear-gradient(120deg, #00E8FF, #9F5FFF, #F5A623)";
      return {
        accent: accentColor, gradient, glow: glowColor,
        god: g.god, epithet: g.epithet, rune: g.rune, watermark: g.rune,
      };
    }
    return {
      accent: "#00E8FF",
      gradient: "linear-gradient(120deg, #00E8FF, #0891B2)",
      glow: "rgba(0,232,255,0.35)",
      god: null, epithet: null, rune: "Z", watermark: "Z",
    };
  }, [active, tier, accentColor, glowColor]);

  function toggleField(k: FieldKey) {
    setFields((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  function handleExport() {
    if (rows.length === 0 || selectedFields.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "pdf") {
      const win = window.open("", "_blank");
      if (!win) return;
      win.document.write(buildPrintHtml(rows, selectedFields, stamp, theme));
      win.document.close();
      win.focus();
      setTimeout(() => { win.print(); }, 400);
      onClose();
      return;
    }

    const filename = `zswap-historico-${stamp}.${format}`;

    if (format === "json") {
      const data = rows.map((e) => {
        const obj: Record<string, unknown> = {};
        for (const f of selectedFields) obj[f.jsonKey] = rawValue(e, f.key);
        return obj;
      });
      downloadFile(JSON.stringify(data, null, 2), "application/json", filename);
    } else {
      const header = selectedFields.map((f) => f.label);
      const body   = rows.map((e) => selectedFields.map((f) => csvEscape(cellValue(e, f.key))));
      const bom    = "﻿"; // Excel UTF-8
      const csv    = bom + [header, ...body].map((r) => r.join(",")).join("\r\n");
      downloadFile(csv, "text/csv", filename);
    }
    onClose();
  }

  const canExport = rows.length > 0 && selectedFields.length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-bg/80 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[95%] max-w-lg -translate-x-1/2 -translate-y-1/2 outline-none">
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="god-card rounded-2xl border border-white/10 glass-strong overflow-hidden max-h-[88vh] flex flex-col"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/5 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan/10 border border-cyan/20 flex items-center justify-center flex-shrink-0">
                <Download className="w-4 h-4 text-cyan" />
              </div>
              <div className="flex-1 min-w-0">
                <Dialog.Title className="font-display font-extrabold text-base text-ink leading-none">
                  Exportar histórico
                </Dialog.Title>
                <p className="font-mono text-[10px] text-ink-4 mt-1 tracking-wide">
                  Escolha o conteúdo e o formato — gerado no seu dispositivo.
                </p>
              </div>
              <Dialog.Close className="text-ink-3 hover:text-ink transition-colors p-1 -mr-1">
                <X className="w-4 h-4" />
              </Dialog.Close>
            </div>

            <div className="overflow-y-auto px-5 py-4 space-y-5">
              {/* Scope */}
              <Section title="Alcance">
                <div className="grid grid-cols-2 gap-2">
                  <ChoiceCard
                    active={scope === "filtered"}
                    onClick={() => setScope("filtered")}
                    title="Filtros atuais"
                    sub={`${filtered.length} operação${filtered.length !== 1 ? "ões" : ""}`}
                  />
                  <ChoiceCard
                    active={scope === "all"}
                    onClick={() => setScope("all")}
                    title="Tudo"
                    sub={`${all.length} operação${all.length !== 1 ? "ões" : ""}`}
                  />
                </div>
              </Section>

              {/* Format */}
              <Section title="Formato">
                <div className="grid grid-cols-3 gap-2">
                  <ChoiceCard
                    active={format === "csv"}
                    onClick={() => setFormat("csv")}
                    title="CSV"
                    sub="Excel / Planilhas"
                    icon={<FileText className="w-3.5 h-3.5" />}
                  />
                  <ChoiceCard
                    active={format === "json"}
                    onClick={() => setFormat("json")}
                    title="JSON"
                    sub="Dados estruturados"
                    icon={<FileJson className="w-3.5 h-3.5" />}
                  />
                  <ChoiceCard
                    active={format === "pdf"}
                    onClick={() => setFormat("pdf")}
                    title="PDF"
                    sub="Imprimir / Salvar"
                    icon={<Printer className="w-3.5 h-3.5" />}
                  />
                </div>
              </Section>

              {/* Fields */}
              <Section
                title={`Colunas · ${fields.length}/${FIELDS.length}`}
                action={
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setFields(FIELDS.map((f) => f.key))}
                      className="font-mono text-[9px] text-ink-3 hover:text-cyan flex items-center gap-1 transition-colors"
                    >
                      <CheckCheck className="w-3 h-3" /> Tudo
                    </button>
                    <span className="text-ink-5">·</span>
                    <button
                      onClick={() => setFields([])}
                      className="font-mono text-[9px] text-ink-3 hover:text-red flex items-center gap-1 transition-colors"
                    >
                      <Eraser className="w-3 h-3" /> Limpar
                    </button>
                  </div>
                }
              >
                <div className="grid grid-cols-2 gap-1.5">
                  {FIELDS.map((f) => {
                    const on = fields.includes(f.key);
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => toggleField(f.key)}
                        className={cn(
                          "flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-all",
                          on
                            ? "bg-cyan/[0.07] border-cyan/30"
                            : "bg-white/[0.02] border-white/5 hover:border-white/10",
                        )}
                      >
                        <span className={cn(
                          "w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors",
                          on ? "bg-cyan border-cyan" : "border-white/15",
                        )}>
                          {on && <Check className="w-3 h-3 text-bg" strokeWidth={3} />}
                        </span>
                        <span className={cn("font-sans text-[11px] truncate", on ? "text-ink" : "text-ink-3")}>
                          {f.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Section>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-white/5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[10px] text-ink-4 tracking-wide">
                  {rows.length} linha{rows.length !== 1 ? "s" : ""} · {fields.length} coluna{fields.length !== 1 ? "s" : ""}
                </div>
              </div>
              <button
                onClick={handleExport}
                disabled={!canExport}
                className={cn(
                  "btn py-2.5 px-5 text-xs gap-2 font-bold",
                  canExport
                    ? "btn-primary"
                    : "opacity-40 cursor-not-allowed border border-white/10 text-ink-4",
                )}
              >
                {format === "pdf" ? <Printer className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                {format === "pdf" ? "Gerar PDF" : `Baixar ${format.toUpperCase()}`}
              </button>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function ChoiceCard({
  active, onClick, title, sub, icon,
}: {
  active: boolean; onClick: () => void; title: string; sub: string; icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border px-3 py-2.5 text-left transition-all",
        active
          ? "bg-cyan/[0.08] border-cyan/40"
          : "bg-white/[0.02] border-white/5 hover:border-white/15",
      )}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        {icon && <span className={active ? "text-cyan" : "text-ink-3"}>{icon}</span>}
        <span className={cn("font-display font-bold text-sm", active ? "text-ink" : "text-ink-2")}>{title}</span>
      </div>
      <div className="font-mono text-[9px] text-ink-4">{sub}</div>
    </button>
  );
}

// ─── Data extraction ─────────────────────────────────────────────────────

function rawValue(e: TxHistoryEntry, k: FieldKey): unknown {
  switch (k) {
    case "date":       return new Date(e.ts).toISOString();
    case "type":       return TX_TYPE_LABELS_PT[e.type];
    case "status":     return STATUS_LABELS_PT[e.status];
    case "from":       return `${e.fromSymbol} (${e.fromChain})`;
    case "to":         return `${e.toSymbol} (${e.toChain})`;
    case "fromAmount": return e.fromAmount ?? null;
    case "toAmount":   return e.toAmount ?? null;
    case "valueUsd":   return e.valueUsd ?? null;
    case "feesUsd":    return e.feesUsd ?? null;
    case "pnlUsd":     return e.pnlUsd ?? null;
    case "exchange":   return e.exchange ?? null;
    case "route":      return e.route ?? null;
    case "txHash":     return e.txHash ?? null;
    case "orderId":    return e.orderId ?? null;
    case "leverage":   return e.leverage ?? null;
    case "notes":      return e.notes ?? null;
  }
}

function cellValue(e: TxHistoryEntry, k: FieldKey): string {
  const v = rawValue(e, k);
  if (v === null || v === undefined) return "";
  return String(v);
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function buildPrintHtml(
  rows: TxHistoryEntry[],
  fields: { key: FieldKey; label: string }[],
  stamp: string,
  theme: PrintTheme,
): string {
  const headerRow = fields.map((f) => `<th>${esc(f.label)}</th>`).join("");
  const bodyRows  = rows.map((e) =>
    `<tr>${fields.map((f) => `<td>${esc(cellValue(e, f.key))}</td>`).join("")}</tr>`
  ).join("\n");

  const opsCount = `${rows.length} operação${rows.length !== 1 ? "ões" : ""}`;
  const colCount = `${fields.length} coluna${fields.length !== 1 ? "s" : ""}`;

  // Identity line: god + epithet for paid tiers, generic for free.
  const crest = theme.god
    ? `<div class="crest-god">${esc(theme.god)}</div>
       <div class="crest-epithet">${esc(theme.epithet ?? "")}</div>`
    : `<div class="crest-god">Z-SWAP</div>
       <div class="crest-epithet">MEMBERSHIP</div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Z-SWAP · Histórico ${stamp}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 11px; color: #0f1117; background: #fff; }

  /* ── Crest header — the god's banner ───────────────────────────────── */
  .crest {
    position: relative; overflow: hidden;
    background: #0a0c14; color: #fff;
    padding: 26px 28px 22px;
    display: flex; align-items: center; gap: 18px;
    border-bottom: 3px solid transparent;
    border-image: ${theme.gradient} 1;
  }
  .crest::after {
    content: ""; position: absolute; inset: 0;
    background: ${theme.gradient}; opacity: 0.10; pointer-events: none;
  }
  .crest-rune {
    font-size: 56px; line-height: 1; font-weight: 700;
    width: 78px; height: 78px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    border-radius: 16px;
    background: ${theme.gradient};
    color: #0a0c14;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.14) inset;
  }
  .crest-text { flex: 1; min-width: 0; position: relative; z-index: 1; }
  .crest-god { font-size: 22px; font-weight: 800; letter-spacing: 0.18em; line-height: 1.05; }
  .crest-epithet { font-size: 9px; letter-spacing: 0.42em; opacity: 0.6; margin-top: 5px; }
  .crest-title { font-size: 11px; letter-spacing: 0.05em; opacity: 0.85; margin-top: 12px; }
  .crest-meta {
    text-align: right; font-size: 9px; letter-spacing: 0.06em;
    opacity: 0.7; line-height: 1.7; position: relative; z-index: 1; white-space: nowrap;
  }
  .crest-meta b { color: ${theme.accent}; font-weight: 700; }

  /* ── Table ─────────────────────────────────────────────────────────── */
  .wrap { padding: 22px 24px 0; }
  table { width: 100%; border-collapse: collapse; }
  thead tr { background: #11141f; color: #fff; }
  th {
    padding: 8px 9px; text-align: left; font-weight: 700; font-size: 9px;
    letter-spacing: 0.06em; text-transform: uppercase;
    border-bottom: 2px solid ${theme.accent};
  }
  td { padding: 6px 9px; border-bottom: 1px solid #e8eaf0; vertical-align: top; }
  tr:nth-child(even) td { background: #f7f8fb; }

  /* ── Footer ────────────────────────────────────────────────────────── */
  .foot {
    margin: 18px 24px 0; padding: 12px 0 22px;
    border-top: 1px solid #e8eaf0;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 8px; letter-spacing: 0.08em; color: #8a90a6; text-transform: uppercase;
  }
  .foot-mark { font-weight: 800; color: ${theme.accent}; letter-spacing: 0.22em; }

  @media print {
    @page { margin: 0; }
    .crest { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="crest">
    <div class="crest-rune">${esc(theme.rune)}</div>
    <div class="crest-text">
      ${crest}
      <div class="crest-title">Histórico de Operações</div>
    </div>
    <div class="crest-meta">
      Emitido<br/><b>${esc(stamp)}</b><br/>
      ${esc(opsCount)}<br/>${esc(colCount)}
    </div>
  </div>

  <div class="wrap">
    <table>
      <thead><tr>${headerRow}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </div>

  <div class="foot">
    <span class="foot-mark">Z-SWAP</span>
    <span>Documento gerado no dispositivo · dados nunca enviados a servidores</span>
  </div>
</body>
</html>`;
}

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadFile(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
