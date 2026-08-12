import NftView from "@/components/markets/NftView";

export const metadata = {
  title: "NFT Market · Z-SWAP",
  description: "Multi-chain NFT aggregator. ZION AI rarity + floor scoring across OpenSea, Blur, Magic Eden, LooksRare. On-chain Seaport settlement, Z-SWAP never custodies NFTs.",
};

export default function Page() {
  return <NftView />;
}
