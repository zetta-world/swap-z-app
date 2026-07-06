"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";
import { WORLD_DOTS } from "./world-dots";

/**
 * MIDGARD — where the accesses live. Dot-matrix world map (land grid embedded
 * offline, zero external assets) with a glowing dot per access city, plus the
 * detailed day/week/month access analytics the CEO asked for.
 * Geo populates from the beacon enrichment onward (older events have no geo).
 */

type Day = { day: string; views: number; uniques: number };
type Period = { period: string; views: number; uniques: number };
type City = { city: string; country: string; views: number; lat: number; lon: number };
type TR = {
  days: Day[]; weeks: Period[]; months: Period[];
  totals: { today: Day; last7: { views: number }; last30: { views: number } };
  byCountry: Array<{ country: string; views: number; uniques: number }>;
  cities: City[];
  byPath: Array<{ key: string; views: number }>;
  byReferrer: Array<{ key: string; views: number }>;
  byDevice: Array<{ device: string; views: number }>;
};

// Equirectangular projection into the SVG viewBox (lon -180..180, lat 84..-58
// — same window the land grid was generated with).
const VB_W = 720, VB_H = 284;
const px = (lon: number) => ((lon + 180) / 360) * VB_W;
const py = (lat: number) => ((84 - lat) / 142) * VB_H;

