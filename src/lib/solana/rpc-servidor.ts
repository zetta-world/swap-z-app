/**
 * RPC da Solana usado pelo SERVIDOR (conferência de conta de taxa, simulação da transação Jupiter).
 * `HELIUS_RPC_URL` → `NEXT_PUBLIC_SOLANA_RPC` → mainnet-beta pública.
 */
export function rpcSolanaServidor(): string {
  return (process.env.HELIUS_RPC_URL ?? process.env.NEXT_PUBLIC_SOLANA_RPC ?? "").trim()
    || "https://api.mainnet-beta.solana.com";
}
