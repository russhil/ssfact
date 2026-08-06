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
        subtitle="Planned production runs"
        actions={
          <Link
            href="/production-orders/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 t-sm font-semibold text-accent-on hover:bg-primary-ink"
          >
            <Plus size={15} /> New order
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-3.5">
        <Card className="p-4">
          <div className="t-xs font-semibold uppercase tracking-wide text-muted">Orders</div>
          <div className="mt-1.5 t-display font-extrabold tnum">{num(summary.total)}</div>
        </Card>
        <Card className="p-4">
          <div className="t-xs font-semibold uppercase tracking-wide text-muted">In Production</div>
          <div className="mt-1.5 t-display font-extrabold text-warn tnum">{num(summary.inProduction)}</div>
        </Card>
        <Card className="p-4">
          <div className="t-xs font-semibold uppercase tracking-wide text-muted">Completed</div>
          <div className="mt-1.5 t-display font-extrabold text-ok tnum">{num(summary.completed)}</div>
        </Card>
        <Card className="p-4">
          <div className="t-xs font-semibold uppercase tracking-wide text-muted">Target Units</div>
          <div className="mt-1.5 t-display font-extrabold tnum">{num(summary.targetUnits)}</div>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 font-semibold">Order</th>
                <th className="px-4 py-2.5 font-semibold">Product</th>
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5 text-right font-semibold">Monthly Sale</th>
                <th className="px-4 py-2.5 text-right font-semibold">Target</th>
                <th className="px-4 py-2.5 text-right font-semibold">Cut so far</th>
                <th className="px-4 py-2.5 font-semibold">Urgency</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const pct = o.targetQty > 0 ? Math.round((o.cutSoFar / o.targetQty) * 100) : 0;
                const remaining = o.targetQty - o.cutSoFar;
                return (
                <tr key={o.id} className="border-b border-hairline last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-2.5 font-bold text-primary-ink">{o.orderNo}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/catalog/${encodeURIComponent(o.skuCode)}`} className="font-medium hover:underline">
                      {o.productName}
                    </Link>
                    <span className="ml-1.5 t-micro text-faint">{o.skuCode}</span>
                  </td>
                  <td className="px-4 py-2.5 text-t2 tnum">{fmtDate(o.orderDate)}</td>
                  <td className="px-4 py-2.5 text-right tnum text-t2">{num(o.avgMonthlySale)}</td>
                  <td className="px-4 py-2.5 text-right font-bold tnum">{num(o.targetQty)}</td>
                  {/* Change 39 Part C — cut so far / target, with remaining (may go negative). */}
                  <td className="px-4 py-2.5 text-right tnum">
                    <span className="font-semibold text-t1">{num(o.cutSoFar)}</span>
                    <span className="text-faint"> · {pct}%</span>
                    <span className={`ml-1.5 t-micro ${remaining < 0 ? "text-danger" : "text-faint"}`}>
                      {remaining < 0 ? `${num(-remaining)} over` : `${num(remaining)} left`}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{o.urgency ? <Badge tone={urgencyTone(o.urgency)}>{o.urgency}</Badge> : "—"}</td>
                  <td className="px-4 py-2.5"><Badge tone={poStatusTone(o.status)}>{PO_STATUS_LABEL[o.status] ?? o.status}</Badge></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
