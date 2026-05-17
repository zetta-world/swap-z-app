import type { ChainId } from "./chains";

export interface Token {
  symbol: string;
  name: string;
  chain: ChainId;
  address: string;             // contract address (or "native")
  decimals: number;
  logo?: string;               // public CDN URL or path
  color?: string;
  // Demo-time helpers
  priceUsd?: number;
  riskScore?: number;          // 0-100, lower = safer
  tags?: ("native" | "stablecoin" | "wrapped" | "meme" | "defi" | "lst")[];
}

/**
 * Curated default token list for the demo.
 * In production, this is fetched from CoinGecko / TrustWallet token lists,
 * but for the cinematic demo we ship a hand-picked top universe.
 */
export const DEFAULT_TOKENS: Token[] = [
  // ─── ZETTA Chain (mock) ──────────────────────────────────────────────
  { symbol: "Z",     name: "ZETTA",         chain: "zetta",    address: "native", decimals: 18, color: "#00E8FF", priceUsd: 0.0084, riskScore: 8,  tags: ["native"] },
  { symbol: "zUSD",  name: "ZETTA USD",     chain: "zetta",    address: "0x0000000000000000000000000000000000000001", decimals: 6,  color: "#26A17B", priceUsd: 1.00, riskScore: 6,  tags: ["stablecoin"] },

  // ─── Ethereum ────────────────────────────────────────────────────────
  { symbol: "ETH",   name: "Ethereum",      chain: "ethereum", address: "native", decimals: 18, color: "#627EEA", priceUsd: 3450,    riskScore: 4,  tags: ["native"] },
  { symbol: "USDC",  name: "USD Coin",      chain: "ethereum", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6,  color: "#2775CA", priceUsd: 1.00,  riskScore: 3,  tags: ["stablecoin"] },
  { symbol: "USDT",  name: "Tether USD",    chain: "ethereum", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6,  color: "#26A17B", priceUsd: 1.00,  riskScore: 5,  tags: ["stablecoin"] },
  { symbol: "WBTC",  name: "Wrapped BTC",   chain: "ethereum", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8,  color: "#F7931A", priceUsd: 96400, riskScore: 4,  tags: ["wrapped"] },
  { symbol: "LINK",  name: "Chainlink",     chain: "ethereum", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18, color: "#2A5ADA", priceUsd: 22.4,  riskScore: 5,  tags: ["defi"] },
  { symbol: "stETH", name: "Lido Staked ETH", chain: "ethereum", address: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", decimals: 18, color: "#00A3FF", priceUsd: 3445, riskScore: 6, tags: ["lst"] },

  // ─── BSC ──────────────────────────────────────────────────────────────
  { symbol: "BNB",   name: "BNB",           chain: "bsc",      address: "native", decimals: 18, color: "#F3BA2F", priceUsd: 720,   riskScore: 5,  tags: ["native"] },
  { symbol: "ZETTA", name: "ZETTA Token",   chain: "bsc",      address: "0x8aacc38933007ec530c552007e210b4667749df1", decimals: 18, color: "#00E8FF", priceUsd: 0.0084, riskScore: 8, tags: ["defi"] },
  { symbol: "USDT",  name: "Tether USD",    chain: "bsc",      address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, color: "#26A17B", priceUsd: 1.00,  riskScore: 5,  tags: ["stablecoin"] },
  { symbol: "CAKE",  name: "PancakeSwap",   chain: "bsc",      address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18, color: "#D1884F", priceUsd: 2.85,  riskScore: 8,  tags: ["defi"] },

  // ─── Polygon ──────────────────────────────────────────────────────────
  { symbol: "POL",   name: "Polygon",       chain: "polygon",  address: "native", decimals: 18, color: "#8247E5", priceUsd: 0.52,  riskScore: 6,  tags: ["native"] },
  { symbol: "USDC",  name: "USD Coin",      chain: "polygon",  address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6,  color: "#2775CA", priceUsd: 1.00,  riskScore: 3,  tags: ["stablecoin"] },

  // ─── Base ─────────────────────────────────────────────────────────────
  { symbol: "ETH",   name: "Ethereum",      chain: "base",     address: "native", decimals: 18, color: "#627EEA", priceUsd: 3450,  riskScore: 4,  tags: ["native"] },
  { symbol: "USDC",  name: "USD Coin",      chain: "base",     address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6,  color: "#2775CA", priceUsd: 1.00,  riskScore: 3,  tags: ["stablecoin"] },
  { symbol: "cbBTC", name: "Coinbase BTC",  chain: "base",     address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8,  color: "#F7931A", priceUsd: 96400, riskScore: 4,  tags: ["wrapped"] },

  // ─── Arbitrum ─────────────────────────────────────────────────────────
  { symbol: "ETH",   name: "Ethereum",      chain: "arbitrum", address: "native", decimals: 18, color: "#627EEA", priceUsd: 3450,  riskScore: 4,  tags: ["native"] },
  { symbol: "ARB",   name: "Arbitrum",      chain: "arbitrum", address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18, color: "#28A0F0", priceUsd: 0.78,  riskScore: 6,  tags: ["defi"] },
  { symbol: "GMX",   name: "GMX",           chain: "arbitrum", address: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a", decimals: 18, color: "#3D8FFF", priceUsd: 24.6,  riskScore: 7,  tags: ["defi"] },

  // ─── Optimism ─────────────────────────────────────────────────────────
  { symbol: "OP",    name: "Optimism",      chain: "optimism", address: "0x4200000000000000000000000000000000000042", decimals: 18, color: "#FF0420", priceUsd: 1.62,  riskScore: 5,  tags: ["defi"] },

  // ─── Avalanche ────────────────────────────────────────────────────────
  { symbol: "AVAX",  name: "Avalanche",     chain: "avalanche", address: "native", decimals: 18, color: "#E84142", priceUsd: 39.8, riskScore: 6, tags: ["native"] },

  // ─── zkSync ───────────────────────────────────────────────────────────
  { symbol: "ETH",   name: "Ethereum",      chain: "zksync",   address: "native", decimals: 18, color: "#627EEA", priceUsd: 3450, riskScore: 4, tags: ["native"] },

  // ─── Linea ────────────────────────────────────────────────────────────
  { symbol: "ETH",   name: "Ethereum",      chain: "linea",    address: "native", decimals: 18, color: "#627EEA", priceUsd: 3450, riskScore: 4, tags: ["native"] },

  // ─── Solana ───────────────────────────────────────────────────────────
  { symbol: "SOL",   name: "Solana",        chain: "solana",   address: "native", decimals: 9,  color: "#14F195", priceUsd: 218,   riskScore: 5,  tags: ["native"] },
  { symbol: "JUP",   name: "Jupiter",       chain: "solana",   address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6, color: "#FBA124", priceUsd: 0.95,  riskScore: 7,  tags: ["defi"] },
  { symbol: "USDC",  name: "USD Coin",      chain: "solana",   address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, color: "#2775CA", priceUsd: 1.00,  riskScore: 3,  tags: ["stablecoin"] },
  { symbol: "WIF",   name: "dogwifhat",     chain: "solana",   address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", decimals: 6, color: "#FF9CBF", priceUsd: 1.86, riskScore: 28, tags: ["meme"] },
];

export function tokensByChain(chain: ChainId): Token[] {
  return DEFAULT_TOKENS.filter((t) => t.chain === chain);
}

export function findToken(chain: ChainId, symbolOrAddress: string): Token | undefined {
  const q = symbolOrAddress.toLowerCase();
  return DEFAULT_TOKENS.find(
    (t) => t.chain === chain && (t.symbol.toLowerCase() === q || t.address.toLowerCase() === q),
  );
}
