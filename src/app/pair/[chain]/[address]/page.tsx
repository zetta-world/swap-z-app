import AppShell from "@/components/layout/AppShell";
import PairView from "@/components/pair/PairView";

interface PageProps {
  params: { chain: string; address: string };
}

export default function Page({ params }: PageProps) {
  return (
    <AppShell>
      <PairView chain={params.chain} pair={params.address} />
    </AppShell>
  );
}

export const dynamic = "force-dynamic";
