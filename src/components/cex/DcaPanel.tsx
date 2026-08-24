"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Pause, Play, Square, AlertTriangle } from "lucide-react";
import { lerCiclos, porCiclo, MAX_CICLOS } from "@/lib/orders/plano";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { CexCredentials, CexId } from "@/lib/cex/types";

/**
 * DCA NA CORRETORA — planos que rodam SEM o usuário.
 * (`docs/PLANO-DCA-AUTOMATICO.md` D6)
 *
 * ⚠️⚠️ ESTA TELA PEDE UMA COISA QUE O RESTO DO CONSOLE NÃO PEDE.
 *
 * O console de CEX guarda as credenciais NO NAVEGADOR, atrás de senha e com
 * auto-lock de 10 minutos. Um plano de DCA não pode viver assim: o cron roda
 * quando o usuário está dormindo. Criar um plano significa entregar ao
 * servidor uma cópia CIFRADA da chave.
 *
 * Isso é um consentimento, não um detalhe de implementação — e por isso o
 * aviso é a PRIMEIRA coisa da tela, não um asterisco no rodapé.
 *
 * ⚠️ E A TELA DIZ QUE O CRON NÃO ESTÁ AGENDADO. Enquanto o job não existir no
 * cron-job.org, o plano fica salvo e NADA roda. Deixar isso implícito seria a
 * interface afirmando o que o sistema não faz — o padrão que as auditorias de
 * 23–24/08 acharam dez vezes.
 */

type Plano = {
  id: string; symbol: string; intervalo: string; status: string;
  modo: "simulado" | "real";
  ciclos_total: number; ciclos_feitos: number; ciclos_pulados: number;
  orcamento_total_usd: number; por_ciclo_usd: number; gasto_acumulado_usd: number;
  next_run_at: string; encerrado_por: string | null;
};
type Ciclo = {
  ciclo_numero: number; status: string; motivo: string | null;
  agendado_para: string; executado_em: string | null;
  preco: number | null; quantidade: number | null; custo_usd: number | null;
  simulado: boolean;
};

const INTERVALOS: { v: string; k: MessageKey }[] = [
  { v: "hourly",  k: "orders.freqHourly"  },
  { v: "daily",   k: "orders.freqDaily"   },
  { v: "weekly",  k: "orders.freqWeekly"  },
  { v: "monthly", k: "orders.freqMonthly" },
];

const COR_CICLO: Record<string, string> = {
  feito:     "text-green",
  pulado:    "text-gold",
  falhou:    "text-red",
  reservado: "text-cyan",
};

