"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import CommandBar from "./CommandBar";
import MobileNav from "./MobileNav";
import ZionDrawer from "@/components/zion/ZionDrawer";
import { useUI } from "@/lib/store/ui";
import { cn } from "@/lib/cn";

// Lazy guard — only imports the heavy execute portal (and pulls in the swap
// quote stack) the first time the user opens a swap. Keeps page-navigation
// payloads small while staying globally available.
const ExecuteSwapGuard = dynamic(() => import("@/components/swap/ExecuteSwapGuard"), {
  ssr:     false,
  loading: () => null,
});

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed } = useUI();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="relative min-h-screen">
      <Sidebar />

      <div
        className={cn(
          "flex flex-col min-h-screen transition-[padding] duration-300",
          sidebarCollapsed ? "lg:pl-[80px]" : "lg:pl-[248px]",
        )}
      >
        <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
        <main className="flex-1 min-w-0 overflow-x-hidden">
          {children}
        </main>
      </div>

      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <CommandBar />
      <ZionDrawer />
      <ExecuteSwapGuard />
    </div>
  );
}
