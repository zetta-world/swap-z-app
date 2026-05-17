"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight, Workflow, Activity, BarChart3, Layers, Shield,
  Sparkles, Rocket, Vote, Wallet, Settings, Search,
} from "lucide-react";
import { useUI } from "@/lib/store/ui";
import { DEFAULT_TOKENS } from "@/lib/tokens";
import { CHAINS } from "@/lib/chains";

const PAGES = [
  { href: "/",          label: "Swap",          icon: ArrowLeftRight },
  { href: "/bridge",    label: "Bridge",        icon: Workflow },
  { href: "/orders",    label: "Limit / DCA",   icon: Activity },
  { href: "/pro",       label: "Pro Terminal",  icon: BarChart3 },
  { href: "/pools",     label: "Pools",         icon: Layers },
  { href: "/explorer",  label: "Risk Scanner",  icon: Shield },
  { href: "/zion",      label: "ZION AI",       icon: Sparkles },
  { href: "/launchpad", label: "Z-PAD Launchpad", icon: Rocket },
  { href: "/governance", label: "Governance",   icon: Vote },
  { href: "/portfolio", label: "Portfolio",     icon: Wallet },
  { href: "/settings",  label: "Settings",      icon: Settings },
];

export default function CommandBar() {
  const { commandOpen, setCommand, toggleCommand } = useUI();
  const router = useRouter();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleCommand();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleCommand]);

  const go = (href: string) => {
    setCommand(false);
    router.push(href);
  };

  return (
    <Dialog.Root open={commandOpen} onOpenChange={setCommand}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-[15%] z-50 w-[95%] max-w-2xl -translate-x-1/2 outline-none animate-scale-in">
          <Dialog.Title className="sr-only">Command Palette</Dialog.Title>
          <Command
            label="Command Menu"
            className="rounded-2xl border border-white/10 glass-strong shadow-card overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 border-b border-white/5">
              <Search className="w-4 h-4 text-ink-3" />
              <Command.Input
                placeholder="Type a command or search…"
                className="flex-1 py-4 bg-transparent text-ink placeholder:text-ink-3 outline-none font-sans text-sm"
              />
              <kbd className="font-mono text-[10px] text-ink-3 px-1.5 py-0.5 rounded border border-white/10">ESC</kbd>
            </div>

            <Command.List className="max-h-[420px] overflow-y-auto p-2">
              <Command.Empty className="py-8 text-center font-sans text-sm text-ink-3">
                No results. Try a token symbol, chain, or page name.
              </Command.Empty>

              <Command.Group heading="Navigate" className="px-1 py-1 [&>[cmdk-group-heading]]:font-mono [&>[cmdk-group-heading]]:text-[10px] [&>[cmdk-group-heading]]:tracking-widest [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:text-ink-4 [&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:py-1.5">
                {PAGES.map((p) => {
                  const Icon = p.icon;
                  return (
                    <Command.Item
                      key={p.href}
                      onSelect={() => go(p.href)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-ink-2 data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-ink"
                    >
                      <Icon className="w-4 h-4 text-ink-3" />
                      <span className="font-sans text-sm">{p.label}</span>
                    </Command.Item>
                  );
                })}
              </Command.Group>

              <Command.Group heading="Tokens" className="px-1 py-1 [&>[cmdk-group-heading]]:font-mono [&>[cmdk-group-heading]]:text-[10px] [&>[cmdk-group-heading]]:tracking-widest [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:text-ink-4 [&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:py-1.5">
                {DEFAULT_TOKENS.slice(0, 12).map((t) => (
                  <Command.Item
                    key={`${t.chain}-${t.symbol}`}
                    onSelect={() => go(`/explorer?token=${t.symbol}&chain=${t.chain}`)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-ink-2 data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-ink"
                  >
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center font-mono text-[10px] font-bold"
                      style={{ background: `${t.color}22`, color: t.color, border: `1px solid ${t.color}44` }}
                    >
                      {t.symbol.slice(0, 2)}
                    </span>
                    <span className="font-sans text-sm flex-1">{t.symbol} — {t.name}</span>
                    <span className="font-mono text-[10px] text-ink-3 uppercase">{t.chain}</span>
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading="Chains" className="px-1 py-1 [&>[cmdk-group-heading]]:font-mono [&>[cmdk-group-heading]]:text-[10px] [&>[cmdk-group-heading]]:tracking-widest [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:text-ink-4 [&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:py-1.5">
                {CHAINS.map((c) => (
                  <Command.Item
                    key={c.id}
                    onSelect={() => go(`/pools?chain=${c.id}`)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-ink-2 data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-ink"
                  >
                    <span className="w-6 h-6 rounded-full" style={{ background: c.gradient }} />
                    <span className="font-sans text-sm flex-1">{c.name}</span>
                    <span className="font-mono text-[10px] text-ink-3">{c.short}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>

            <div className="border-t border-white/5 px-3 py-2 flex items-center justify-between text-[10px] font-mono text-ink-4">
              <div className="flex items-center gap-3">
                <span><kbd className="text-ink-3">↑↓</kbd> navigate</span>
                <span><kbd className="text-ink-3">↵</kbd> select</span>
              </div>
              <span>Z-SWAP Nexus</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
