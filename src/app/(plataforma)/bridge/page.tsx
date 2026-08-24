import { Suspense } from "react";
import BridgeView from "@/components/bridge/BridgeView";

// BridgeView reads ?from=&to= via useSearchParams, which forces this page
// out of static generation unless we wrap it in a Suspense boundary.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <BridgeView />
    </Suspense>
  );
}
