import Link from "next/link";
import { notFound } from "next/navigation";
import { getJob } from "@/lib/jobs";
import { Card, Badge } from "@/components/ui";
import { num, inr, fmtDate, pct } from "@/lib/format";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function JobDetail({ params }: { params: Promise<{ si: string }> }) {
  const { si } = await params;
  const j = await getJob(si);
  if (!j) notFound();

  const balance = j.cutQty - j.dispatchedQty;
  const fill = j.cutQty ? j.dispatchedQty / j.cutQty : 0;
  const overdue = j.status === "ACTIVE" && j.plannedEtd && j.plannedEtd < new Date() && balance > 0;
  const sizeTotal = j.sizeBreakup.reduce((a, s) => a + s.qty, 0);

  const meta = [
    ["Style No", j.style.styleNo],
    ["Item", j.style.itemDesc],
    ["MRP", inr(j.style.mrp)],
    ["Vendor", j.vendor.name],
    ["Cutting Master", j.cuttingMaster?.name ?? "—"],
    ["Fabric", j.style.fabric?.name ?? "—"],
    ["Avg Consumption", j.avgConsumption ? `${j.avgConsumption} ${j.style.unit.toLowerCase()}/pc` : "—"],
    ["Order Date", fmtDate(j.orderDate)],
    ["Cutting Issued", fmtDate(j.cuttingIssuedOn)],
    ["Planned ETD", fmtDate(j.plannedEtd)],
  ] as const;

  return (
    <div className="p-6">
      <Link href="/job-cards" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Job Cards
      </Link>

      <div className="mb-5 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[22px] font-bold tracking-tight">{j.siNo}</h1>
            {overdue ? <Badge tone="danger">Overdue</Badge> : j.status === "CLOSED" ? <Badge tone="ok">Closed</Badge> : <Badge tone="primary">Active</Badge>}
          </div>
          <p className="mt-0.5 text-[13px] text-muted">{j.style.itemDesc} · {j.style.styleNo}</p>
        </div>
      </div>

      {/* top stats */}
      <div className="grid grid-cols-4 gap-3.5">
        {[
          ["Cut Qty", num(j.cutQty)],
          ["Dispatched", num(j.dispatchedQty)],
          ["Balance", num(balance)],
          ["Fill Rate", pct(fill, 1)],
        ].map(([l, v]) => (
          <Card key={l} className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{l}</div>
            <div className="mt-1.5 text-[22px] font-extrabold tnum">{v}</div>
          </Card>
        ))}
      </div>

      <div className="mt-3.5 grid grid-cols-[1fr_1fr] gap-3.5">
        {/* details */}
        <Card className="p-5">
          <h3 className="mb-3 text-[13px] font-bold">Order Details</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[12px]">
            {meta.map(([k, v]) => (
              <div key={k} className="flex flex-col">
                <dt className="text-[11px] text-faint">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {/* dispatch log */}
        <Card className="p-5">
          <h3 className="mb-3 text-[13px] font-bold">
            Dispatch Log <span className="font-medium text-faint">· {j.dispatches.length} events</span>
          </h3>
          {j.dispatches.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-muted">No dispatches yet.</p>
          ) : (
            <div className="space-y-0">
              {j.dispatches.map((e) => (
                <div key={e.id} className="flex items-center justify-between border-b border-slate-50 py-2 text-[12px] last:border-0">
                  <span className="text-slate-500 tnum">{fmtDate(e.date)}</span>
                  <span className="font-bold tnum">+{num(e.qty)}</span>
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[12px]">
                <span className="font-semibold">Total dispatched</span>
                <span className="font-extrabold tnum">{num(j.dispatchedQty)}</span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* size matrix */}
      {j.sizeBreakup.length > 0 && (
        <Card className="mt-3.5 p-5">
          <h3 className="mb-3 text-[13px] font-bold">Size Breakup</h3>
          <div className="grid grid-cols-7 gap-2 text-center">
            {j.sizeBreakup.map((s) => (
              <div key={s.id}>
                <div className="text-[11px] font-bold text-faint">{s.size}</div>
                <div className="mt-1 rounded-lg border border-border bg-slate-50 py-2.5 text-[14px] font-bold tnum">{num(s.qty)}</div>
              </div>
            ))}
            <div>
              <div className="text-[11px] font-bold text-primary-ink">Total</div>
              <div className="mt-1 rounded-lg bg-primary-soft py-2.5 text-[14px] font-bold text-primary-ink tnum">{num(sizeTotal)}</div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
