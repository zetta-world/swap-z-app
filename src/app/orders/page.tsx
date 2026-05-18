import AppShell from "@/components/layout/AppShell";
import OrdersView from "@/components/orders/OrdersView";

export default function Page() {
  return (
    <AppShell>
      <OrdersView />
    </AppShell>
  );
}
