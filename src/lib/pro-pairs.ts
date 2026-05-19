import type { ChainId } from "./chains";

/**
 * Curated pairs for the Pro Terminal. Each entry points at a real, deep-
 * liquidity pool on GeckoTerminal. `targetSymbol` is the asset we want to
 * see priced on the chart — the chart code fetches the pool's metadata
 * and automatically chooses `token=base` or `token=quote` based on which
 * side of the pool that symbol lives on. This avoids the foot-gun where
 * a pool like BNB/USDT on PancakeSwap V2 actually has USDT as token0
 * and would chart $1 instead of $700 if we naively requested `token=base`.
 *
 * Categorized so we can render a group header in the picker.
 */

export interface ProPair {
  id:           string;
  chain:        ChainId;
  pool:         string;     // pool contract address
  base:         string;     // display base
  quote:        string;     // display quote
  targetSymbol: string;     // which symbol's price the chart should show (= base)
  dex:          string;
  feeTier?:     string;
  category:     "blue-chip" | "alt" | "stable" | "meme" | "lst";
}

export const PRO_PAIRS: ProPair[] = [
  // ─── Ethereum blue chips ─────────────────────────────────────────────
  { id: "eth-usdc-uni-v3-005",  chain: "ethereum", pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640", base: "ETH",   quote: "USDC", targetSymbol: "WETH", dex: "Uniswap V3",  feeTier: "0.05%", category: "blue-chip" },
  { id: "eth-usdt-uni-v3-005",  chain: "ethereum", pool: "0x11b815efB8f581194ae79006d24E0d814B7697F6", base: "ETH",   quote: "USDT", targetSymbol: "WETH", dex: "Uniswap V3",  feeTier: "0.05%", category: "blue-chip" },
  { id: "wbtc-usdc-uni-v3-03",  chain: "ethereum", pool: "0x99ac8cA7087fA4A2A1FB6357269965A2014ABc35", base: "WBTC",  quote: "USDC", targetSymbol: "WBTC", dex: "Uniswap V3",  feeTier: "0.30%", category: "blue-chip" },
  { id: "wbtc-eth-uni-v3-03",   chain: "ethereum", pool: "0xCBCdF9626bC03E24f779434178A73a0B4bad62eD", base: "WBTC",  quote: "ETH",  targetSymbol: "WBTC", dex: "Uniswap V3",  feeTier: "0.30%", category: "blue-chip" },

  // ─── Ethereum LSTs / DeFi ────────────────────────────────────────────
  { id: "wsteth-eth-uni-v3",    chain: "ethereum", pool: "0x109830a1AAaD605BbF02a9dFA7B0B92319eFEf73", base: "wstETH",quote: "ETH",  targetSymbol: "wstETH", dex: "Uniswap V3", feeTier: "0.01%", category: "lst" },
  { id: "link-eth-uni-v3-03",   chain: "ethereum", pool: "0xa6Cc3C2531FdaA6Ae1A3CA84c2855806728693e8", base: "LINK",  quote: "ETH",  targetSymbol: "LINK", dex: "Uniswap V3",  feeTier: "0.30%", category: "alt" },
  { id: "uni-eth-uni-v3-03",    chain: "ethereum", pool: "0x1d42064Fc4Beb5F8aAF85F4617AE8b3b5B8Bd801", base: "UNI",   quote: "ETH",  targetSymbol: "UNI",  dex: "Uniswap V3",  feeTier: "0.30%", category: "alt" },
  { id: "aave-eth-uni-v3-03",   chain: "ethereum", pool: "0x5aB53EE1d50eeF2C1DD3d5402789cd27bB52c1bB", base: "AAVE",  quote: "ETH",  targetSymbol: "AAVE", dex: "Uniswap V3",  feeTier: "0.30%", category: "alt" },
  { id: "pepe-eth-uni-v3-03",   chain: "ethereum", pool: "0x11950d141EcB863F01007AdD7D1A342041227b58", base: "PEPE",  quote: "ETH",  targetSymbol: "PEPE", dex: "Uniswap V3",  feeTier: "0.30%", category: "meme" },
  { id: "shib-eth-uni-v3-03",   chain: "ethereum", pool: "0x2F62f2B4c5fcd7570a709DeC05D68EA19c82A9ec", base: "SHIB",  quote: "ETH",  targetSymbol: "SHIB", dex: "Uniswap V3",  feeTier: "0.30%", category: "meme" },

  // ─── BSC blue chips ──────────────────────────────────────────────────
  { id: "bnb-usdt-pcs-v3",      chain: "bsc",      pool: "0x172fcD41E0913e95784454622d1c3724f546f849", base: "BNB",   quote: "USDT", targetSymbol: "WBNB", dex: "PancakeSwap V3", feeTier: "0.05%", category: "blue-chip" },
  { id: "bnb-usdc-pcs-v3",      chain: "bsc",      pool: "0xf2688Fb5B81049DFB7703aDa5e770543770612C4", base: "BNB",   quote: "USDC", targetSymbol: "WBNB", dex: "PancakeSwap V3", feeTier: "0.05%", category: "blue-chip" },
  { id: "btcb-usdt-pcs-v3",     chain: "bsc",      pool: "0x46Cf1cF8c69595804ba91dFdd8d6b960c9B0a7C4", base: "BTCB",  quote: "USDT", targetSymbol: "BTCB", dex: "PancakeSwap V3", feeTier: "0.05%", category: "blue-chip" },
  { id: "eth-usdt-bsc-pcs-v3",  chain: "bsc",      pool: "0x9fEFE9b94DC8E76E76A6c8FaC57e08F4ad3Ba70F", base: "ETH",   quote: "USDT", targetSymbol: "ETH",  dex: "PancakeSwap V3", feeTier: "0.05%", category: "blue-chip" },
  { id: "cake-bnb-pcs-v3",      chain: "bsc",      pool: "0x133B3D95bAD5405d14d53473671200e9342896BF", base: "CAKE",  quote: "BNB",  targetSymbol: "Cake", dex: "PancakeSwap V3", feeTier: "0.25%", category: "alt" },

  // ─── Arbitrum ────────────────────────────────────────────────────────
  { id: "arb-usdc-uni-v3-005",  chain: "arbitrum", pool: "0xC6962004f452bE9203591991D15f6b388e09E8D0", base: "ARB",   quote: "USDC", targetSymbol: "ARB",  dex: "Uniswap V3", feeTier: "0.05%", category: "alt" },
  { id: "eth-usdc-arb-uni-v3",  chain: "arbitrum", pool: "0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443", base: "ETH",   quote: "USDC", targetSymbol: "WETH", dex: "Uniswap V3", feeTier: "0.05%", category: "blue-chip" },
  { id: "gmx-eth-arb-uni-v3",   chain: "arbitrum", pool: "0x80a9ae39310abf666A87C743d6ebBD0E8C42158E", base: "GMX",   quote: "WETH", targetSymbol: "GMX",  dex: "Uniswap V3", feeTier: "1.00%", category: "alt" },

  // ─── Base ────────────────────────────────────────────────────────────
  { id: "eth-usdc-base-aero",   chain: "base",     pool: "0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59", base: "ETH",   quote: "USDC", targetSymbol: "WETH", dex: "Aerodrome",     category: "blue-chip" },
  { id: "cbbtc-usdc-base-uni",  chain: "base",     pool: "0xfBB6Eed8e7aa03B138556eeDaF5D271A5E1e43ef", base: "cbBTC", quote: "USDC", targetSymbol: "cbBTC",dex: "Uniswap V3",    category: "blue-chip" },

  // ─── Polygon ─────────────────────────────────────────────────────────
  { id: "matic-usdc-uni-v3",    chain: "polygon",  pool: "0xA374094527e1673A86dE625aa59517c5dE346d32", base: "WMATIC", quote: "USDC", targetSymbol: "WMATIC", dex: "Uniswap V3", feeTier: "0.05%", category: "blue-chip" },

  // ─── Optimism ────────────────────────────────────────────────────────
  { id: "op-usdc-uni-v3",       chain: "optimism", pool: "0xB589969D38CE76D3d7AA319De7133bC9755fD840", base: "OP",    quote: "USDC", targetSymbol: "OP",   dex: "Uniswap V3", feeTier: "0.30%", category: "alt" },

  // ─── Avalanche ───────────────────────────────────────────────────────
  { id: "avax-usdc-tj-v21",     chain: "avalanche", pool: "0x864d4e5Ee7318e97483DB7EB0912E09F161516EA", base: "AVAX",  quote: "USDC", targetSymbol: "WAVAX", dex: "Trader Joe v2.1", category: "blue-chip" },
];

export const DEFAULT_PRO_PAIR = PRO_PAIRS[0];

// ─── Grouping for the picker ─────────────────────────────────────────

export const CATEGORY_LABELS: Record<ProPair["category"], string> = {
  "blue-chip": "Blue chip",
  "alt":       "Altcoin / DeFi",
  "lst":       "Liquid staking",
  "stable":    "Stable pair",
  "meme":      "Meme",
};

export function groupPairs(pairs: ProPair[] = PRO_PAIRS) {
  const groups: Record<string, ProPair[]> = {};
  for (const p of pairs) {
    const k = p.category;
    (groups[k] = groups[k] || []).push(p);
  }
  return groups;
}
