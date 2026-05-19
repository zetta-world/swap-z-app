import type { ChainId } from "./chains";

/**
 * Curated top pools for the Pro Terminal. Each entry is a real, deep-liquidity
 * pool on GeckoTerminal so OHLCV + trades work out of the box.
 *
 * The user can pick from these via the pair selector. In the future this can
 * be enriched by /api/pools data.
 */

export interface ProPair {
  id:       string;
  chain:    ChainId;
  pool:     string;     // pool contract address
  base:     string;
  quote:    string;
  dex:      string;     // human label
  feeTier?: string;
}

export const PRO_PAIRS: ProPair[] = [
  { id: "eth-usdc-uni-v3-005", chain: "ethereum", pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640", base: "ETH",  quote: "USDC", dex: "Uniswap V3", feeTier: "0.05%" },
  { id: "eth-usdt-uni-v3-005", chain: "ethereum", pool: "0x11b815efB8f581194ae79006d24E0d814B7697F6", base: "ETH",  quote: "USDT", dex: "Uniswap V3", feeTier: "0.05%" },
  { id: "wbtc-eth-uni-v3-03",  chain: "ethereum", pool: "0xCBCdF9626bC03E24f779434178A73a0B4bad62eD", base: "WBTC", quote: "ETH",  dex: "Uniswap V3", feeTier: "0.30%" },
  { id: "wsteth-eth-curve",     chain: "ethereum", pool: "0x21e27a5e5513d6e65c4f830167390997aa84843a", base: "stETH",quote: "ETH",  dex: "Curve"      },
  { id: "bnb-usdt-pcs-v2",      chain: "bsc",      pool: "0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE", base: "BNB",  quote: "USDT", dex: "PancakeSwap V2" },
  { id: "cake-bnb-pcs-v2",      chain: "bsc",      pool: "0x804678fa97d91B974ec2af3c843270886528a9E6", base: "CAKE", quote: "BNB",  dex: "PancakeSwap V2" },
  { id: "arb-usdc-uni-v3-005",  chain: "arbitrum", pool: "0xC6962004f452bE9203591991D15f6b388e09E8D0", base: "ARB",  quote: "USDC", dex: "Uniswap V3", feeTier: "0.05%" },
  { id: "eth-usdc-base-uni",    chain: "base",     pool: "0xd0b53D9277642d899DF5C87A3966A349A798F224", base: "ETH",  quote: "USDC", dex: "Uniswap V3" },
  { id: "matic-usdc-quick",     chain: "polygon",  pool: "0xA374094527e1673A86dE625aa59517c5dE346d32", base: "WMATIC", quote: "USDC", dex: "Uniswap V3" },
];

export const DEFAULT_PRO_PAIR = PRO_PAIRS[0];
