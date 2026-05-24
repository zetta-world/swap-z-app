"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Globe, Check } from "lucide-react";
import { useUI, type AppLang } from "@/lib/store/ui";
import { useT } from "@/lib/i18n";

const LANGS: { id: AppLang; label: string; flag: string }[] = [
  { id: "en", label: "English",    flag: "🇺🇸" },
  { id: "pt", label: "Português",  flag: "🇧🇷" },
  { id: "es", label: "Español",    flag: "🇪🇸" },
  { id: "zh", label: "中文",        flag: "🇨🇳" },
];

export default function LangSwitcher() {
  const { lang, setLang } = useUI();
  const t = useT();
  const current = LANGS.find((l) => l.id === lang) ?? LANGS[0];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-white/8 bg-white/[0.03] text-ink-2 hover:text-cyan hover:border-cyan/30 transition-colors text-[11px] font-mono uppercase tracking-wider"
          aria-label={t("topbar.selectLanguage")}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>{current.id.toUpperCase()}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[160px] p-1 rounded-xl border border-white/10 glass-strong shadow-card"
        >
          {LANGS.map((l) => (
            <DropdownMenu.Item
              key={l.id}
              onSelect={() => setLang(l.id)}
              className="flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-ink-2 hover:text-ink hover:bg-white/5 outline-none cursor-pointer"
            >
              <span className="text-base">{l.flag}</span>
              <span className="flex-1 min-w-0 font-sans truncate">{l.label}</span>
              {lang === l.id && <Check className="w-3.5 h-3.5 text-cyan" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
