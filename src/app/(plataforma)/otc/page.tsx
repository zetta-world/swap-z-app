import OtcView from "@/components/markets/OtcView";

export const metadata = {
  title: "OTC Desk · Z-SWAP",
  description: "Institutional-size trading on Z-SWAP. RFQ board with firm quotes from market makers, atomic on-chain settlement, no slippage from pools.",
};

export default function Page() {
  return <OtcView />;
}