export default function DcaPanel({ exchangeId, credentials }: {
  exchangeId: CexId; credentials: CexCredentials;
}) {
  const t = useT();
  const [planos, setPlanos]   = useState<Plano[] | null>(null);
  const [ciclos, setCiclos]   = useState<Record<string, Ciclo[]>>({});
  const [aberto, setAberto]   = useState<string | null>(null);
  const [symbol, setSymbol]   = useState("BTC/USDT");
  const [orcamento, setOrcamento] = useState("");
  const [ciclosTxt, setCiclosTxt] = useState("12");
  const [intervalo, setIntervalo] = useState("daily");
  /**
   * ⚠️ NASCE SIMULADO. Trocar para dinheiro real é um clique deliberado, e o
   * servidor recusa qualquer valor que não seja exatamente "real" — campo
   * ausente ou typo não podem acabar comprando.
   */
  const [modo, setModo] = useState<"simulado" | "real">("simulado");
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/dca/planos");
      const j = await r.json();
      setPlanos(r.ok && Array.isArray(j.planos) ? j.planos : []);
    } catch {
      // ⚠️ `null` seguiria dizendo "carregando" para sempre; `[]` diria "não há
      // planos", que é AFIRMAR o que não se sabe. Um array vazio com erro na
      // tela é a única leitura honesta — e o toast é o erro.
      setPlanos([]);
      toast.error(t("common.error"));
    }
  }, [t]);

  useEffect(() => { void carregar(); }, [carregar]);

  const c = lerCiclos(ciclosTxt);
  const cada = c.ok ? porCiclo(orcamento, c.ciclos, 8) : null;
  const podeCriar = c.ok && Boolean(cada) && !criando;

  const motivoCiclos = (): string | null => {
    if (c.ok) return null;
    if (c.motivo === "vazio")        return t("orders.cyclesEmpty");
    if (c.motivo === "nao_inteiro")  return t("orders.cyclesNotInteger");
    if (c.motivo === "menor_que_um") return t("orders.cyclesTooSmall");
    return t("orders.cyclesTooMany", { max: String(MAX_CICLOS) });
  };

  const criar = async () => {
    if (!podeCriar) return;
    setCriando(true);
    try {
      const r = await fetch("/api/dca/planos", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          exchangeId, symbol, intervalo, modo,
          orcamentoTotalUsd: Number(orcamento), ciclosTotal: ciclosTxt,
          // ⚠️ A chave só viaja no modo REAL. No simulado o servidor nem a pede,
          // e mandar assim mesmo seria expor segredo sem necessidade.
          ...(modo === "real" ? { credentials: {
            apiKey: credentials.apiKey, apiSecret: credentials.apiSecret,
            passphrase: credentials.passphrase,
          } } : {}),
        }),
      });
      const j = await r.json();
      // ⚠️ Confere o corpo, não só o status: a rota devolve `ok:false` com 400
      // e 500, e tratar como sucesso deixaria o dono achando que criou.
      if (!r.ok || !j.ok) throw new Error(String(j.error ?? r.status));
      toast.success(modo === "real" ? t("cex.dcaCreated") : t("cex.dcaSimCreated"));
      setOrcamento("");
      await carregar();
    } catch (e) {
      toast.error(`${t("cex.dcaFailed")}: ${String(e).slice(0, 80)}`);
    } finally {
      setCriando(false);
    }
  };

  const agir = async (id: string, acao: string) => {
    if (acao === "encerrar" && !window.confirm(t("cex.dcaEndConfirm"))) return;
    try {
      const r = await fetch("/api/dca/planos", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, acao }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(String(j.error ?? r.status));
      await carregar();
    } catch (e) {
      toast.error(String(e).slice(0, 100));
    }
  };

  const verExtrato = async (id: string) => {
    if (aberto === id) { setAberto(null); return; }
    setAberto(id);
    if (ciclos[id]) return;
    try {
      const r = await fetch(`/api/dca/planos?plano=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (r.ok && Array.isArray(j.ciclos)) setCiclos((m) => ({ ...m, [id]: j.ciclos }));
    } catch { toast.error(t("common.error")); }
  };

  return (
    <div className="space-y-4">
      {/* ⚠️ O AVISO DO CRON VEM PRIMEIRO — enquanto o job não existe, nada roda. */}
      <div className="rounded-xl border border-red/25 bg-red/[0.05] px-3 py-2 flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-red flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-ink-2 leading-relaxed">{t("cex.dcaNotScheduled")}</p>
      </div>

      {/* ⚠️ O CONSENTIMENTO SÓ APARECE NO MODO REAL — porque só ali ele é
          verdade. Mostrá-lo no simulado seria pedir permissão para algo que
          não vai acontecer, e avisos que não se aplicam ensinam a ignorar
          avisos. */}
      {modo === "real" && (
        <div className="rounded-xl border border-gold/25 bg-gold/[0.05] p-3">
          <div className="font-display font-bold text-xs text-gold mb-1">{t("cex.dcaConsentTitle")}</div>
          <p className="font-sans text-[11px] text-ink-2 leading-relaxed">{t("cex.dcaConsentBody")}</p>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-bg-2/40 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-violet" />
          <span className="font-display font-bold text-sm text-ink">{t("cex.dcaTitle")}</span>
        </div>

        {/* ⚠️ O MODO VEM PRIMEIRO, antes de qualquer número. É a decisão que
            muda o significado de todo o resto do formulário. */}
        <Campo label={t("cex.dcaMode")}>
          <div className="grid grid-cols-2 gap-1.5">
            {(["simulado", "real"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setModo(m)}
                className={cn(
                  "px-3 py-2 rounded-lg border font-mono text-[11px] tracking-widest uppercase transition-colors",
                  modo === m
                    ? (m === "real" ? "border-red/40 bg-red/[0.08] text-red" : "border-cyan/40 bg-cyan/[0.08] text-cyan")
                    : "border-white/10 text-ink-4 hover:text-ink-3",
                )}>
                {t(m === "real" ? "cex.dcaModeReal" : "cex.dcaModeSim")}
              </button>
            ))}
          </div>
          <p className="font-sans text-[10px] text-ink-3 leading-relaxed mt-1.5">
            {t(modo === "real" ? "cex.dcaModeRealHelp" : "cex.dcaModeSimHelp")}
          </p>
        </Campo>

        <div className="grid grid-cols-2 gap-2">
          <Campo label={t("cex.dcaPair")}>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              className="w-full bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-ink outline-none focus:border-violet/30" />
          </Campo>
          <Campo label={t("cex.dcaEvery")}>
            <select value={intervalo} onChange={(e) => setIntervalo(e.target.value)}
              className="w-full bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-ink-2 uppercase tracking-widest">
              {INTERVALOS.map((i) => <option key={i.v} value={i.v}>{t(i.k)}</option>)}
            </select>
          </Campo>
          <Campo label={t("cex.dcaBudget")}>
            <input inputMode="decimal" value={orcamento} onChange={(e) => setOrcamento(e.target.value)}
              placeholder="0.00"
              className="w-full bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-ink outline-none focus:border-violet/30" />
          </Campo>
          <Campo label={t("cex.dcaCycles")}>
            {/* ⚠️ min/step presentes — a ausência deles foi um dos achados da
                auditoria de hoje na aba /orders. */}
            <input type="number" min={1} max={MAX_CICLOS} step={1} value={ciclosTxt}
              onChange={(e) => setCiclosTxt(e.target.value)}
              className="w-full bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-ink outline-none focus:border-violet/30" />
          </Campo>
        </div>

        {!c.ok && (
          <div className="rounded-lg border border-gold/25 bg-gold/[0.05] px-3 py-2 font-mono text-[11px] text-gold">
            {motivoCiclos()}
          </div>
        )}
        {cada && (
          <div className="font-mono text-[11px] text-violet">
            {t("cex.dcaPerCycle", { value: cada })}
          </div>
        )}

        <button onClick={criar} disabled={!podeCriar}
          className="w-full btn btn-primary py-3 text-sm tracking-widest disabled:opacity-40">
          {t("cex.dcaCreate")}
        </button>
      </div>

      {/* ── os planos ─────────────────────────────────────────────── */}
      {planos === null ? (
        <div className="font-mono text-[11px] text-ink-4">…</div>
      ) : planos.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-bg-2/30 p-4">
          <div className="font-display font-bold text-xs text-ink-2">{t("cex.dcaNone")}</div>
          {/* ⚠️ Invariante nº 33: vazio-por-ausência tem de ser distinguível de
              vazio-por-falha, e a tela DIZ qual dos dois é. */}
          <p className="font-mono text-[10px] text-ink-4 mt-1">{t("cex.dcaNoneHint")}</p>
        </div>
      ) : planos.map((p) => (
        <div key={p.id} className="rounded-xl border border-white/10 bg-bg-2/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-sm text-ink">{p.symbol}</span>
              {/* ⚠️ O SELO É PERMANENTE. O modo não muda depois de criado, então
                  ninguém confunde extrato simulado com compra que houve. */}
              <span className={cn("font-mono text-[9px] tracking-widest uppercase px-1.5 py-0.5 rounded border",
                p.modo === "real"
                  ? "text-red border-red/30 bg-red/5"
                  : "text-cyan border-cyan/30 bg-cyan/5")}>
                {t(p.modo === "real" ? "cex.dcaModeReal" : "cex.dcaModeSim")}
              </span>
            </div>
            <span className={cn("font-mono text-[9px] tracking-widest uppercase px-1.5 py-0.5 rounded border",
              p.status === "ativo"    ? "text-green border-green/30 bg-green/5"
              : p.status === "pausado" ? "text-gold border-gold/30 bg-gold/5"
              : "text-ink-3 border-white/10")}>
              {p.status}{p.encerrado_por ? ` · ${p.encerrado_por}` : ""}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-ink-3">
            <span>{t("cex.dcaDone", { done: String(p.ciclos_feitos), total: String(p.ciclos_total) })}</span>
            {/* ⚠️ PULADOS APARECEM SEMPRE que houver — somar com "feitos" daria
                um plano "completo" que comprou metade. */}
            {p.ciclos_pulados > 0 && (
              <span className="text-gold">{t("cex.dcaSkipped", { n: String(p.ciclos_pulados) })}</span>
            )}
            {/* ⚠️ "gastos" e "simulados" são frases DIFERENTES. Um plano
                simulado que dissesse "gastos" seria a tela afirmando uma
                compra que não houve. */}
            <span className={p.modo === "simulado" ? "text-cyan" : undefined}>
              {t(p.modo === "real" ? "cex.dcaSpent" : "cex.dcaSpentSim", {
                spent:  Number(p.gasto_acumulado_usd).toFixed(2),
                budget: Number(p.orcamento_total_usd).toFixed(2),
              })}
            </span>
            {p.status === "ativo" && (
              <span>{t("cex.dcaNext", { when: new Date(p.next_run_at).toLocaleString() })}</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {p.status === "ativo" && (
              <Acao onClick={() => agir(p.id, "pausar")} Icon={Pause} label={t("cex.dcaPause")} />
            )}
            {p.status === "pausado" && (
              <Acao onClick={() => agir(p.id, "retomar")} Icon={Play} label={t("cex.dcaResume")} />
            )}
            {(p.status === "ativo" || p.status === "pausado") && (
              <Acao onClick={() => agir(p.id, "encerrar")} Icon={Square} label={t("cex.dcaEnd")} tone="red" />
            )}
            <button onClick={() => verExtrato(p.id)}
              className="px-2 py-1 rounded-md border border-white/10 text-ink-3 hover:text-ink-2 font-mono text-[10px] tracking-widest uppercase">
              {t("cex.dcaStatement")}
            </button>
          </div>

          {aberto === p.id && (
            <div className="border-t border-white/5 pt-2 space-y-1 max-h-56 overflow-y-auto">
              {(ciclos[p.id] ?? []).length === 0 ? (
                <div className="font-mono text-[10px] text-ink-4">{t("cex.dcaNoneHint")}</div>
              ) : ciclos[p.id].map((cy) => (
                <div key={cy.ciclo_numero} className="flex items-center gap-2 font-mono text-[10px]">
                  <span className="text-ink-4 w-8">#{cy.ciclo_numero}</span>
                  <span className={cn("w-20", COR_CICLO[cy.status] ?? "text-ink-3")}>
                    {t(`cex.dcaCycle${cy.status === "feito" ? "Done" : cy.status === "pulado" ? "Skipped" : cy.status === "falhou" ? "Failed" : "Reserved"}` as MessageKey)}
                  </span>
                  {cy.simulado && (
                    <span className="text-cyan text-[9px] tracking-widest uppercase">sim</span>
                  )}
                  <span className="text-ink-3 flex-1 truncate">
                    {cy.status === "feito" && cy.custo_usd != null
                      ? `${Number(cy.quantidade ?? 0)} @ ${Number(cy.preco ?? 0)} = $${Number(cy.custo_usd).toFixed(2)}`
                      : cy.motivo ?? new Date(cy.agendado_para).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1">{label}</div>
      {children}
    </div>
  );
}

function Acao({ onClick, Icon, label, tone }: {
  onClick: () => void; Icon: React.ComponentType<{ className?: string }>; label: string; tone?: "red";
}) {
  return (
    <button onClick={onClick} className={cn(
      "inline-flex items-center gap-1 px-2 py-1 rounded-md border font-mono text-[10px] tracking-widest uppercase",
      tone === "red" ? "border-red/30 text-red hover:bg-red/[0.06]" : "border-cyan/30 text-cyan hover:bg-cyan/[0.06]",
    )}>
      <Icon className="w-3 h-3" />{label}
    </button>
  );
}
