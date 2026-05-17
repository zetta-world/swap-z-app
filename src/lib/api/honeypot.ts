// Honeypot.is API — free, no key
// https://docs.honeypot.is/

const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  bsc:      56,
  base:     8453,
};

export interface HoneypotResponse {
  token?: {
    name?:     string;
    symbol?:   string;
    decimals?: number;
    address?:  string;
    totalHolders?: number;
  };
  withToken?: {
    name?: string; symbol?: string;
  };
  summary?: {
    risk?:           "low" | "medium" | "high" | "honeypot";
    riskLevel?:      number;
    flags?:          string[];
  };
  simulationResult?: {
    buyTax?:       number;
    sellTax?:      number;
    transferTax?:  number;
    buyGas?:       string;
    sellGas?:      string;
  };
  honeypotResult?: {
    isHoneypot?: boolean;
    honeypotReason?: string;
  };
  pair?: {
    pair?: { name?: string; address?: string; tokens?: string[] };
    chainId?: string;
    reserves0?: string;
    reserves1?: string;
    liquidity?: number;
    router?: string;
  };
}

export async function getHoneypot(chainName: string, address: string): Promise<HoneypotResponse | null> {
  const chainId = CHAIN_IDS[chainName];
  if (!chainId) return null;
  if (!address || address === "native") return null;

  const url = `https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${chainId}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as HoneypotResponse;
  } catch {
    return null;
  }
}

export function isHoneypotSupported(chainName: string): boolean {
  return chainName in CHAIN_IDS;
}
