"use client";

import { motion } from "framer-motion";
import { Rocket, Lock, Users, TrendingUp, ShieldCheck, ExternalLink, Clock } from "lucide-react";
import { cn } from "@/lib/cn";

interface Project {
  name:        string;
  symbol:      string;
  chain:       string;
  description: string;
  status:      "live" | "upcoming" | "ended";
  raised:      number;
  target:      number;
  participants: number;
  startsIn:    string;
  rating:      "A" | "B" | "C";
  color:       string;
  category:    string;
}

const PROJECTS: Project[] = [
  { name: "OBELISK-Z Wallet Token",  symbol: "OBELZ",    chain: "bsc",      description: "Native wallet governance token; locked LP, vested team allocation, fair-launch AMM",  status: "live",      raised: 412_000,  target: 500_000, participants: 1_840, startsIn: "ends in 18h", rating: "A", color: "#00E8FF", category: "Wallet / Ecosystem" },
  { name: "ZetaScan Analytics",      symbol: "ZSCAN",    chain: "ethereum", description: "On-chain analytics infra for ZETTA — block explorer + risk scoring node operators", status: "live",      raised: 218_000,  target: 600_000, participants: 920,   startsIn: "ends in 3 days", rating: "A", color: "#9F5FFF", category: "Infrastructure" },
  { name: "Z-PAY POS Settlement",   symbol: "ZPOS",     chain: "polygon",  description: "Merchant settlement layer for Z-PAY · fiat on/off-ramp partner bridge",              status: "upcoming",  raised: 0,        target: 800_000, participants: 0,     startsIn: "starts in 2 days", rating: "A", color: "#F5A623", category: "Payments"  },
  { name: "Polysphere Yield Vault", symbol: "PSV",      chain: "arbitrum", description: "Multi-strategy yield aggregator across Aave, Pendle, GMX",                            status: "upcoming",  raised: 0,        target: 1_200_000, participants: 0,    startsIn: "starts in 5 days", rating: "B", color: "#00E087", category: "DeFi / Yield" },
  { name: "Aurora Memes",            symbol: "AURM",    chain: "solana",   description: "Community meme launch with 2% creator tax, 100% LP locked 24 months",                  status: "ended",     raised: 240_000,  target: 200_000, participants: 4_120, startsIn: "ended 3 days ago", rating: "C", color: "#FF3B5C", category: "Meme" },
];

const STATUS_CFG = {
  live:     { text: "text-green",  border: "border-green/30",  bg: "bg-green/5",   label: "Live now"   },
  upcoming: { text: "text-cyan",   border: "border-cyan/30",   bg: "bg-cyan/5",    label: "Upcoming"   },
  ended:    { text: "text-ink-3", border: "border-white/10", bg: "bg-white/[0.02]", label: "Completed" },
} as const;

const RATING_CFG = {
  A: { text: "text-green",  border: "border-green/30",  bg: "bg-green/5",  desc: "Verified team, locked LP" },
  B: { text: "text-gold",   border: "border-gold/30",   bg: "bg-gold/5",   desc: "Partial checks, watch" },
  C: { text: "text-red",    border: "border-red/30",    bg: "bg-red/5",    desc: "High risk, retail only" },
} as const;

