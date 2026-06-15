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

// Shared logo URLs keyed by canonical symbol
const L = {
  ETH:   "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
  BTC:   "https://assets.coingecko.com/coins/images/1/small/bitcoin.png",
  USDC:  "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
  USDT:  "https://assets.coingecko.com/coins/images/325/small/Tether.png",
  WBTC:  "https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png",
  LINK:  "https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png",
  STETH: "https://assets.coingecko.com/coins/images/13442/small/steth_logo.png",
  BNB:   "https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png",
  CAKE:  "https://assets.coingecko.com/coins/images/12632/small/pancakeswap-cake-logo_(1).png",
  BUSD:  "https://assets.coingecko.com/coins/images/9576/small/BUSD.png",
  POL:   "https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png",
  ARB:   "https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg",
  GMX:   "https://assets.coingecko.com/coins/images/18323/small/arbit.png",
  OP:    "https://assets.coingecko.com/coins/images/25244/small/Optimism.png",
  AVAX:  "https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png",
  SOL:   "https://assets.coingecko.com/coins/images/4128/small/solana.png",
  JUP:   "https://assets.coingecko.com/coins/images/34188/small/jup.png",
  WIF:   "https://assets.coingecko.com/coins/images/33566/small/dogwifhat.jpg",
} as const;

