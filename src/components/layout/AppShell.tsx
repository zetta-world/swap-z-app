"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import CommandBar from "./CommandBar";
import MobileNav from "./MobileNav";
import PageTransition from "./PageTransition";
import ZionDrawer from "@/components/zion/ZionDrawer";
import ConnectModal from "@/components/wallet/ConnectModal";
import TierAccentProvider from "@/components/tier/TierAccentProvider";
import GodThemeLayer from "@/components/tier/GodThemeLayer";
import { useUI } from "@/lib/store/ui";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useOrderWatcher } from "@/lib/hooks/useOrderWatcher";
import { useOperationSync } from "@/lib/hooks/useOperationSync";

// Lazy guard — only imports the heavy execute portal (and pulls in the swap
// quote stack) the first time the user opens a swap. Keeps page-navigation
// payloads small while staying globally available.
const ExecuteSwapGuard = dynamic(() => import("@/components/swap/ExecuteSwapGuard"), {
  ssr:     false,
  loading: () => null,
});

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed, mode, walletModalOpen, setWalletModal } = useUI();
  const [mobileOpen, setMobileOpen] = useState(false);
  const t = useT();
  useOrderWatcher();
  useOperationSync(); // mirror confirmed operations to the server ledger

  // Drive `data-mode` on <html> so the standard / pro / privacy UI mode can
  // alter the app globally via CSS (privacy blurs balances, pro densifies).
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-mode", mode);
    return () => el.removeAttribute("data-mode");
  }, [mode]);

  return (
    <TierAccentProvider>
      <div className="relative min-h-screen">
        <a href="#main-content" className="skip-link">{t("common.skipToContent")}</a>
        <GodThemeLayer />
        <Sidebar />

        <div
          className={cn(
            "relative z-[1] flex flex-col min-h-screen transition-[padding] duration-300",
            sidebarCollapsed ? "lg:pl-[80px]" : "lg:pl-[248px]",
          )}
        >
          <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
          <main id="main-content" className="flex-1 min-w-0 overflow-x-hidden">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>

        <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} />
        <CommandBar />
        <ZionDrawer />
        <ExecuteSwapGuard />
        {/* Global wallet connector — opened by any surface via setWalletModal. */}
        <ConnectModal open={walletModalOpen} onOpenChange={setWalletModal} />
      </div>
    </TierAccentProvider>
  );
}
