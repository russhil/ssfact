import { getFabricOrders, getFabricPickList, getSuppliers, getColours, getBuyerOptions , getDraftOrders } from "@/lib/masters";
import { getCurrentUser, canSeeCost } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { num } from "@/lib/format";
import { FabricOrderManager } from "@/components/fabric-order-manager";

import { OrderDraftsStrip } from "@/components/order-drafts-strip";

export const dynamic = "force-dynamic";

export default async function FabricOrdersPage() {
  // Change 25 G.3/K.2 — the PO dialog needs the firms and their delivery addresses.
  // Change 38 Part F — and their contacts, one of whom signs the PO.
  const me = await getCurrentUser();
  const [orders, fabrics, suppliers, colours, buyers, draftOrders] = await Promise.all([
    getFabricOrders(), getFabricPickList(), getSuppliers(), getColours(), getBuyerOptions(),
    getDraftOrders(),
  ]);
  const pending = orders.filter((o) => o.status === "ORDER_PLACED").length;
  const planning = orders.filter((o) => o.status === "PLANNING" || o.status === "SAMPLE_PENDING").length;
  const received = orders.filter((o) => o.status === "RECEIVED").length;

  return (
    <div className="p-6">
      <PageHeader title="Fabric Orders" subtitle="Purchase orders for fabric" />
      <div className="mb-4 grid grid-cols-3 gap-3.5">
        <Card className="p-4"><div className="t-xs font-semibold uppercase tracking-wide text-muted">Planning</div><div className="mt-1.5 t-display font-extrabold tnum">{num(planning)}</div></Card>
        <Card className="p-4"><div className="t-xs font-semibold uppercase tracking-wide text-muted">Pending Delivery</div><div className="mt-1.5 t-display font-extrabold text-warn tnum">{num(pending)}</div></Card>
        <Card className="p-4"><div className="t-xs font-semibold uppercase tracking-wide text-muted">Received</div><div className="mt-1.5 t-display font-extrabold text-ok tnum">{num(received)}</div></Card>
      </div>
      <OrderDraftsStrip kind="FABRIC" drafts={draftOrders.fabric} />
      <FabricOrderManager
        orders={orders}
        fabrics={fabrics.map((f) => ({ id: f.id, name: f.name, unit: f.unit }))}
        suppliers={suppliers.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))}
        colours={colours}
        buyers={buyers}
      />
    </div>
  );
}
