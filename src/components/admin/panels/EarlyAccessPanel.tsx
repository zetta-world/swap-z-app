"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";
import { useAdminConfirm } from "../useAdminConfirm";
import { ESTADOS, transicoesDisponiveis, exigeMotivo, type Estado } from "@/lib/early-access/estados";
import { UltimaRequisicao } from "@/lib/early-access/ultima-requisicao";

/**
 * EARLY ACCESS — a lista PÚBLICA de interessados.
 *
 * ⚠️ NÃO É O PAINEL `WHITELIST` (que mostra `ADMIN_WALLETS`). São coisas
 * diferentes com nomes parecidos, e por isso este se chama early access.
 *
 * ⚠️ O BOTÃO SÓ DIZ "FEITO" QUANDO O BANCO DISSE. A transição volta do
 * servidor com `mudou: true` e o par de/para que a RPC gravou junto com o
 * evento de audit; qualquer outra resposta aparece como erro, com o código.
 */
type Linha = {
  id: string; email_normalized: string; display_name: string; country: string;
  status: Estado; status_reason: string | null;
  wallet_address: string | null; wallet_chain: string | null;
  converted_at: string | null; email_verified_at: string | null;
  referral_flag: string | null; utm_source: string | null; created_at: string;
};
type Evento = { id: string; kind: string; from_status: string | null; to_status: string | null; actor: string; reason: string | null; created_at: string };
type Gate = { aberto: boolean; motivos: string[] };
type Metricas = { total: number; ultimas24h: number; ultimos7d: number; porStatus: Record<Estado, number> };

const COR: Record<Estado, string> = {
  pending: "var(--adm-amber)", approved: "var(--adm-green)", rejected: "var(--adm-ink-3)", blocked: "var(--adm-red)",
};

