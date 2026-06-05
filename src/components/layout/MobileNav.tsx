"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, Globe } from "lucide-react";
import { useUI, type AppLang } from "@/lib/store/ui";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { NAV_ITEMS, NAV_BADGE_CLASSES } from "./nav-items";

const LANGS: { id: AppLang; label: string; flag: string }[] = [
  { id: "en", label: "English",   flag: "🇺🇸" },
  { id: "pt", label: "Português", flag: "🇧🇷" },
  { id: "es", label: "Español",   flag: "🇪🇸" },
  { id: "zh", label: "中文",       flag: "🇨🇳" },
];

export default function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { lang, setLang } = useUI();
  const t = useT();

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm animate-fade-in lg:hidden" />
        <Dialog.Content className="fixed left-0 top-0 bottom-0 z-50 w-[85%] max-w-xs glass-strong border-r border-white/10 lg:hidden outline-none flex flex-col">
          <Dialog.Title className="sr-only">{t("topbar.openCommand")}</Dialog.Title>
          <div className="h-16 flex items-center justify-between px-4 border-b border-white/5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-grad-cyan flex items-center justify-center">
                <span className="font-display font-extrabold text-bg text-sm leading-none">Z</span>
              </div>
              <span className="font-display font-extrabold text-ink text-sm">Z-SWAP</span>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-md flex items-center justify-center text-ink-2 hover:text-ink hover:bg-white/5">
              <X className="w-4 h-4" />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto py-3 px-3">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-3 py-3 rounded-lg transition-colors",
                    active ? "bg-white/[0.06] text-ink" : "text-ink-2 hover:bg-white/5 hover:text-ink",
                  )}
                >
                  <Icon className={cn("w-4 h-4 flex-shrink-0", active ? "text-cyan" : "text-ink-3")} />
                  <span className="font-sans text-sm flex-1 truncate">{t(item.labelKey)}</span>
                  {item.badgeKey && item.badgeTone && (
                    <span className={cn(
                      "font-mono text-[9px] tracking-widest px-1.5 py-0.5 rounded-full border flex-shrink-0",
                      NAV_BADGE_CLASSES[item.badgeTone],
                    )}>
                      {t(item.badgeKey)}
                    </span>
                  )}
                </Link>
              );
            })}

            {/* Language picker — moved out of the topbar to keep the header
                uncluttered on mobile. Lives near the bottom of the drawer. */}
            <div className="mt-4 pt-4 border-t border-white/5">
              <div className="px-3 mb-2 flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-ink-3" />
                <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
                  {t("topbar.languageLabel")}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1 px-1">
                {LANGS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLang(l.id)}
                    className={cn(
                      "flex flex-col items-center gap-0.5 py-2 rounded-lg transition-colors",
                      lang === l.id
                        ? "bg-cyan/15 border border-cyan/30 text-cyan"
                        : "text-ink-3 hover:text-ink-2 border border-transparent",
                    )}
                  >
                    <span className="text-base leading-none">{l.flag}</span>
                    <span className="font-mono text-[9px] tracking-widest uppercase">{l.id}</span>
                  </button>
                ))}
              </div>
            </div>
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
