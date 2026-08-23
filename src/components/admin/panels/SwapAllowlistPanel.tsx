"use client";

import { useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

type Obs = { chain: string; chainId: number; role: "target" | "spender"; address: string; source: string; count: number; realCount: number; cadeiaVigiada: boolean; naLista: boolean };
type Resp = { observed: Obs[]; envTargets: string; envSpenders: string;
  enforcing: { targets: boolean; spenders: boolean; cadeiasTargets: number[]; cadeiasSpenders: number[] };
  note: string };

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "var(--adm-ink-4)", letterSpacing: "0.08em", marginBottom: 2 }}>{label}</div>
      <div
        onClick={() => { navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}
        style={{ cursor: "pointer", fontFamily: "monospace", fontSize: 12, color: "var(--adm-cyan)", wordBreak: "break-all",
          padding: "6px 8px", background: "rgba(0 229 255 / 0.04)", border: "1px solid rgba(0 229 255 / 0.15)", borderRadius: 2 }}
      >
        {value} <span style={{ color: "var(--adm-ink-4)" }}>{copied ? "· copiado ✓" : "· toque p/ copiar"}</span>
      </div>
    </div>
  );
}

export default function SwapAllowlistPanel() {
  const [data, setData] = useState<Resp | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeMsg, setProbeMsg] = useState<string | null>(null);
  const [probeErrs, setProbeErrs] = useState<string[]>([]);

  const reload = () => fetch("/admin/api/swap-allowlist").then((r) => r.json()).then((j) => { setData(j); setLoaded(true); }).catch(() => setLoaded(true));
  useEffect(() => { reload(); }, []);

  const autoPopulate = async () => {
    setProbing(true); setProbeMsg(null);
    try {
      const r = await fetch("/admin/api/swap-allowlist", { method: "POST" });
      const j = await r.json();
      setProbeMsg(`✓ ${(j.probed ?? []).length} coletadas${(j.errors ?? []).length ? ` · ${j.errors.length} falharam` : ""}`);
      setProbeErrs(j.errors ?? []);
      await reload();
    } catch { setProbeMsg("falha ao coletar — tente de novo"); }
    finally { setProbing(false); }
  };

  const enforcing = data?.enforcing.targets || data?.enforcing.spenders;

  /**
   * ⚠️ A COBERTURA E POR CADEIA, e o aviso de topo escondia isso.
   *
   * A trava so bloqueia numa cadeia que tem lista: uma allowlist cobrindo
   * Ethereum e Base deixa Arbitrum passando qualquer roteador. Antes a tela
   * dizia so "ENFORCING", e quem lesse concluia que valia para tudo.
   *
   * As cadeias abaixo sao as que de fato foram carregadas do env parseado.
   * Cadeia OBSERVADA que nao aparece aqui esta sem verificacao nenhuma.
   */
  const vigiadas = new Set(data?.enforcing.cadeiasTargets ?? []);
  const observadasSemLista = [...new Set((data?.observed ?? []).map((o) => o.chainId))]
    .filter((id) => !vigiadas.has(id));
  const foraDaLista = (data?.observed ?? []).filter((o) => o.cadeiaVigiada && !o.naLista);

  return (
    <TerminalPanel id="swap-allowlist" title="SWAP ALLOWLIST" subtitle="observe → verifique → fixe (anti-dreno)" icon="⛨" source="platform_events/swap_intent">
      <div style={{ fontSize: 12, color: enforcing ? "var(--adm-green)" : "var(--adm-amber)", marginBottom: 8, letterSpacing: "0.06em" }}>
        {enforcing
          ? `✓ ENFORCING em ${vigiadas.size} cadeia(s): ${[...vigiadas].join(", ") || "—"}`
          : "⚠ OBSERVANDO — allowlist DESLIGADA. Colete, verifique no explorer e cole as envs abaixo na Vercel + redeploy."}
      </div>

      {/* ⚠️ Cadeia com tráfego observado e SEM lista = trava inerte ali. */}
      {enforcing && observadasSemLista.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--adm-amber)", marginBottom: 8 }}>
          ⚠ SEM VIGILÂNCIA nestas cadeias observadas: {observadasSemLista.join(", ")} — qualquer roteador passa nelas.
        </div>
      )}

      {/* ⚠️ O oposto: endereço visto no tráfego real que a lista NÃO tem.
          Numa cadeia vigiada isso não é aviso, é swap que já está morrendo. */}
      {foraDaLista.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--adm-red)", marginBottom: 8 }}>
          ⛔ {foraDaLista.length} endereço(s) OBSERVADO(S) fora da allowlist numa cadeia vigiada — o swap é bloqueado ao assinar:{" "}
          {foraDaLista.slice(0, 3).map((o) => `${o.chain}/${o.role} ${o.address.slice(0, 10)}…`).join(" · ")}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <button onClick={autoPopulate} disabled={probing}
          style={{ fontSize: 12, letterSpacing: "0.05em", padding: "5px 10px", borderRadius: 3, cursor: probing ? "wait" : "pointer",
            color: "var(--adm-cyan)", background: "rgba(0 229 255 / 0.06)", border: "1px solid rgba(0 229 255 / 0.25)" }}>
          {probing ? "coletando…" : "⚡ popular automaticamente (grátis · sem swap)"}
        </button>
        {probeMsg && <span style={{ fontSize: 11, color: "var(--adm-ink-3)" }}>{probeMsg}</span>}
      </div>
      {probeErrs.length > 0 && (
        <div style={{ marginBottom: 10, fontSize: 11, color: "var(--adm-ink-4)", fontFamily: "monospace", lineHeight: 1.5 }}>
          {probeErrs.slice(0, 8).map((e, i) => <div key={i} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>· {e}</div>)}
        </div>
      )}
      {!loaded && <div className="adm-shimmer" style={{ height: 60 }} />}
      {loaded && data && (
        <div>
          <Copyable label="NEXT_PUBLIC_ALLOWED_SWAP_TARGETS" value={data.envTargets} />
          <Copyable label="NEXT_PUBLIC_ALLOWED_SWAP_SPENDERS" value={data.envSpenders} />
          {data.observed.length === 0 && (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 13, marginTop: 8 }}>
              Nenhum endereço observado ainda — faça um swap firme (0x/LiFi) em cada chain pra popular.
            </div>
          )}
          {data.observed.length > 0 && (
            <table className="adm-table" style={{ width: "100%", marginTop: 8, fontSize: 12 }}>
              <thead><tr>
                <th style={{ textAlign: "left" }}>CHAIN</th><th style={{ textAlign: "left" }}>PAPEL</th>
                <th style={{ textAlign: "left" }}>ENDEREÇO</th><th>FONTE</th><th>SONDA</th><th>REAL</th>
              </tr></thead>
              <tbody>
                {data.observed.map((o, i) => (
                  <tr key={i}>
                    <td>{o.chain}</td>
                    <td style={{ color: o.role === "spender" ? "var(--adm-amber)" : "var(--adm-cyan)" }}>{o.role}</td>
                    <td style={{ fontFamily: "monospace", color: "var(--adm-ink-2)" }}>{o.address.slice(0, 10)}…{o.address.slice(-6)}</td>
                    <td style={{ textAlign: "center", color: "var(--adm-ink-3)" }}>{o.source}</td>
                    <td style={{ textAlign: "center", color: "var(--adm-ink-4)" }}>{o.count - o.realCount}×</td>
                    {/* REAL é a única evidência independente: sonda confirmando
                        sonda é a ferramenta dando razão a si mesma. */}
                    <td style={{ textAlign: "center", color: o.realCount > 20 ? "var(--adm-green)" : o.realCount > 0 ? "var(--adm-ink-2)" : "var(--adm-amber)" }}>{o.realCount}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginTop: 8 }}>
            Só a coluna REAL (swaps de usuário) é evidência independente — SONDA é a própria ferramenta se autoconfirmando. Confirme cada endereço no explorer antes de fixar.
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
