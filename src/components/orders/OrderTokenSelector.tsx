"use client";

import { useState, useMemo, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, X, Check, Sparkles } from "lucide-react";
import type { Token } from "@/lib/tokens";
import { useTierAccent } from "@/components/tier/TierAccentProvider";
import { formatUsd } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

interface Props {
  open:     boolean;
  onClose:  () => void;
  tokens:   Token[];
  selected?: Token;
  onSelect: (t: Token) => void;
  title?:   string;
}

const TIER_CFG = {
  free:   { accent: "#00E8FF", badge: null,       grad: "from-bg-1",              glow: "shadow-[0_0_40px_-10px_rgba(0,232,255,0.15)]"      },
  pro:    { accent: "#F5A623", badge: "PRO",       grad: "from-gold/[0.06]",       glow: "shadow-[0_0_40px_-10px_rgba(245,166,35,0.25)]"     },
  trader: { accent: "#9F5FFF", badge: "TRADER ᚦ", grad: "from-violet/[0.06]",     glow: "shadow-[0_0_40px_-10px_rgba(159,95,255,0.30)]"     },
  pilot:  { accent: "#C9A2FF", badge: "PILOT",     grad: "from-violet/[0.04]",     glow: "shadow-[0_0_40px_-10px_rgba(201,162,255,0.25)]"    },
} as const;

