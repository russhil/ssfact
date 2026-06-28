import { getFabricOrders, getFabricPickList, getSuppliers } from "@/lib/masters";
import { Card, PageHeader } from "@/components/ui";
import { num } from "@/lib/format";
import { FabricOrderManager } from "@/components/fabric-order-manager";

export const dynamic = "force-dynamic";

export default async function FabricOrdersPage() {
  const [orders, fabrics, suppliers] = await Promise.all([getFabricOrders(), getFabricPickList(), getSuppliers()]);
  const pending = orders.filter((o) => o.status === "ORDER_PLACED").length;
  const planning = orders.filter((o) => o.status === "PLANNING" || o.status === "SAMPLE_PENDING").length;
  const received = orders.filter((o) => o.status === "RECEIVED").length;

  return (
    <div className="p-6">
      <PageHeader title="Fabric Orders" subtitle="Procurement pipeline that feeds fabric into colour stock. Receiving an order lands its quantity in that colour's inventory." />
      <div className="mb-4 grid grid-cols-3 gap-3.5">
        <Card className="p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Planning</div><div className="mt-1.5 text-[22px] font-extrabold tnum">{num(planning)}</div></Card>
        <Card className="p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Pending Delivery</div><div className="mt-1.5 text-[22px] font-extrabold text-amber-500 tnum">{num(pending)}</div></Card>
        <Card className="p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Received</div><div className="mt-1.5 text-[22px] font-extrabold text-emerald-600 tnum">{num(received)}</div></Card>
      </div>
      <FabricOrderManager
        orders={orders}
        fabrics={fabrics.map((f) => ({ id: f.id, name: f.name }))}
        suppliers={suppliers.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))}
      />
    </div>
  );
}
