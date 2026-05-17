// GoPlus Security API — public, no key required
// https://docs.gopluslabs.io/reference/api-overview

const CHAIN_IDS: Record<string, string> = {
  ethereum:  "1",
  bsc:       "56",
  polygon:   "137",
  base:      "8453",
  arbitrum:  "42161",
  optimism:  "10",
  avalanche: "43114",
  zksync:    "324",
  linea:     "59144",
};

export interface GoPlusTokenSecurity {
  is_honeypot?:           string;      // "0" | "1"
  buy_tax?:               string;      // "0.05" = 5%
  sell_tax?:              string;
  is_open_source?:        string;
  is_proxy?:              string;
  is_mintable?:           string;
  can_take_back_ownership?: string;
  owner_change_balance?:  string;
  hidden_owner?:          string;
  selfdestruct?:          string;
  external_call?:         string;
  cannot_buy?:            string;
  cannot_sell_all?:       string;
  trading_cooldown?:      string;
  is_blacklisted?:        string;
  is_whitelisted?:        string;
  is_anti_whale?:         string;
  slippage_modifiable?:   string;
  personal_slippage_modifiable?: string;
  token_name?:            string;
  token_symbol?:          string;
  total_supply?:          string;
  holder_count?:          string;
  lp_holder_count?:       string;
  lp_total_supply?:       string;
  dex?:                   { name: string; liquidity: string; pair: string }[];
  holders?:               { address: string; tag?: string; is_contract?: number; balance: string; percent: string; is_locked?: number }[];
  lp_holders?:            { address: string; tag?: string; is_contract?: number; balance: string; percent: string; is_locked?: number }[];
}

export interface GoPlusResponse {
  code: number;
  message: string;
  result: Record<string, GoPlusTokenSecurity>;
}

export async function getTokenSecurity(chainName: string, address: string): Promise<GoPlusTokenSecurity | null> {
  const chainId = CHAIN_IDS[chainName];
  if (!chainId) return null;
  if (!address || address === "native") return null;

  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address.toLowerCase()}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GoPlusResponse;
    if (data.code !== 1) return null;
    return data.result?.[address.toLowerCase()] ?? null;
  } catch {
    return null;
  }
}

export function isGoPlusSupported(chainName: string): boolean {
  return chainName in CHAIN_IDS;
}
