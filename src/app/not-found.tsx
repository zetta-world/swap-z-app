"use client";

import Link from "next/link";
import { Compass, Home, Search, LineChart } from "lucide-react";
import { useT } from "@/lib/i18n";

// Global 404. Renders inside the root layout's <AppShell>, so the sidebar,
// topbar and navigation stay available — a wrong URL never strands the user
// on a blank page. Visual language matches RouteErrorFallback.
export default function NotFound() {
  const t = useT();

  const links: { href: string; labelKey: Parameters<typeof t>[0]; Icon: typeof Home }[] = [
    { href: "/",          labelKey: "notFound.linkSwap",      Icon: Home      },
    { href: "/explorer",  labelKey: "notFound.linkExplorer",  Icon: Search    },
    { href: "/portfolio", labelKey: "notFound.linkPortfolio", Icon: LineChart },
  ];

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-25 pointer-events-none" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[420px] h-[420px] rounded-full bg-cyan/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-xl mx-auto px-4 py-12 sm:py-20">
        <div className="rounded-2xl border border-cyan/20 bg-bg-1/60 glass-pane p-6 sm:p-8 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan/10 border border-cyan/30 flex items-center justify-center flex-shrink-0">
              <Compass className="w-4 h-4 text-cyan" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1">404</div>
              <h1 className="font-display font-extrabold text-xl sm:text-2xl text-ink">
                {t("notFound.title")}
              </h1>
              <p className="font-sans text-sm text-ink-2 leading-relaxed mt-1.5">
                {t("notFound.body")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {links.map(({ href, labelKey, Icon }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-white/10 bg-white/[0.03] text-ink font-mono text-[11px] tracking-widest uppercase hover:bg-white/[0.06] first:border-cyan/40 first:bg-cyan/15 first:text-cyan"
              >
                <Icon className="w-3 h-3" />
                {t(labelKey)}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
