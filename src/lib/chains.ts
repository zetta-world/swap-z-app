// ─── Supported chains in the Liquidity Nexus ───────────────────────────
// 11 chains. The "galáxia inteira" the protocol claims to span.

export type ChainId =
  | "zetta"
  | "ethereum"
  | "bsc"
  | "polygon"
  | "base"
  | "arbitrum"
  | "optimism"
  | "avalanche"
  | "zksync"
  | "linea"
  | "solana";

export interface Chain {
  id: ChainId;
  name: string;
  short: string;
  evm: boolean;
  chainId?: number;            // numeric EVM chainId, undefined for Solana / Zetta (mock)
  color: string;
  gradient: string;
  nativeToken: string;
  explorer: string;
  rpc?: string;
  featured?: boolean;
  comingSoon?: boolean;
}

export const CHAINS: Chain[] = [
  {
    id: "zetta",
    name: "ZETTA Chain",
    short: "ZETTA",
    evm: false,
    color: "#00E8FF",
    gradient: "linear-gradient(135deg,#00E8FF 0%,#9F5FFF 100%)",
    nativeToken: "Z",
    explorer: "https://zettascan.dev",
    featured: true,
    comingSoon: true,
  },
  {
    id: "ethereum",
    name: "Ethereum",
    short: "ETH",
    evm: true,
    chainId: 1,
    color: "#627EEA",
    gradient: "linear-gradient(135deg,#627EEA,#454A75)",
    nativeToken: "ETH",
    explorer: "https://etherscan.io",
    featured: true,
  },
  {
    id: "bsc",
    name: "BNB Chain",
    short: "BSC",
    evm: true,
    chainId: 56,
    color: "#F3BA2F",
    gradient: "linear-gradient(135deg,#F3BA2F,#B58A22)",
    nativeToken: "BNB",
    explorer: "https://bscscan.com",
    featured: true,
  },
  {
    id: "polygon",
    name: "Polygon",
    short: "POL",
    evm: true,
    chainId: 137,
    color: "#8247E5",
    gradient: "linear-gradient(135deg,#8247E5,#4A1E9C)",
    nativeToken: "POL",
    explorer: "https://polygonscan.com",
  },
  {
    id: "base",
    name: "Base",
    short: "BASE",
    evm: true,
    chainId: 8453,
    color: "#0052FF",
    gradient: "linear-gradient(135deg,#0052FF,#003BCC)",
    nativeToken: "ETH",
    explorer: "https://basescan.org",
    featured: true,
  },
  {
    id: "arbitrum",
    name: "Arbitrum",
    short: "ARB",
    evm: true,
    chainId: 42161,
    color: "#28A0F0",
    gradient: "linear-gradient(135deg,#28A0F0,#1B6A9E)",
    nativeToken: "ETH",
    explorer: "https://arbiscan.io",
    featured: true,
  },
  {
    id: "optimism",
    name: "Optimism",
    short: "OP",
    evm: true,
    chainId: 10,
    color: "#FF0420",
    gradient: "linear-gradient(135deg,#FF0420,#A60016)",
    nativeToken: "ETH",
    explorer: "https://optimistic.etherscan.io",
  },
  {
    id: "avalanche",
    name: "Avalanche",
    short: "AVAX",
    evm: true,
    chainId: 43114,
    color: "#E84142",
    gradient: "linear-gradient(135deg,#E84142,#9A2A2B)",
    nativeToken: "AVAX",
    explorer: "https://snowtrace.io",
  },
  {
    id: "zksync",
    name: "zkSync Era",
    short: "ZK",
    evm: true,
    chainId: 324,
    color: "#8C8DFC",
    gradient: "linear-gradient(135deg,#8C8DFC,#5253B5)",
    nativeToken: "ETH",
    explorer: "https://explorer.zksync.io",
  },
  {
    id: "linea",
    name: "Linea",
    short: "LIN",
    evm: true,
    chainId: 59144,
    color: "#61DFFF",
    gradient: "linear-gradient(135deg,#61DFFF,#2A95B0)",
    nativeToken: "ETH",
    explorer: "https://lineascan.build",
  },
  {
    id: "solana",
    name: "Solana",
    short: "SOL",
    evm: false,
    color: "#14F195",
    gradient: "linear-gradient(135deg,#14F195,#9945FF)",
    nativeToken: "SOL",
    explorer: "https://solscan.io",
    featured: true,
  },
];

export const CHAIN_BY_ID: Record<ChainId, Chain> = CHAINS.reduce(
  (acc, c) => ({ ...acc, [c.id]: c }),
  {} as Record<ChainId, Chain>,
);

export const FEATURED_CHAINS = CHAINS.filter((c) => c.featured);
