"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useUI } from "@/lib/store/ui";
import { DEFAULT_TOKENS } from "@/lib/tokens";
import { CHAINS } from "@/lib/chains";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { NAV_ITEMS, NAV_BADGE_CLASSES } from "./nav-items";

export default function CommandBar() {
  const { commandOpen, setCommand, toggleCommand } = useUI();
  const router = useRouter();
  const t = useT();

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
          <Dialog.Title className="sr-only">{t("topbar.openCommand")}</Dialog.Title>
          <Command
            label={t("topbar.openCommand")}
            className="rounded-2xl border border-white/10 glass-strong shadow-card overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 border-b border-white/5">
              <Search className="w-4 h-4 text-ink-3" />
              <Command.Input
                placeholder={t("topbar.commandPlaceholder")}
                className="flex-1 min-w-0 py-4 bg-transparent text-ink placeholder:text-ink-3 outline-none font-sans text-sm"
              />
              <kbd className="font-mono text-[10px] text-ink-3 px-1.5 py-0.5 rounded border border-white/10">ESC</kbd>
            </div>

            <Command.List className="max-h-[420px] overflow-y-auto p-2">
              <Command.Empty className="py-8 text-center font-sans text-sm text-ink-3">
                {t("topbar.commandEmpty")}
              </Command.Empty>

              <Command.Group heading={t("topbar.commandNavigate")} className="px-1 py-1 [&>[cmdk-group-heading]]:font-mono [&>[cmdk-group-heading]]:text-[10px] [&>[cmdk-group-heading]]:tracking-widest [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:text-ink-4 [&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:py-1.5">
                {NAV_ITEMS.map((p) => {
                  const Icon = p.icon;
                  return (
                    <Command.Item
                      key={p.href}
                      onSelect={() => go(p.href)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-ink-2 data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-ink"
                    >
                      <Icon className="w-4 h-4 text-ink-3 flex-shrink-0" />
                      <span className="font-sans text-sm flex-1 truncate">{t(p.labelKey)}</span>
                      {p.badgeKey && p.badgeTone && (
                        <span className={cn(
                          "font-mono text-[9px] tracking-widest px-1.5 py-0.5 rounded-full border flex-shrink-0",
                          NAV_BADGE_CLASSES[p.badgeTone],
                        )}>
                          {t(p.badgeKey)}
                        </span>
                      )}
                    </Command.Item>
                  );
                })}
              </Command.Group>

              <Command.Group heading={t("topbar.commandTokens")} className="px-1 py-1 [&>[cmdk-group-heading]]:font-mono [&>[cmdk-group-heading]]:text-[10px] [&>[cmdk-group-heading]]:tracking-widest [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:text-ink-4 [&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:py-1.5">
                {DEFAULT_TOKENS.slice(0, 12).map((tk) => (
                  <Command.Item
                    key={`${tk.chain}-${tk.symbol}`}
                    onSelect={() => go(`/explorer?token=${tk.symbol}&chain=${tk.chain}`)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-ink-2 data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-ink"
                  >
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center font-mono text-[10px] font-bold"
                      style={{ background: `${tk.color}22`, color: tk.color, border: `1px solid ${tk.color}44` }}
                    >
                      {tk.symbol.slice(0, 2)}
                    </span>
                    <span className="font-sans text-sm flex-1">{tk.symbol} — {tk.name}</span>
                    <span className="font-mono text-[10px] text-ink-3 uppercase">{tk.chain}</span>
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading={t("topbar.commandChains")} className="px-1 py-1 [&>[cmdk-group-heading]]:font-mono [&>[cmdk-group-heading]]:text-[10px] [&>[cmdk-group-heading]]:tracking-widest [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:text-ink-4 [&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:py-1.5">
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
                <span><kbd className="text-ink-3">↑↓</kbd> {t("topbar.commandHintNav")}</span>
                <span><kbd className="text-ink-3">↵</kbd> {t("topbar.commandHintSelect")}</span>
              </div>
              <span>Z-SWAP Nexus</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
