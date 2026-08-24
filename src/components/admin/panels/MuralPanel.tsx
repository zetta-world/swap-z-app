"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import MapaMundi, { type Praca } from "../mural/MapaMundi";
import "../mural/mural.css";

interface Dados {
  pracas: Praca[];
  dinheiro: { arrecadadoTotalUsd: number; volume24hUsd: number; operacoes24h: number };
  pulso: { eventos5min: number; usuarios: number };
}

/**
 * O MAPA NO DASHBOARD — a versão de bancada do mural.
 *
 * ⚠️ ELE MOSTRA MENOS DE PROPÓSITO. O mural de parede tem a tela inteira e
 * pode gastar espaço com o fluxo linha a linha; aqui o painel divide a grade
 * com outros doze, e repetir tudo faria as duas telas competirem em vez de se
 * complementarem. Aqui: onde está o mundo, e o atalho para a tela cheia.
 */
export default function MuralPanel() {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/admin/api/mural", { cache: "no-store" });
      if (!r.ok) { setErro(`HTTP ${r.status}`); return; }
      setD(await r.json() as Dados); setErro(null);
    } catch (e) { setErro(String(e).slice(0, 120)); }
  }, []);

  useEffect(() => {
    void carregar();
    const t = window.setInterval(() => void carregar(), 15000);
    return () => window.clearInterval(t);
  }, [carregar]);

  const total = (d?.pracas ?? []).reduce((s, p) => s + p.acessos, 0);

  return (
    <TerminalPanel
      id="mural-global"
      title="ALCANCE GLOBAL"
      subtitle="de onde vem quem acessa — medido, últimos 30 dias"
      icon="🌍"
      source="supabase/platform_events"
      onRefresh={carregar}
    >
      {erro && <div style={{ color: "var(--adm-red)", fontSize: 12 }}>{erro}</div>}
      {!d && !erro && <div className="adm-shimmer" style={{ height: 140 }} />}

      {d && (
        <div className="mural" style={{ minHeight: 0, padding: 0, background: "none", gap: 10 }}>
          <MapaMundi pracas={d.pracas} compacto />

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
            <span style={{ color: "var(--adm-ink-3)" }}>
              PRAÇAS <b style={{ color: "var(--adm-cyan)" }}>{d.pracas.length}</b>
            </span>
            <span style={{ color: "var(--adm-ink-3)" }}>
              ACESSOS <b style={{ color: "var(--adm-ink-2)" }}>{total}</b>
            </span>
            <span style={{ color: "var(--adm-ink-3)" }}>
              CARTEIRAS <b style={{ color: "var(--adm-ink-2)" }}>{d.pulso.usuarios}</b>
            </span>
            <a href="/admin/mural" style={{ marginLeft: "auto", color: "var(--adm-gold)", letterSpacing: ".12em" }}>
              ABRIR MURAL ↗
            </a>
          </div>

          {d.pracas.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--adm-ink-3)", lineHeight: 1.7 }}>
              nenhum acesso com geolocalização nos últimos 30 dias — o mapa preenche sozinho
            </div>
          )}
        </div>
      )}
    </TerminalPanel>
  );
}
