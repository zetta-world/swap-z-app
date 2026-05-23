import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import CexConsole from "@/components/cex/CexConsole";

// Force dynamic so useSearchParams in CexConsole doesn't trigger a Suspense
// boundary error during static prerender. The page is interactive and the
// trading state must always be fresh client-side anyway.
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <CexConsole />
      </Suspense>
    </AppShell>
  );
}
