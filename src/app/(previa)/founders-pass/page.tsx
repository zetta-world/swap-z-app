import type { Metadata } from "next";
import FoundersPublicPage from "@/components/founders/FoundersPublicPage";
import FoundersSalePage from "@/components/founders/FoundersSalePage";
import { foundersPublicCopy } from "@/lib/founders-public/content";
import { foundersPublicFacts } from "@/lib/founders-public/facts";
import { quadrosDaPrevia } from "@/lib/founders-sale/previa";
import { previaHabilitada } from "./gate";

export const dynamic = "force-dynamic";

const title = "Founder Pass — Z-SWAP platform, plans and public sale guide";
const description = "Understand Z-SWAP, compare Free, Pro, Trader and Pilot, review Founder Pass rules, product status, fees, networks, risks and the complete public FAQ.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/founders-pass" },
  openGraph: { type: "website", title, description, url: "/founders-pass" },
  twitter: { card: "summary_large_image", title, description },
  robots: { index: true, follow: true },
};

function structuredData(facts: ReturnType<typeof foundersPublicFacts>) {
  const copy = foundersPublicCopy("en", facts);
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Z-SWAP",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      description,
      url: "/founders-pass",
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: copy.faqs.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    },
  ];
}

export default async function Page({ searchParams }: { searchParams: Promise<{ quadro?: string }> }) {
  // The audited simulator remains available only to an explicitly enabled
  // local environment. It does not control the public informational page.
  if (previaHabilitada()) {
    const { quadro } = await searchParams;
    const quadros = await quadrosDaPrevia();
    return <FoundersSalePage quadros={quadros} previa inicial={quadro} />;
  }

  const facts = foundersPublicFacts();
  const jsonLd = JSON.stringify(structuredData(facts)).replace(/</g, "\\u003c");
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <FoundersPublicPage facts={facts} />
    </>
  );
}
