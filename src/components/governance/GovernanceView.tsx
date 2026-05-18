"use client";

import { motion } from "framer-motion";
import { Vote, Users, ShieldCheck, CheckCircle2, XCircle, Clock, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { compactNumber } from "@/lib/format";

interface Proposal {
  id:        string;
  title:     string;
  category:  string;
  status:    "active" | "passed" | "failed" | "queued";
  forVotes:  number;
  againstVotes: number;
  endsIn:    string;
  proposer:  string;
  summary:   string;
}

const PROPOSALS: Proposal[] = [
  {
    id:       "ZIP-014",
    title:    "Activate ZETTA Chain primary settlement for Z-PAY routing",
    category: "Protocol upgrade",
    status:   "active",
    forVotes: 18_240_000,
    againstVotes: 2_180_000,
    endsIn:   "ends in 2 days",
    proposer: "0x8a2…71fe",
    summary:  "Route all Z-PAY fiat ↔ crypto conversions through ZETTA Chain as primary settlement layer. Falls back to EVM mainnets on degradation.",
  },
  {
    id:       "ZIP-013",
    title:    "Reduce slippage modifier on stable-stable pools to 0.05%",
    category: "Fee schedule",
    status:   "active",
    forVotes: 11_840_000,
    againstVotes: 12_120_000,
    endsIn:   "ends in 4 days",
    proposer: "obelisk.eth",
    summary:  "Decrease the default slippage protection on stable-pair pools so high-frequency arbitrage tightens the peg faster.",
  },
  {
    id:       "ZIP-012",
    title:    "Authorize ZION advisory engine for retail tier (no-KYC)",
    category: "AI policy",
    status:   "passed",
    forVotes: 31_240_000,
    againstVotes: 1_180_000,
    endsIn:   "queued for execution",
    proposer: "council.zetta",
    summary:  "Make the ZION advisory drawer accessible to all users without KYC. Operations remain advisory-only and never auto-execute.",
  },
  {
    id:       "ZIP-011",
    title:    "Deprecate v1 LP migration helper after 90 days",
    category: "Cleanup",
    status:   "failed",
    forVotes: 4_820_000,
    againstVotes: 14_400_000,
    endsIn:   "rejected",
    proposer: "dev.zetta",
    summary:  "Sunset the v1 → v3 migration helper contracts. Community voted to keep the helper available indefinitely.",
  },
];

const STATUS_CFG = {
  active: { text: "text-cyan",  border: "border-cyan/30",  bg: "bg-cyan/5",  label: "Active",   Icon: Clock        },
  passed: { text: "text-green", border: "border-green/30", bg: "bg-green/5", label: "Passed",   Icon: CheckCircle2 },
  failed: { text: "text-red",   border: "border-red/30",   bg: "bg-red/5",   label: "Failed",   Icon: XCircle      },
  queued: { text: "text-gold",  border: "border-gold/30",  bg: "bg-gold/5",  label: "Queued",   Icon: Clock        },
} as const;

export default function GovernanceView() {
  return (
    <div className="relative min-h-[calc(100vh-4rem)]">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[420px] h-[420px] rounded-full bg-violet/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-10 max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <Vote className="w-4 h-4 text-violet" />
            <span className="font-mono text-[10px] text-violet/80 tracking-widest uppercase">
              ZETTA DAO · stake-weighted voting · hybrid on/off-chain
            </span>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(2rem,5vw,3.6rem)] leading-[0.98] tracking-tight text-ink mb-3">
            <span className="text-grad-aurora">Governance</span>
          </h1>
          <p className="font-sans text-base text-ink-2 leading-relaxed max-w-2xl">
            On-chain proposals with execution validation. Stake-weighted votes,
            delegated authority, treasury controlled by the DAO. Long-term
            protocol stewardship by the people who hold ZETTA.
          </p>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
          <Stat label="Active proposals" value="2" Icon={Vote} tone="cyan" />
          <Stat label="Voters (24h)"     value="1,240" Icon={Users} tone="violet" />
          <Stat label="Total staked"     value="124M Z" Icon={ShieldCheck} tone="gold" />
          <Stat label="Quorum"           value="10M Z" Icon={CheckCircle2} tone="green" />
        </div>

        {/* Proposals */}
        <div className="space-y-3">
          {PROPOSALS.map((p, i) => {
            const status = STATUS_CFG[p.status];
            const StatusIcon = status.Icon;
            const total = p.forVotes + p.againstVotes;
            const forPct     = total > 0 ? (p.forVotes / total) * 100 : 0;
            const againstPct = 100 - forPct;
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="rounded-2xl border border-white/5 glass-pane overflow-hidden hover:border-white/10 transition-colors"
              >
                <div className="p-4 sm:p-5">
                  <div className="flex items-start gap-3 mb-3 flex-wrap">
                    <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{p.id}</span>
                    <span className={cn("font-mono text-[10px] px-1.5 py-0.5 rounded border tracking-widest uppercase flex items-center gap-1", status.text, status.border, status.bg)}>
                      <StatusIcon className="w-3 h-3" />
                      {status.label}
                    </span>
                    <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">· {p.category}</span>
                    <span className="ml-auto font-mono text-[10px] text-gold flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {p.endsIn}
                    </span>
                  </div>

                  <div className="font-display font-bold text-base text-ink mb-2 leading-snug">{p.title}</div>
                  <p className="font-sans text-xs text-ink-2 leading-relaxed mb-4">{p.summary}</p>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between font-mono text-[10px]">
                      <span className="text-green tracking-widest uppercase">For · {compactNumber(p.forVotes)} Z ({forPct.toFixed(1)}%)</span>
                      <span className="text-red tracking-widest uppercase">Against · {compactNumber(p.againstVotes)} Z ({againstPct.toFixed(1)}%)</span>
                    </div>
                    <div className="flex h-1.5 rounded-full overflow-hidden bg-white/5">
                      <div className="bg-green" style={{ width: `${forPct}%` }} />
                      <div className="bg-red"   style={{ width: `${againstPct}%` }} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-4">
                    <span className="font-mono text-[10px] text-ink-3">
                      Proposer: <span className="text-cyan/80">{p.proposer}</span>
                    </span>
                    {p.status === "active" ? (
                      <div className="flex gap-2">
                        <button className="px-4 py-1.5 rounded-md font-mono text-[10px] tracking-widest uppercase border border-green/30 bg-green/5 text-green hover:bg-green/10">
                          Vote For
                        </button>
                        <button className="px-4 py-1.5 rounded-md font-mono text-[10px] tracking-widest uppercase border border-red/30 bg-red/5 text-red hover:bg-red/10">
                          Vote Against
                        </button>
                      </div>
                    ) : (
                      <button className="font-mono text-[10px] text-cyan/80 hover:text-cyan tracking-widest uppercase inline-flex items-center gap-1">
                        View on-chain <ExternalLink className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Submit CTA */}
        <div className="mt-7 rounded-2xl border border-white/5 glass-pane p-5 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-display font-bold text-base text-ink mb-1">Submit a proposal</div>
            <p className="font-sans text-xs text-ink-2 leading-relaxed">
              Hold at least 100,000 Z to submit. Proposals are reviewed by the council guard before going live.
            </p>
          </div>
          <button className="btn btn-secondary text-xs">New proposal</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, Icon, tone }: { label: string; value: string; Icon: React.ComponentType<{ className?: string }>; tone: "cyan" | "violet" | "gold" | "green" }) {
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
        <div className="flex items-center justify-between mb-2">
          <div className={cn("w-7 h-7 rounded-lg border flex items-center justify-center", cfg.bg, cfg.border)}>
            <Icon className={cn("w-3.5 h-3.5", cfg.text)} />
          </div>
        </div>
        <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1">{label}</div>
        <div className={cn("font-display font-bold text-lg sm:text-xl", cfg.text)}>{value}</div>
      </div>
    </div>
  );
}
