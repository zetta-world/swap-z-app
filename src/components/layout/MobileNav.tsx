"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, ArrowLeftRight, Workflow, Sparkles, Layers, Rocket, BarChart3, Shield, Vote, Wallet, Settings, Activity } from "lucide-react";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/",          label: "Swap",          icon: ArrowLeftRight },
  { href: "/bridge",    label: "Bridge",        icon: Workflow },
  { href: "/orders",    label: "Limit / DCA",   icon: Activity },
  { href: "/pro",       label: "Pro Terminal",  icon: BarChart3 },
  { href: "/pools",     label: "Pools",         icon: Layers },
  { href: "/explorer",  label: "Risk Scanner",  icon: Shield },
  { href: "/zion",      label: "ZION AI",       icon: Sparkles },
  { href: "/launchpad", label: "Z-PAD",         icon: Rocket },
  { href: "/governance", label: "Governance",   icon: Vote },
  { href: "/portfolio", label: "Portfolio",     icon: Wallet },
  { href: "/settings",  label: "Settings",      icon: Settings },
];

export default function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm animate-fade-in lg:hidden" />
        <Dialog.Content className="fixed left-0 top-0 bottom-0 z-50 w-[85%] max-w-xs glass-strong border-r border-white/10 lg:hidden outline-none flex flex-col">
          <Dialog.Title className="sr-only">Menu</Dialog.Title>
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
            {NAV.map((item) => {
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
                  <Icon className={cn("w-4 h-4", active ? "text-cyan" : "text-ink-3")} />
                  <span className="font-sans text-sm">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