export default function EarlyAccessPanel() {
  const [linhas, setLinhas]   = useState<Linha[]>([]);
  const [total, setTotal]     = useState(0);
  const [gate, setGate]       = useState<Gate | null>(null);
  const [m, setM]             = useState<Metricas | null>(null);
  const [status, setStatus]   = useState<"" | Estado>("");
  // `qDigitado` é o campo; `q` é o filtro APLICADO (no Enter / BUSCAR).
  // Buscar a cada tecla dispararia uma requisição por caractere.
  const [qDigitado, setQDigitado] = useState("");
  const [q, setQ]             = useState("");
  const [recarga, setRecarga] = useState(0);
  const [err, setErr]         = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [aberta, setAberta]   = useState<string | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [motivo, setMotivo]   = useState("");
  const [aviso, setAviso]     = useState<string | null>(null);
  const realtime = useAdminRealtime();
  const { confirm, modal } = useAdminConfirm();
  // F-07: a leitura de eventos é disparada por clique; só a ÚLTIMA escreve.
  const [leituraEventos] = useState(() => new UltimaRequisicao());
  useEffect(() => () => leituraEventos.cancelar(), [leituraEventos]);

  /** Pede uma nova leitura da lista. Usado pelo realtime e após transição. */
  const recarregar = useCallback(() => setRecarga((n) => n + 1), []);

  // Reconectar ao realtime pode ter perdido pings: relê quando o canal entra
  // ou sai do ar. Booleano, e não o status cru, para "connecting"→"off" (sem
  // realtime configurado) não custar uma segunda requisição.
  const aoVivo = realtime?.status === "live";

  /**
   * ⚠️ A LEITURA MORA NO EFEITO, E TODO setState MORA NO CALLBACK DA PROMESSA.
   *
   * A versão anterior chamava `load()` (que faz setState) no corpo do efeito —
   * `react-hooks/set-state-in-effect`. Pior que o aviso: duas leituras em voo
   * (troca de filtro + ping do realtime) podiam chegar fora de ordem, e a
   * resposta VELHA sobrescrevia a nova. Agora cada execução tem o próprio
   * AbortController: a limpeza do efeito cancela a anterior, então só a
   * última resposta escreve, e nada escreve depois de desmontar.
   */
  useEffect(() => {
    const ctl = new AbortController();
    const p = new URLSearchParams({ limit: "50" });
    if (status) p.set("status", status);
    if (q) p.set("q", q);
    fetch(`/admin/api/early-access?${p}`, { signal: ctl.signal })
      .then(async (res) => {
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? String(res.status));
        return j;
      })
      .then((j) => {
        if (ctl.signal.aborted) return;
        setLinhas(j.linhas ?? []); setTotal(j.total ?? 0); setGate(j.gate ?? null); setM(j.metricas ?? null);
        setErr(null);
        setLoading(false);
      })
      .catch((e) => {
        if (ctl.signal.aborted) return;
        setErr(String(e));
        setLoading(false);
      });
    return () => ctl.abort();
  }, [status, q, recarga, aoVivo]);

  useEffect(() => {
    if (!realtime) return;
    return realtime.subscribe((scope) => { if (scope === "audit") recarregar(); });
  }, [realtime, recarregar]);

  async function carregarEventos(id: string) {
    const signal = leituraEventos.nova();
    try {
      const res = await fetch(`/admin/api/early-access?id=${id}`, { signal });
      const j = await res.json().catch(() => ({}));
      if (signal.aborted) return; // outra linha foi aberta, ou o painel saiu
      if (res.ok) setEventos(j.eventos ?? []);
      else setAviso(`detalhe: ${j.error ?? res.status}`);
    } catch {
      if (signal.aborted) return;
      setAviso("detalhe: falha de rede");
    }
  }

  async function abrir(id: string) {
    if (aberta === id) { leituraEventos.cancelar(); setAberta(null); return; }
    setAberta(id); setEventos([]); setMotivo(""); setAviso(null);
    await carregarEventos(id);
  }

  async function transicionar(l: Linha, para: Estado) {
    if (exigeMotivo(l.status, para) && motivo.trim() === "") {
      setAviso("esta transição exige motivo"); return;
    }
    const perigo = para === "blocked" || para === "rejected";
    if (!(await confirm(`${l.status.toUpperCase()} → ${para.toUpperCase()} para ${l.email_normalized}?`, perigo))) return;
    const res = await fetch("/admin/api/early-access/transition", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: l.id, to: para, reason: motivo.trim() || undefined }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.mudou === true) {
      setAviso(`feito: ${j.de} → ${j.para}`); setMotivo("");
      recarregar(); await carregarEventos(l.id);
    } else {
      setAviso(`NÃO mudou: ${j.error ?? res.status}`);
    }
  }

  return (
    <TerminalPanel id="early-access" title="EARLY ACCESS" subtitle="lista pública de interessados — não é a whitelist de admin" icon="✉" source="supabase/early_access_signups">
      {modal}
      {gate && (
        <div style={{ fontSize: 12, marginBottom: 10, color: gate.aberto ? "var(--adm-green)" : "var(--adm-amber)" }}>
          GATE: {gate.aberto ? "ABERTO" : `FECHADO — ${gate.motivos.join(", ")}`}
        </div>
      )}
      {m && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, marginBottom: 10, color: "var(--adm-ink-2)" }}>
          <span>total {m.total}</span><span>24h {m.ultimas24h}</span><span>7d {m.ultimos7d}</span>
          {ESTADOS.map((s) => <span key={s} style={{ color: COR[s] }}>{s} {m.porStatus[s]}</span>)}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <select className="adm-input" value={status} onChange={(e) => setStatus(e.target.value as "" | Estado)}>
          <option value="">todos</option>
          {ESTADOS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); setQ(qDigitado.trim().toLowerCase()); }} style={{ display: "flex", gap: 8 }}>
          <input className="adm-input" placeholder="prefixo do email" value={qDigitado} onChange={(e) => setQDigitado(e.target.value)} />
          <button type="submit" className="adm-btn">BUSCAR</button>
        </form>
        <a className="adm-btn" href="/admin/api/early-access/export">CSV</a>
        <a className="adm-btn" href="/admin/api/early-access/export?email=1">CSV + email</a>
        <a className="adm-btn" href="/admin/api/early-access/export?identidade=1">CSV + nome/carteira</a>
      </div>
      {aviso && <div style={{ fontSize: 12, color: "var(--adm-cyan)", marginBottom: 8 }}>{aviso}</div>}
      {loading && <div className="adm-shimmer" style={{ height: 80 }} />}
      {err && <div style={{ color: "var(--adm-red)", fontSize: 13 }}>{err}</div>}
      {!loading && !err && linhas.length === 0 && (
        <div style={{ color: "var(--adm-ink-3)", fontSize: 13 }}>Nenhuma inscrição neste recorte.</div>
      )}
      {linhas.length > 0 && (
        <div className="adm-scroll" style={{ maxHeight: 420 }}>
          <div style={{ fontSize: 11, color: "var(--adm-ink-3)", marginBottom: 4 }}>{linhas.length} de {total}</div>
          <table className="adm-table">
            <thead><tr><th>QUANDO</th><th>EMAIL</th><th>NOME</th><th>PAÍS</th><th>STATUS</th><th>SINAIS</th></tr></thead>
            <tbody>
              {linhas.map((l) => (
                <FragmentoLinha key={l.id} l={l} aberta={aberta === l.id} eventos={aberta === l.id ? eventos : []}
                  motivo={motivo} setMotivo={setMotivo} onAbrir={() => abrir(l.id)} onTransicionar={(p) => transicionar(l, p)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TerminalPanel>
  );
}

function FragmentoLinha({ l, aberta, eventos, motivo, setMotivo, onAbrir, onTransicionar }: {
  l: Linha; aberta: boolean; eventos: Evento[]; motivo: string;
  setMotivo: (s: string) => void; onAbrir: () => void; onTransicionar: (p: Estado) => void;
}) {
  const sinais = [
    l.wallet_address ? `carteira ${l.wallet_chain}` : null,
    l.email_verified_at ? "email ✓" : null,
    l.converted_at ? "convertido" : null,
    l.referral_flag,
    l.utm_source ? `utm:${l.utm_source}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <>
      <tr onClick={onAbrir} style={{ cursor: "pointer" }}>
        <td style={{ fontSize: 12, color: "var(--adm-ink-3)", whiteSpace: "nowrap" }}>{new Date(l.created_at).toLocaleString()}</td>
        <td style={{ fontSize: 12, fontFamily: "monospace" }}>{l.email_normalized}</td>
        <td style={{ fontSize: 12 }}>{l.display_name}</td>
        <td style={{ fontSize: 12 }}>{l.country}</td>
        <td style={{ fontSize: 12, color: COR[l.status] }}>{l.status}{l.status_reason ? ` — ${l.status_reason}` : ""}</td>
        <td style={{ fontSize: 11, color: "var(--adm-ink-3)" }}>{sinais || "—"}</td>
      </tr>
      {aberta && (
        <tr>
          <td colSpan={6}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "6px 0" }}>
              <input className="adm-input" placeholder="motivo operacional — obrigatório para rejeitar/bloquear/reverter; NÃO escreva dado pessoal" value={motivo}
                onChange={(e) => setMotivo(e.target.value)} maxLength={500} style={{ minWidth: 260 }} />
              {transicoesDisponiveis(l.status, l.converted_at !== null).map((p) => (
                <button key={p} type="button" className="adm-btn" onClick={() => onTransicionar(p)} style={{ color: COR[p] }}>
                  → {p}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--adm-ink-3)" }}>
              {eventos.length === 0 ? "sem eventos carregados" : eventos.map((e) => (
                <div key={e.id}>
                  {new Date(e.created_at).toLocaleString()} · {e.kind}
                  {e.from_status ? ` ${e.from_status}→${e.to_status}` : ""} · {e.actor.slice(0, 18)}
                  {e.reason ? ` · ${e.reason}` : ""}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
