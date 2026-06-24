import P2pView from "@/components/markets/P2pView";

export const metadata = {
  title: "P2P Market · Z-SWAP",
  description: "Peer-to-peer crypto trading via PIX, TED, Mercado Pago. Atomic on-chain escrow + reputation system. Z-SWAP never custodies funds.",
};

export default function Page() {
  return <P2pView />;
}
