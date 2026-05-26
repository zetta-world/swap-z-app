import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import BridgeView from "@/components/bridge/BridgeView";

// BridgeView reads ?from=&to= via useSearchParams, which forces this page
// out of static generation unless we wrap it in a Suspense boundary.
export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <BridgeView />
      </Suspense>
    </AppShell>
  );
}
