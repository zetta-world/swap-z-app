import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FoundersSalePage from "@/components/founders/FoundersSalePage";
import { quadrosDaPrevia } from "@/lib/founders-sale/previa";
import { previaHabilitada } from "./gate";

/**
 * PRÉVIA LOCAL DA VENDA FOUNDERS — atrás de flag. Sem `FOUNDERS_SALE_PREVIEW=1` no ambiente do SERVIDOR,
 * a rota responde 404 (`notFound()`): em produção a flag não existe e a página não aparece.
 * Tudo aqui é SIMULAÇÃO (cenário local, chain/carteira/SOL falsos). `NFT_REAL_SALE=OFF` · `PUBLIC_SALE=OFF`.
 * A trava `src/lib/founders-sale/isolamento.test.ts` garante que esta é a ÚNICA rota que importa a venda.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Founders Pass · local preview", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ quadro?: string }> }) {
  if (!previaHabilitada()) notFound();
  const { quadro } = await searchParams;
  const quadros = await quadrosDaPrevia();
  return <FoundersSalePage quadros={quadros} previa inicial={quadro} />;
}
