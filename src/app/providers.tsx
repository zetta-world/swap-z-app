"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import {
  ConnectionProvider as RawConnectionProvider,
  WalletProvider     as RawWalletProvider,
} from "@solana/wallet-adapter-react";
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useUI } from "@/lib/store/ui";
import { Toaster } from "sonner";
import Beacon from "@/components/layout/Beacon";
import { wagmiConfig } from "@/lib/wagmi";
import { SOLANA_RPC, SOLANA_WALLETS } from "@/lib/solana";

// The @solana/wallet-adapter-react package predates React 18's FC return type
// tightening. Casting through `unknown` here doesn't change runtime behavior,
// it just lets TS accept these components with `children`.
const ConnectionProvider = RawConnectionProvider as unknown as ComponentType<{
  endpoint: string;
  children: ReactNode;
}>;
const WalletProvider = RawWalletProvider as unknown as ComponentType<{
  wallets:     typeof SOLANA_WALLETS;
  autoConnect?: boolean;
  children:    ReactNode;
}>;

const LANG_MAP: Record<string, string> = { en: "en", pt: "pt-BR", es: "es", zh: "zh-CN" };

function LangSync() {
  const { lang } = useUI();
  useEffect(() => {
    document.documentElement.lang = LANG_MAP[lang] ?? lang;
  }, [lang]);
  return null;
}

export default function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  // Adapters are stable; memoize so React doesn't tear them down between renders.
  const solanaWallets = useMemo(() => SOLANA_WALLETS, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <ConnectionProvider endpoint={SOLANA_RPC}>
        <WalletProvider wallets={solanaWallets} autoConnect>
          <QueryClientProvider client={qc}>
            <LangSync />
            <Beacon />
            {children}
            <Toaster
              position="top-right"
              theme="dark"
              toastOptions={{
                style: {
                  background: "rgba(8,11,34,0.92)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  backdropFilter: "blur(20px)",
                  color: "#F2F4FF",
                },
              }}
            />
          </QueryClientProvider>
        </WalletProvider>
      </ConnectionProvider>
    </WagmiProvider>
  );
}
