"use client";

import { useUI, type AppMode } from "@/lib/store/ui";
import { cn } from "@/lib/cn";
import { Eye, Layers, EyeOff } from "lucide-react";

const MODES: { id: AppMode; label: string; icon: React.ComponentType<{ className?: string }>; color: string }[] = [
  { id: "standard", label: "Standard", icon: Layers, color: "text-cyan" },
  { id: "pro",      label: "Pro",      icon: Eye,    color: "text-violet" },
  { id: "privacy",  label: "Privacy",  icon: EyeOff, color: "text-gold" },
];

export default function ModeSwitcher() {
  const { mode, setMode } = useUI();

  return (
    <div className="hidden md:flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.03] border border-white/5">
      {MODES.map((m) => {
        const active = mode === m.id;
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              "relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-mono tracking-wider uppercase transition-all",
              active ? `${m.color} bg-white/[0.05]` : "text-ink-3 hover:text-ink-2",
            )}
            aria-pressed={active}
          >
            <Icon className="w-3 h-3" />
            <span className="hidden lg:inline">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
