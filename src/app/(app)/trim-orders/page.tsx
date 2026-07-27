import { getTrimOrders, getTrimPickList, getSuppliers, getColours, listLookups } from "@/lib/masters";
import { Card, PageHeader } from "@/components/ui";
import { num } from "@/lib/format";
import { TrimOrderManager } from "@/components/trim-order-manager";

export const dynamic = "force-dynamic";

// Change 18 Part B: trims are bought the same way fabric is — order, PO, inward challan.
export default async function TrimOrdersPage() {
  const [orders, trims, suppliers, colours, units] = await Promise.all([
    getTrimOrders(),
    getTrimPickList(),
    getSuppliers(),
    getColours(),
    listLookups("UNIT"),
  ]);
  const pending = orders.filter((o) => o.status === "ORDER_PLACED").length;
  const planning = orders.filter((o) => o.status === "PLANNING" || o.status === "SAMPLE_PENDING").length;
  const received = orders.filter((o) => o.status === "RECEIVED").length;

  return (
    <div className="p-6">
      <PageHeader
        title="Trim Orders"
        subtitle="Purchase orders for trims and accessories"
      />
      <div className="mb-4 grid grid-cols-3 gap-3.5">
        <Card className="p-4"><div className="t-xs font-semibold uppercase tracking-wide text-muted">Planning</div><div className="mt-1.5 t-display font-extrabold tnum">{num(planning)}</div></Card>
        <Card className="p-4"><div className="t-xs font-semibold uppercase tracking-wide text-muted">Pending Delivery</div><div className="mt-1.5 t-display font-extrabold text-warn tnum">{num(pending)}</div></Card>
        <Card className="p-4"><div className="t-xs font-semibold uppercase tracking-wide text-muted">Received</div><div className="mt-1.5 t-display font-extrabold text-ok tnum">{num(received)}</div></Card>
      </div>
      <TrimOrderManager
        orders={orders}
        trims={trims}
        suppliers={suppliers.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))}
        colours={colours.map((c) => c.name)}
        units={units.map((u) => u.label)}
      />
    </div>
  );
}