// ─── Token logo with fallback ──────────────────────────────────────────────
function TokenLogo({ token, size = 40 }: { token: Token; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = token.logo ?? `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/icon/${token.symbol.toLowerCase()}.png`;

  const fallbackColor = token.color
    ?? `hsl(${[...token.symbol].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)},55%,45%)`;

  if (!failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={token.symbol}
        width={size} height={size}
        className="rounded-full object-cover bg-white/5 flex-shrink-0"
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className="rounded-full flex items-center justify-center font-display font-extrabold flex-shrink-0"
      style={{
        width: size, height: size,
        background: `${fallbackColor}22`,
        color: fallbackColor,
        border: `1px solid ${fallbackColor}44`,
        fontSize: Math.floor(size * 0.3),
      }}
    >
      {token.symbol.slice(0, 2)}
    </span>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function OrderTokenSelector({ open, onClose, tokens, selected, onSelect, title }: Props) {
  const t    = useT();
  const { tier, active } = useTierAccent();
  const cfg  = TIER_CFG[active ? tier as keyof typeof TIER_CFG : "free"] ?? TIER_CFG.free;
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Pilot: ZION "SAFE PICK" badge on the 2 safest non-stable tokens
  const safePicks = useMemo(() => {
    if (!active || tier !== "pilot") return new Set<string>();
    return new Set(
      tokens
        .filter((tok) => (tok.riskScore ?? 99) <= 6 && !tok.tags?.includes("stablecoin"))
        .slice(0, 2)
        .map((tok) => tok.address),
    );
  }, [tokens, active, tier]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return tokens;
    return tokens.filter(
      (tok) => tok.symbol.toUpperCase().includes(q) || tok.name.toLowerCase().includes(search.toLowerCase()),
    );
  }, [tokens, search]);

  const handleClose  = () => { setSearch(""); onClose(); };
  const handleSelect = (tok: Token) => { onSelect(tok); handleClose(); };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-bg/80 backdrop-blur-md animate-fade-in" />
        <Dialog.Content
          className={cn(
            "fixed z-[70] flex flex-col outline-none overflow-hidden",
            "bottom-0 left-0 right-0 h-[82vh] rounded-t-3xl",
            "border-t border-white/10 bg-gradient-to-b from-bg-1 to-bg",
            cfg.glow,
            "sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2",
            "sm:w-[420px] sm:h-[600px] sm:max-h-[88vh] sm:rounded-3xl sm:border",
          )}
          onOpenAutoFocus={(e) => { e.preventDefault(); searchRef.current?.focus(); }}
        >
          {/* Mobile drag handle */}
          <div className="flex justify-center pt-3 pb-1 sm:hidden flex-shrink-0">
            <div className="w-9 h-1 rounded-full bg-white/20" />
          </div>

          {/* Header */}
          <div className={cn(
            "flex items-center justify-between px-5 pt-2 pb-3 flex-shrink-0",
            "bg-gradient-to-r to-transparent", cfg.grad,
          )}>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Dialog.Title className="font-display font-extrabold text-base text-ink leading-none">
                  {title ?? t("swap.tokenSelectorTitle")}
                </Dialog.Title>
                {cfg.badge && (
                  <span
                    className="font-mono text-[9px] px-2 py-0.5 rounded-full border tracking-widest uppercase flex-shrink-0"
                    style={{ color: cfg.accent, borderColor: `${cfg.accent}40`, background: `${cfg.accent}12` }}
                  >
                    {cfg.badge}
                  </span>
                )}
              </div>
              <p className="font-mono text-[10px] text-ink-3 tracking-wider mt-1 uppercase">
                {tokens.length} tokens
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Fechar"
                className="w-9 h-9 rounded-full flex items-center justify-center text-ink-2 bg-white/[0.05] border border-white/10 hover:bg-white/[0.10] hover:text-ink active:scale-95 transition-all flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Search */}
          <div className="px-5 pb-3 flex-shrink-0">
            <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-2xl bg-white/[0.05] border border-white/8 focus-within:bg-white/[0.07] transition-all"
              style={{ "--focus-border": cfg.accent } as React.CSSProperties}
            >
              <Search className="w-4 h-4 text-ink-3 flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("swap.tokenSelectorPlaceholder")}
                className="flex-1 bg-transparent outline-none text-sm font-medium text-ink placeholder:text-ink-4"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")}
                  className="w-5 h-5 rounded-full flex items-center justify-center bg-white/10 text-ink-3 hover:text-ink flex-shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Token list */}
          <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 border-t border-white/5">
            {filtered.length === 0 && (
              <p className="text-center font-mono text-[11px] text-ink-3 py-16">
                {t("swap.tokenSelectorNoMatch")}
              </p>
            )}

            {filtered.map((tok) => {
              const isCurrent  = selected?.address === tok.address && selected?.chain === tok.chain;
              const isZionPick = safePicks.has(tok.address);
              const isSafe     = (tok.riskScore ?? 99) <= 5;

              return (
                <button
                  key={`${tok.chain}:${tok.address}`}
                  type="button"
                  onClick={() => handleSelect(tok)}
                  className={cn(
                    "w-full flex items-center gap-3 px-5 py-3 transition-colors",
                    isCurrent ? "bg-white/[0.06]" : "hover:bg-white/[0.04] active:bg-white/[0.06]",
                  )}
                >
                  <TokenLogo token={tok} size={40} />

                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className="font-display font-bold text-sm leading-tight"
                        style={isCurrent ? { color: cfg.accent } : undefined}
                      >
                        {tok.symbol}
                      </span>
                      {isZionPick && (
                        <span className="flex items-center gap-0.5 font-mono text-[8px] px-1.5 py-0.5 rounded-full border border-cyan/30 bg-cyan/[0.08] text-cyan/90 tracking-widest uppercase flex-shrink-0">
                          <Sparkles className="w-2 h-2" />ZION
                        </span>
                      )}
                      {isSafe && !isZionPick && (
                        <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-full border border-green/25 bg-green/[0.07] text-green/80 tracking-widest uppercase flex-shrink-0">
                          SAFE
                        </span>
                      )}
                      {tok.tags?.includes("stablecoin") && (
                        <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-full border border-white/10 bg-white/[0.04] text-ink-3 tracking-widest uppercase flex-shrink-0">
                          STABLE
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-ink-3 truncate mt-0.5">{tok.name}</div>
                  </div>

                  <div className="text-right flex-shrink-0 min-w-[60px]">
                    {tok.priceUsd !== undefined && (
                      <div className="font-mono text-[12px] text-ink-2 tabular-nums">
                        {formatUsd(tok.priceUsd)}
                      </div>
                    )}
                    {isCurrent && (
                      <div className="flex items-center justify-end mt-1">
                        <span
                          className="w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: `${cfg.accent}20` }}
                        >
                          <Check className="w-3 h-3" style={{ color: cfg.accent }} />
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}

            <div className="h-4" />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
