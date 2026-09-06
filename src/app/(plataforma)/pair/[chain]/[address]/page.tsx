import PairView from "@/components/pair/PairView";

interface PageProps {
  /**
   * ⚠️ `Promise`, e não o objeto direto — a mudança do Next 15 (06/09).
   *
   * A partir do 15 os `params` de página chegam assíncronos, e o compilador
   * pega isso. As duas páginas de `/admin/area` já estavam neste formato; esta
   * era a única que faltava no repositório inteiro.
   */
  params: Promise<{ chain: string; address: string }>;
}

export default async function Page({ params }: PageProps) {
  const { chain, address } = await params;
  return <PairView chain={chain} pair={address} />;
}

export const dynamic = "force-dynamic";