export const DEFAULT_TOKENS: Token[] = [
  // ─── ZETTA Chain (mock) ──────────────────────────────────────────────
  { symbol: "Z",     name: "ZETTA",         chain: "zetta",    address: "native", decimals: 18, color: "#00E8FF", priceUsd: 0.0084, riskScore: 8,  tags: ["native"] },
  { symbol: "zUSD",  name: "ZETTA USD",     chain: "zetta",    address: "0x0000000000000000000000000000000000000001", decimals: 6,  color: "#26A17B", priceUsd: 1.00, riskScore: 6,  tags: ["stablecoin"] },

  // ─── Ethereum ────────────────────────────────────────────────────────
  { symbol: "ETH",   name: "Ethereum",      chain: "ethereum", address: "native", decimals: 18, logo: L.ETH,   color: "#627EEA", priceUsd: 2600,    riskScore: 4,  tags: ["native"] },
  { symbol: "USDC",  name: "USD Coin",      chain: "ethereum", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6,  logo: L.USDC,  color: "#2775CA", priceUsd: 1.00,  riskScore: 3,  tags: ["stablecoin"] },
  { symbol: "USDT",  name: "Tether USD",    chain: "ethereum", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6,  logo: L.USDT,  color: "#26A17B", priceUsd: 1.00,  riskScore: 5,  tags: ["stablecoin"] },
  { symbol: "WBTC",  name: "Wrapped BTC",   chain: "ethereum", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8,  logo: L.WBTC,  color: "#F7931A", priceUsd: 105000, riskScore: 4, tags: ["wrapped"] },
  { symbol: "LINK",  name: "Chainlink",     chain: "ethereum", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18, logo: L.LINK,  color: "#2A5ADA", priceUsd: 16.0,  riskScore: 5,  tags: ["defi"] },
  { symbol: "stETH", name: "Lido Staked ETH", chain: "ethereum", address: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", decimals: 18, logo: L.STETH, color: "#00A3FF", priceUsd: 2595, riskScore: 6, tags: ["lst"] },

  // ─── BSC ──────────────────────────────────────────────────────────────
  { symbol: "BNB",   name: "BNB",           chain: "bsc",      address: "native", decimals: 18, logo: L.BNB,   color: "#F3BA2F", priceUsd: 680,   riskScore: 5,  tags: ["native"] },
  { symbol: "ZETTA", name: "ZETTA Token",   chain: "bsc",      address: "0x8aacc38933007ec530c552007e210b4667749df1", decimals: 18, color: "#00E8FF", priceUsd: 0.0084, riskScore: 8, tags: ["defi"] },
  { symbol: "USDT",  name: "Tether USD",    chain: "bsc",      address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, logo: L.USDT,  color: "#26A17B", priceUsd: 1.00,  riskScore: 5,  tags: ["stablecoin"] },
  { symbol: "USDC",  name: "USD Coin",      chain: "bsc",      address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, logo: L.USDC,  color: "#2775CA", priceUsd: 1.00,  riskScore: 4,  tags: ["stablecoin"] },
  { symbol: "BUSD",  name: "Binance USD",   chain: "bsc",      address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", decimals: 18, logo: L.BUSD,  color: "#F0B90B", priceUsd: 1.00,  riskScore: 5,  tags: ["stablecoin"] },
  { symbol: "CAKE",  name: "PancakeSwap",   chain: "bsc",      address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18, logo: L.CAKE,  color: "#D1884F", priceUsd: 2.50,  riskScore: 8,  tags: ["defi"] },
  { symbol: "BTCB",  name: "BTC on BSC",    chain: "bsc",      address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18, logo: L.BTC,   color: "#F7931A", priceUsd: 105000, riskScore: 4, tags: ["wrapped"] },

  // ─── Polygon ──────────────────────────────────────────────────────────
  { symbol: "POL",   name: "Polygon",       chain: "polygon",  address: "native", decimals: 18, logo: L.POL,   color: "#8247E5", priceUsd: 0.26,  riskScore: 6,  tags: ["native"] },
  { symbol: "USDC",  name: "USD Coin",      chain: "polygon",  address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6,  logo: L.USDC,  color: "#2775CA", priceUsd: 1.00,  riskScore: 3,  tags: ["stablecoin"] },
  { symbol: "USDT",  name: "Tether USD",    chain: "polygon",  address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6,  logo: L.USDT,  color: "#26A17B", priceUsd: 1.00,  riskScore: 5,  tags: ["stablecoin"] },

  // ─── Base ─────────────────────────────────────────────────────────────
  { symbol: "ETH",   name: "Ethereum",      chain: "base",     address: "native", decimals: 18, logo: L.ETH,   color: "#627EEA", priceUsd: 2600,  riskScore: 4,  tags: ["native"] },
  { symbol: "USDC",  name: "USD Coin",      chain: "base",     address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6,  logo: L.USDC,  color: "#2775CA", priceUsd: 1.00,  riskScore: 3,  tags: ["stablecoin"] },
  { symbol: "cbBTC", name: "Coinbase BTC",  chain: "base",     address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8,  logo: L.BTC,   color: "#F7931A", priceUsd: 105000, riskScore: 4, tags: ["wrapped"] },

  // ─── Arbitrum ─────────────────────────────────────────────────────────
  { symbol: "ETH",   name: "Ethereum",      chain: "arbitrum", address: "native", decimals: 18, logo: L.ETH,   color: "#627EEA", priceUsd: 2600,  riskScore: 4,  tags: ["native"] },
  { symbol: "USDC",  name: "USD Coin",      chain: "arbitrum", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6,  logo: L.USDC,  color: "#2775CA", priceUsd: 1.00,  riskScore: 3,  tags: ["stablecoin"] },
  { symbol: "USDT",  name: "Tether USD",    chain: "arbitrum", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6,  logo: L.USDT,  color: "#26A17B", priceUsd: 1.00,  riskScore: 5,  tags: ["stablecoin"] },
  { symbol: "ARB",   name: "Arbitrum",      chain: "arbitrum", address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18, logo: L.ARB,   color: "#28A0F0", priceUsd: 0.40,  riskScore: 6,  tags: ["defi"] },
  { symbol: "GMX",   name: "GMX",           chain: "arbitrum", address: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a", decimals: 18, logo: L.GMX,   color: "#3D8FFF", priceUsd: 18.0,  riskScore: 7,  tags: ["defi"] },

  // ─── Optimism ─────────────────────────────────────────────────────────
  { symbol: "ETH",   name: "Ethereum",      chain: "optimism", address: "native", decimals: 18, logo: L.ETH,   color: "#627EEA", priceUsd: 2600,  riskScore: 4,  tags: ["native"] },
  { symbol: "USDC",  name: "USD Coin",      chain: "optimism", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6,  logo: L.USDC,  color: "#2775CA", priceUsd: 1.00,  riskScore: 3,  tags: ["stablecoin"] },
  { symbol: "OP",    name: "Optimism",      chain: "optimism", address: "0x4200000000000000000000000000000000000042", decimals: 18, logo: L.OP,    color: "#FF0420", priceUsd: 0.90,  riskScore: 5,  tags: ["defi"] },

  // ─── Avalanche ────────────────────────────────────────────────────────
  { symbol: "AVAX",  name: "Avalanche",     chain: "avalanche", address: "native", decimals: 18, logo: L.AVAX,  color: "#E84142", priceUsd: 25.0, riskScore: 6, tags: ["native"] },
  { symbol: "USDC",  name: "USD Coin",      chain: "avalanche", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6, logo: L.USDC,  color: "#2775CA", priceUsd: 1.00, riskScore: 3, tags: ["stablecoin"] },

  // ─── zkSync ───────────────────────────────────────────────────────────
  { symbol: "ETH",   name: "Ethereum",      chain: "zksync",   address: "native", decimals: 18, logo: L.ETH,   color: "#627EEA", priceUsd: 2600, riskScore: 4, tags: ["native"] },

  // ─── Linea ────────────────────────────────────────────────────────────
  { symbol: "ETH",   name: "Ethereum",      chain: "linea",    address: "native", decimals: 18, logo: L.ETH,   color: "#627EEA", priceUsd: 2600, riskScore: 4, tags: ["native"] },

  // ─── Solana ───────────────────────────────────────────────────────────
  { symbol: "SOL",   name: "Solana",        chain: "solana",   address: "native", decimals: 9,  logo: L.SOL,   color: "#14F195", priceUsd: 175,   riskScore: 5,  tags: ["native"] },
  { symbol: "JUP",   name: "Jupiter",       chain: "solana",   address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6, logo: L.JUP,   color: "#FBA124", priceUsd: 0.50,  riskScore: 7,  tags: ["defi"] },
  { symbol: "USDC",  name: "USD Coin",      chain: "solana",   address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, logo: L.USDC,  color: "#2775CA", priceUsd: 1.00,  riskScore: 3,  tags: ["stablecoin"] },
  { symbol: "WIF",   name: "dogwifhat",     chain: "solana",   address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", decimals: 6, logo: L.WIF,   color: "#FF9CBF", priceUsd: 1.20, riskScore: 28, tags: ["meme"] },
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
