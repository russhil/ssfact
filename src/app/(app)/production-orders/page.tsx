import Link from "next/link";
import { Plus } from "lucide-react";
import { getProductionOrders, getProductionSummary, PO_STATUS_LABEL, poStatusTone } from "@/lib/production";
import { Card, Badge, PageHeader } from "@/components/ui";
import { num, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const urgencyTone = (u: string | null) => (u === "V URGENT" ? "danger" : u === "URGENT" ? "warn" : "default");

export default async function ProductionOrdersPage() {
  const [orders, summary] = await Promise.all([getProductionOrders(), getProductionSummary()]);

  return (
    <div className="p-6">
      <PageHeader
        title="Production Orders"
        subtitle="Plan production off the catalog — target qty defaults to 2× monthly sale; duplicate active orders are blocked."
        actions={
          <Link
            href="/production-orders/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-primary-ink"
          >
            <Plus size={15} /> New order
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-4 gap-3.5">
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Orders</div>
          <div className="mt-1.5 text-[22px] font-extrabold tnum">{num(summary.total)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">In Production</div>
          <div className="mt-1.5 text-[22px] font-extrabold text-amber-500 tnum">{num(summary.inProduction)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Completed</div>
          <div className="mt-1.5 text-[22px] font-extrabold text-emerald-600 tnum">{num(summary.completed)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Target Units</div>
          <div className="mt-1.5 text-[22px] font-extrabold tnum">{num(summary.targetUnits)}</div>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-semibold">Order</th>
              <th className="px-4 py-2.5 font-semibold">Product</th>
              <th className="px-4 py-2.5 font-semibold">Date</th>
              <th className="px-4 py-2.5 text-right font-semibold">Monthly Sale</th>
              <th className="px-4 py-2.5 text-right font-semibold">Target</th>
              <th className="px-4 py-2.5 font-semibold">Urgency</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td className="px-4 py-2.5 font-bold text-primary-ink">{o.orderNo}</td>
                <td className="px-4 py-2.5">
                  <Link href={`/catalog/${encodeURIComponent(o.skuCode)}`} className="font-medium hover:underline">
                    {o.productName}
                  </Link>
                  <span className="ml-1.5 text-[10px] text-faint">{o.skuCode}</span>
                </td>
                <td className="px-4 py-2.5 text-slate-500 tnum">{fmtDate(o.orderDate)}</td>
                <td className="px-4 py-2.5 text-right tnum text-slate-500">{num(o.avgMonthlySale)}</td>
                <td className="px-4 py-2.5 text-right font-bold tnum">{num(o.targetQty)}</td>
                <td className="px-4 py-2.5">{o.urgency ? <Badge tone={urgencyTone(o.urgency)}>{o.urgency}</Badge> : "—"}</td>
                <td className="px-4 py-2.5"><Badge tone={poStatusTone(o.status)}>{PO_STATUS_LABEL[o.status] ?? o.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