export default function LaunchpadView() {
  return (
    <div className="relative min-h-[calc(100vh-4rem)]">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-1/3 right-1/3 w-[480px] h-[480px] rounded-full bg-gold/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-10 max-w-7xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <Rocket className="w-4 h-4 text-gold" />
            <span className="font-mono text-[10px] text-gold/80 tracking-widest uppercase">
              Z-PAD · Token Factory · Fair-Launch AMM
            </span>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(2rem,5vw,3.6rem)] leading-[0.98] tracking-tight text-ink mb-3">
            Launchpad <span className="text-grad-aurora">Universe</span>
          </h1>
          <p className="font-sans text-base text-ink-2 leading-relaxed max-w-2xl">
            Audited token deployment with built-in LP lock, anti-bot launch controls,
            and ZION risk certification. Every project passes the security gate
            before participants can join.
          </p>
        </motion.div>

        {/* Pillars */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
          <Pillar Icon={Lock}        label="LP locked nativo"    value="Default" tone="cyan" />
          <Pillar Icon={ShieldCheck} label="Audited templates"   value="Cyberscope" tone="green" />
          <Pillar Icon={Users}       label="Anti-bot controls"   value="Auto" tone="violet" />
          <Pillar Icon={TrendingUp}  label="Fair launch AMM"     value="No hardcap" tone="gold" />
        </div>

        {/* Projects */}
        <div className="space-y-3">
          {PROJECTS.map((p, i) => {
            const status = STATUS_CFG[p.status];
            const rating = RATING_CFG[p.rating];
            const pct = p.target > 0 ? Math.min(p.raised / p.target, 1) : 0;
            return (
              <motion.div
                key={p.symbol}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="rounded-2xl border border-white/5 glass-pane overflow-hidden hover:border-white/10 transition-colors"
              >
                <div className="p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-4">
                  {/* Header — symbol + name */}
                  <div className="lg:col-span-5 flex items-start gap-3">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 font-display font-extrabold text-sm"
                      style={{ background: `${p.color}22`, color: p.color, border: `1px solid ${p.color}55` }}
                    >
                      {p.symbol.slice(0, 4)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-display font-bold text-base text-ink truncate">{p.name}</span>
                        <span className={cn("font-mono text-[9px] px-1.5 py-0.5 rounded border tracking-widest uppercase", status.text, status.border, status.bg)}>
                          {status.label}
                        </span>
                        <span className={cn("font-mono text-[9px] px-1.5 py-0.5 rounded border tracking-widest uppercase", rating.text, rating.border, rating.bg)}
                              title={rating.desc}
                        >
                          ZION · {p.rating}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-ink-3 uppercase tracking-wider mb-2">
                        {p.symbol} · {p.chain} · {p.category}
                      </div>
                      <p className="font-sans text-xs text-ink-2 leading-relaxed">{p.description}</p>
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="lg:col-span-4 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Progress</span>
                      <span className="font-mono text-[10px] text-cyan">{(pct * 100).toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: `linear-gradient(90deg, ${p.color}, ${p.color}80)` }} />
                    </div>
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <span className="text-ink-2">${p.raised.toLocaleString()}</span>
                      <span className="text-ink-3">/ ${p.target.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="flex items-center gap-1 font-mono text-ink-3"><Users className="w-2.5 h-2.5" /> {p.participants.toLocaleString()} participants</span>
                      <span className="flex items-center gap-1 font-mono text-gold"><Clock className="w-2.5 h-2.5" /> {p.startsIn}</span>
                    </div>
                  </div>

                  {/* CTA */}
                  <div className="lg:col-span-3 flex lg:flex-col items-stretch gap-2">
                    {p.status === "live" && (
                      <button className="flex-1 btn btn-primary text-xs">Participate</button>
                    )}
                    {p.status === "upcoming" && (
                      <button className="flex-1 btn btn-secondary text-xs">Set reminder</button>
                    )}
                    {p.status === "ended" && (
                      <a className="flex-1 btn btn-secondary text-xs" href="#">
                        View pool
                      </a>
                    )}
                    <button className="flex-1 btn btn-ghost text-xs">
                      ZION audit
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* CTA — Launch your own */}
        <div className="mt-7 aurora-border p-px">
          <div className="rounded-[18px] glass p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-5">
            <div className="flex-1">
              <span className="section-label">Token factory</span>
              <h2 className="font-display font-extrabold text-2xl text-ink mt-2 mb-2">
                Launch your own token in 60 seconds.
              </h2>
              <p className="font-sans text-sm text-ink-2 leading-relaxed max-w-2xl">
                Audited templates (standard · taxed · rebase · vesting). LP lock and anti-bot controls
                are non-negotiable defaults. ZION certifies your launch before it goes live to participants.
              </p>
            </div>
            <button className="btn btn-primary py-3 px-6 text-sm">
              <Rocket className="w-3.5 h-3.5" />
              Create token
            </button>
          </div>
        </div>

        <p className="font-mono text-[10px] text-ink-4 text-center mt-4">
          Z-PAD is the launchpad backbone of the ZETTA ecosystem · Z-SWAP provides settlement liquidity
        </p>
      </div>
    </div>
  );
}

function Pillar({ Icon, label, value, tone }: { Icon: React.ComponentType<{ className?: string }>; label: string; value: string; tone: "cyan" | "violet" | "gold" | "green" }) {
  const cfg = {
    cyan:   { ring: "rgba(0,232,255,0.18)",  text: "text-cyan",   border: "border-cyan/20",   bg: "bg-cyan/10"   },
    violet: { ring: "rgba(159,95,255,0.18)", text: "text-violet", border: "border-violet/20", bg: "bg-violet/10" },
    gold:   { ring: "rgba(245,166,35,0.18)", text: "text-gold",   border: "border-gold/20",   bg: "bg-gold/10"   },
    green:  { ring: "rgba(0,224,135,0.18)",  text: "text-green",  border: "border-green/20",  bg: "bg-green/10"  },
  }[tone];
  return (
    <div className={cn("relative rounded-xl border glass-pane p-4 overflow-hidden", cfg.border)}>
      <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl opacity-50" style={{ background: cfg.ring }} />
      <div className="relative">
        <div className={cn("w-7 h-7 rounded-lg border flex items-center justify-center mb-2", cfg.bg, cfg.border)}>
          <Icon className={cn("w-3.5 h-3.5", cfg.text)} />
        </div>
        <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1">{label}</div>
        <div className={cn("font-display font-bold text-sm", cfg.text)}>{value}</div>
      </div>
    </div>
  );
}

// avoid unused import warning
void ExternalLink;
