"use client";

import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useTier } from "@/lib/tier/client";
import { pedidoDeConexao, sessaoDeOutraCarteira } from "@/lib/wallet/sessao-carteira";

/**
 * W4 — ver `lib/wallet/sessao-carteira.ts`.
 *   · `PhantomConexaoPendente`: dentro do navegador da Phantom, depois do deeplink, pede a conexão.
 *   · `CoerenciaDeSessao`: encerra a sessão assinada quando a carteira conectada da MESMA rede é OUTRA.
 */
export function PhantomConexaoPendente() {
  const { wallets, select } = useWallet();
  const feito = useRef(false);
  useEffect(() => {
    if (feito.current || typeof window === "undefined") return;
    const { pedido, limpa } = pedidoDeConexao(window.location.href);
    if (!pedido) { feito.current = true; return; }
    const phantom = wallets.find((w) => w.adapter.name === "Phantom");
    // A injeção do provedor pode chegar um instante depois: espera o `Installed`.
    if (!phantom || phantom.readyState !== "Installed") return;
    feito.current = true;
    window.history.replaceState(null, "", limpa);
    select(phantom.adapter.name);
    phantom.adapter.connect().catch(() => { /* cancelou na Phantom: segue desconectado */ });
  }, [wallets, select]);
  return null;
}

export function CoerenciaDeSessao() {
  const { publicKey } = useWallet();
  const { address: evm } = useAccount();
  const { authenticated, address: sessao, refresh } = useTier();
  const encerrando = useRef(false);
  const sol = publicKey?.toBase58() ?? null;
  useEffect(() => {
    if (!authenticated || encerrando.current) return;
    if (!sessaoDeOutraCarteira(sessao, { solana: sol, evm: evm ?? null })) return;
    encerrando.current = true;
    fetch("/api/auth/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => { encerrando.current = false; void refresh(); });
  }, [authenticated, sessao, sol, evm, refresh]);
  return null;
}
