import PairView from "@/components/pair/PairView";

interface PageProps {
  params: { chain: string; address: string };
}

export default function Page({ params }: PageProps) {
  return <PairView chain={params.chain} pair={params.address} />;
}

export const dynamic = "force-dynamic";
