"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Zap, TrendingUp, Activity } from "lucide-react";
import { useTierAccent } from "@/components/tier/TierAccentProvider";
import TopMovers from "./TopMovers";

const BENEFITS = [
  { label: "Taxas reduzidas",       value: "50%",   active: true  },
  { label: "Proteção anti-flash",   value: "Ativo", active: true  },
  { label: "Acesso ao ZION AI",     value: "Ativo", active: true  },
  { label: "Insight nos mercados",  value: "Pro",   active: true  },
  { label: "Sentinela exclusiva",   value: "Ativo", active: true  },
  { label: "Acesso a lançamentos",  value: "Early", active: true  },
];

const ACTIVITY = [
  { label: "Swap Executado",   detail: "+168.00 USDC",   time: "Agora",   tone: "green"  as const },
  { label: "Nova Conquista",   detail: "Relâmpago Preciso", time: "2m",   tone: "gold"   as const },
  { label: "ZION AI Insight",  detail: "Oportunidade detectada", time: "5m", tone: "violet" as const },
  { label: "Liquidez Adicionada", detail: "MATIC/USDC 0.3%", time: "12m", tone: "cyan"   as const },
];

const TONE_CLS: Record<string, string> = {
  green:  "text-green  bg-green/10  border-green/20",
  gold:   "text-gold   bg-gold/10   border-gold/20",
  violet: "text-violet bg-violet/10 border-violet/20",
  cyan:   "text-cyan   bg-cyan/10   border-cyan/20",
};

export default function TraderRightPanel() {
  const { active, tier } = useTierAccent();
  const isTrader = active && tier === "trader";

  if (!isTrader) return <TopMovers />;

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.3, duration: 0.5 }}
      className="flex flex-col gap-3 h-full"
    >
      {/* ── NFT Talisman card ── */}
      <div className="trader-panel-card trader-nft-inline">
        <div className="trader-nft-inner">
          <div className="trader-nft-holo-inline" />
          <div className="trader-nft-corner-set">
            <span className="tnc tl" /><span className="tnc tr" />
            <span className="tnc bl" /><span className="tnc br" />
          </div>
          <div className="trader-nft-content">
            <span className="trader-nft-rune-big">ᚦ</span>
            <div className="trader-nft-label">
              <span className="trader-nft-name">Z-SWAP</span>
              <span className="trader-nft-sub">ACCESS PASS</span>
            </div>
            <div className="trader-nft-tag">
              <Zap className="w-3 h-3" />
              <span>TRADER</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Benefícios TRADER CLASS ── */}
      <div className="trader-panel-card">
        <div className="trader-panel-header">
          <span className="trader-panel-rune">ᚦ</span>
          <div>
            <div className="trader-panel-title">BENEFÍCIOS</div>
            <div className="trader-panel-subtitle">TRADER CLASS</div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 mt-3">
          {BENEFITS.map((b) => (
            <div key={b.label} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <CheckCircle2 className="w-3 h-3 text-green flex-shrink-0" />
                <span className="font-sans text-[11px] text-ink-2 truncate">{b.label}</span>
              </div>
              <span className="font-mono text-[10px] text-green/80 flex-shrink-0">{b.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── ZETTA Token stats ── */}
      <div className="trader-panel-card">
        <div className="trader-panel-header">
          <TrendingUp className="w-3.5 h-3.5 text-gold" />
          <div>
            <div className="trader-panel-title">ZETTA TOKEN</div>
            <div className="trader-panel-subtitle">PREÇO AO VIVO</div>
          </div>
          <span className="ml-auto font-display font-bold text-base text-ink">$0.1487</span>
        </div>
        <div className="flex gap-2 mt-2.5">
          <div className="flex-1 rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-2">
            <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-0.5">Vol 24h</div>
            <div className="font-display font-bold text-xs text-ink">$2.48M</div>
          </div>
          <div className="flex-1 rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-2">
            <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-0.5">Holders</div>
            <div className="font-display font-bold text-xs text-ink">24.5K</div>
          </div>
          <div className="flex-1 rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-2">
            <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-0.5">7d</div>
            <div className="font-display font-bold text-xs text-green">+12.4%</div>
          </div>
        </div>
      </div>

      {/* ── Raios do Trovão — activity feed ── */}
      <div className="trader-panel-card flex-1">
        <div className="trader-panel-header">
          <Activity className="w-3.5 h-3.5 text-violet" />
          <div className="trader-panel-title">RAIOS DO TROVÃO</div>
        </div>
        <div className="flex flex-col gap-2 mt-3">
          {ACTIVITY.map((a, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${a.tone === "green" ? "bg-green" : a.tone === "gold" ? "bg-gold" : a.tone === "violet" ? "bg-violet" : "bg-cyan"}`} />
              <div className="min-w-0 flex-1">
                <div className="font-sans text-[11px] text-ink leading-tight">{a.label}</div>
                <div className="font-mono text-[10px] text-ink-3 truncate">{a.detail}</div>
              </div>
              <span className="font-mono text-[9px] text-ink-4 flex-shrink-0 mt-0.5">{a.time}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