export default function TrafficPanel() {
  const [data, setData] = useState<TR | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"mapa" | "dias" | "origem">("mapa");
  const realtime = useAdminRealtime();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/traffic");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, realtime?.status === "live" ? 180_000 : 120_000);
    return () => clearInterval(t);
  }, [load, realtime?.status]);

  const maxViews = data ? Math.max(1, ...data.days.map((d) => d.views)) : 1;

  return (
    <TerminalPanel id="traffic" title="MIDGARD" subtitle="acessos · mapa · dia/semana/mês" icon="🌍" source="supabase/platform_events">
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["mapa", "dias", "origem"] as const).map((v) => (
          <button key={v} className={`adm-toggle ${tab === v ? "active" : ""}`} onClick={() => setTab(v)}>
            {v.toUpperCase()}
          </button>
        ))}
      </div>

      {loading && <div className="adm-shimmer" style={{ height: 140 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {data && tab === "mapa" && (
        <div>
          <div>
            <svg viewBox={`0 0 ${VB_W} ${VB_H}`} style={{ width: "100%", display: "block" }} role="img" aria-label="Mapa de acessos">
              {/* ocean backdrop — frames the map against the dark panel */}
              <defs>
                <radialGradient id="mid-ocean" cx="50%" cy="42%" r="75%">
                  <stop offset="0%" stopColor="#10233c" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#070d18" stopOpacity="0.9" />
                </radialGradient>
              </defs>
              <rect x="0" y="0" width={VB_W} height={VB_H} rx="10" fill="url(#mid-ocean)" stroke="rgba(120,160,200,0.14)" />
              {/* land grid — ice-cyan dots, bright enough to read on the dark ocean */}
              {WORLD_DOTS.map(([lo, la], i) => (
                <circle key={i} cx={px(lo / 10)} cy={py(la / 10)} r={1.25} fill="#9fc3dc" opacity={0.8} />
              ))}
              {/* access dots — size by views, glow pulse */}
              {data.cities.map((c, i) => {
                const r = Math.min(7, 2.5 + Math.sqrt(c.views));
                return (
                  <g key={i}>
                    <circle cx={px(c.lon)} cy={py(c.lat)} r={r * 2.2} fill="var(--adm-cyan)" opacity={0.12}>
                      <animate attributeName="r" values={`${r * 1.4};${r * 2.6};${r * 1.4}`} dur="2.4s" repeatCount="indefinite" />
                    </circle>
                    <circle cx={px(c.lon)} cy={py(c.lat)} r={r} fill="var(--adm-cyan)" opacity={0.9}>
                      <title>{c.city} ({c.country}) — {c.views} acessos</title>
                    </circle>
                  </g>
                );
              })}
            </svg>
          </div>
          {data.cities.length === 0 ? (
            <div style={{ fontSize: 9, color: "var(--adm-gold)", marginTop: 8 }}>
              ⚠ Sem geo ainda — o mapa povoa com os acessos a partir de agora (eventos antigos não têm localização).
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {data.cities.slice(0, 8).map((c, i) => (
                <span key={i} style={{ fontSize: 8, fontFamily: "monospace", color: "var(--adm-ink-3)", border: "1px solid var(--adm-border)", borderRadius: 4, padding: "2px 6px" }}>
                  <span style={{ color: "var(--adm-cyan)" }}>●</span> {c.city} · {c.country} · {c.views}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {data && tab === "dias" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {[
              { label: "HOJE",  v: data.totals.today.views,  sub: `${data.totals.today.uniques} únicos` },
              { label: "7 DIAS", v: data.totals.last7.views },
              { label: "30 DIAS", v: data.totals.last30.views },
            ].map((tile) => (
              <div key={tile.label} style={{ flex: 1, background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "6px 8px" }}>
                <div style={{ fontSize: 8, color: "var(--adm-ink-3)", letterSpacing: "0.08em" }}>{tile.label}</div>
                <div style={{ fontSize: 15, color: "var(--adm-cyan)", fontVariantNumeric: "tabular-nums" }}>{tile.v}</div>
                {tile.sub && <div style={{ fontSize: 8, color: "var(--adm-ink-4)" }}>{tile.sub}</div>}
              </div>
            ))}
          </div>

          {/* daily bars, 30d — views (cyan) with uniques (gold) overlay */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 72 }}>
            {data.days.map((d) => (
              <div key={d.day} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}
                   title={`${d.day}: ${d.views} views · ${d.uniques} únicos`}>
                <div style={{ height: `${(d.views / maxViews) * 100}%`, minHeight: d.views > 0 ? 2 : 0, background: "var(--adm-cyan)", opacity: 0.75, borderRadius: 1, position: "relative" }}>
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: d.views > 0 ? `${(d.uniques / Math.max(1, d.views)) * 100}%` : 0, background: "var(--adm-gold)", opacity: 0.9, borderRadius: 1 }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "var(--adm-ink-4)", marginTop: 2 }}>
            <span>{data.days[0]?.day.slice(5)}</span>
            <span><span style={{ color: "var(--adm-cyan)" }}>■</span> views <span style={{ color: "var(--adm-gold)" }}>■</span> únicos</span>
            <span>{data.days[data.days.length - 1]?.day.slice(5)}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
            <table className="adm-table">
              <thead><tr><th>SEMANA</th><th>VIEWS</th><th>ÚN.</th></tr></thead>
              <tbody>
                {data.weeks.slice(0, 6).map((w) => (
                  <tr key={w.period}><td style={{ color: "var(--adm-cyan)" }}>{w.period.slice(5)}</td><td>{w.views}</td><td>{w.uniques}</td></tr>
                ))}
              </tbody>
            </table>
            <table className="adm-table">
              <thead><tr><th>MÊS</th><th>VIEWS</th><th>ÚN.</th></tr></thead>
              <tbody>
                {data.months.map((m) => (
                  <tr key={m.period}><td style={{ color: "var(--adm-violet, #9F5FFF)" }}>{m.period}</td><td>{m.views}</td><td>{m.uniques}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && tab === "origem" && (
        <div className="adm-scroll" style={{ maxHeight: 320 }}>
          <div className="adm-category">Países · 30d</div>
          <table className="adm-table">
            <tbody>
              {data.byCountry.length === 0 && <tr><td style={{ color: "var(--adm-ink-3)" }}>sem geo ainda</td></tr>}
              {data.byCountry.map((c) => (
                <tr key={c.country}><td style={{ color: "var(--adm-cyan)" }}>{c.country}</td><td>{c.views} views</td><td>{c.uniques} únicos</td></tr>
              ))}
            </tbody>
          </table>

          <div className="adm-category" style={{ marginTop: 10 }}>Páginas mais vistas · 30d</div>
          <table className="adm-table">
            <tbody>
              {data.byPath.map((p) => (
                <tr key={p.key}><td style={{ color: "var(--adm-ink)", fontFamily: "monospace" }}>{p.key}</td><td>{p.views}</td></tr>
              ))}
            </tbody>
          </table>

          <div className="adm-category" style={{ marginTop: 10 }}>Origem externa (referrer) · 30d</div>
          <table className="adm-table">
            <tbody>
              {data.byReferrer.length === 0 && <tr><td style={{ color: "var(--adm-ink-3)" }}>nenhum referrer externo ainda</td></tr>}
              {data.byReferrer.map((r) => (
                <tr key={r.key}><td style={{ color: "var(--adm-gold)" }}>{r.key}</td><td>{r.views}</td></tr>
              ))}
            </tbody>
          </table>

          <div className="adm-category" style={{ marginTop: 10 }}>Dispositivo · 30d</div>
          <table className="adm-table">
            <tbody>
              {data.byDevice.map((d) => (
                <tr key={d.device}><td style={{ color: "var(--adm-ink-2)" }}>{d.device}</td><td>{d.views}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TerminalPanel>
  );
}
