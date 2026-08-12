import OnrampView from "@/components/onramp/OnrampView";

export const metadata = {
  title: "Buy / Sell with PIX · Z-SWAP",
  description: "Buy and sell crypto via PIX (BRL) — KYC and delivery handled by Transak, tokens land directly in your connected wallet.",
};

export default function Page() {
  return <OnrampView />;
}
