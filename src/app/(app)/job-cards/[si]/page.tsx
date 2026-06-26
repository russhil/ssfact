import Link from "next/link";
import { notFound } from "next/navigation";
import { getJob } from "@/lib/jobs";
import { getCurrentUser } from "@/lib/auth";
import { Card, Badge } from "@/components/ui";
import { FabricActualsForm } from "@/components/fabric-actuals-form";
import { num, inr, fmtDate, pct } from "@/lib/format";
import { STAGE_LABEL, stageTone, type Stage } from "@/lib/job-labels";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

const SIZE_ORDER = ["S", "M", "L", "XL", "2XL", "3XL"];
const orderSizes = (a: string, b: string) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b);

export default async function JobDetail({ params }: { params: Promise<{ si: string }> }) {
  const { si } = await params;
  const u = await getCurrentUser();
  const scope = u?.role === "VENDOR" ? { vendorName: u.vendor ?? "" } : undefined;
  const j = await getJob(si, scope);
  if (!j) notFound();

  const balance = j.cutQty - j.dispatchedQty;
  const fill = j.cutQty ? j.dispatchedQty / j.cutQty : 0;
  const overdue = j.status === "ACTIVE" && j.plannedEtd && j.plannedEtd < new Date() && balance > 0;
  const sizeTotal = j.sizeBreakup.reduce((a, s) => a + s.qty, 0);
  const stage = j.stage as Stage;
  const unit = j.product.unit;

  // size×color matrix
  const hasColor = j.sizeBreakup.some((s) => s.color !== "");
  const sizes = [...new Set(j.sizeBreakup.map((s) => s.size))].sort(orderSizes);
  const colorRows = [...new Set(j.sizeBreakup.map((s) => s.color))].sort();
  const cellQty = (size: string, color: string) =>
    j.sizeBreakup.find((s) => s.size === size && s.color === color)?.qty ?? 0;

  const returned = j.returnNotes.reduce((a, r) => a + r.qty, 0);
  const itemDesc = j.product.itemDesc ?? j.product.name;
  const styleNo = j.product.styleNo ?? j.product.skuCode;

  const meta = [
    ["Style No", styleNo],
    ["Item", itemDesc],
    ["MRP", inr(j.product.mrp)],
    ["Vendor", j.vendor.name],
    ["Cutting Master", j.cuttingMaster?.name ?? "—"],
    ["Fabric", j.product.fabric?.name ?? "—"],
    ["Avg Consumption", j.avgConsumption ? `${j.avgConsumption} ${unit.toLowerCase()}/pc` : "—"],
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
            <Badge tone={stageTone(stage)}>{STAGE_LABEL[stage]}</Badge>
          </div>
          <p className="mt-0.5 text-[13px] text-muted">{itemDesc} · {styleNo}</p>
        </div>
      </div>

      {/* top stats */}
      <div className="grid grid-cols-4 gap-3.5">
        {[
          ["Cut Qty", num(j.cutQty)],
          ["Received", num(j.dispatchedQty)],
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
            Receipt Log <span className="font-medium text-faint">· {j.dispatches.length} events</span>
          </h3>
          {j.dispatches.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-muted">No receipts yet.</p>
          ) : (
            <div className="space-y-0">
              {j.dispatches.map((e) => (
                <div key={e.id} className="flex items-center justify-between border-b border-slate-50 py-2 text-[12px] last:border-0">
                  <span className="text-slate-500 tnum">
                    {fmtDate(e.date)}
                    {e.challan && <span className="ml-2 text-faint">challan {e.challan}</span>}
                  </span>
                  <span className="font-bold tnum">+{num(e.qty)}</span>
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[12px]">
                <span className="font-semibold">Total received</span>
                <span className="font-extrabold tnum">{num(j.dispatchedQty)}</span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* estimate vs actual fabric */}
      <Card className="mt-3.5 p-5">
        <h3 className="mb-3 text-[13px] font-bold">Fabric · Estimate vs Actual</h3>
        <div className="grid grid-cols-4 gap-3.5 text-[12px]">
          {[
            ["Est avg", j.estAvg != null ? `${j.estAvg} ${unit.toLowerCase()}/pc` : "—"],
            ["Est fabric", j.estFabric != null ? `${num(j.estFabric)} ${unit.toLowerCase()}` : "—"],
            ["Actual avg", j.actualAvg != null ? `${j.actualAvg} ${unit.toLowerCase()}/pc` : "—"],
            ["Dispatched", j.fabricDispatched != null ? `${num(j.fabricDispatched)} ${unit.toLowerCase()}` : "—"],
            ["Used", j.fabricUsed != null ? `${num(j.fabricUsed)} ${unit.toLowerCase()}` : "—"],
            ["Returned", returned > 0 ? `${num(returned)} ${unit.toLowerCase()}` : "—"],
          ].map(([l, v]) => (
            <div key={l}>
              <div className="text-[11px] text-faint">{l}</div>
              <div className="mt-0.5 font-semibold tnum">{v}</div>
            </div>
          ))}
        </div>
        {u?.role !== "VENDOR" && (
          <FabricActualsForm
            jobCardId={j.id}
            unit={unit}
            estAvg={j.estAvg}
            estFabric={j.estFabric}
            actualAvg={j.actualAvg}
            fabricDispatched={j.fabricDispatched}
            fabricUsed={j.fabricUsed}
            hasReturn={j.returnNotes.length > 0}
          />
        )}
      </Card>

      {/* size×color matrix */}
      {j.sizeBreakup.length > 0 && (
        <Card className="mt-3.5 p-5">
          <h3 className="mb-3 text-[13px] font-bold">Size {hasColor ? "× Colour" : ""} Breakup</h3>
          {hasColor ? (
            <div className="overflow-x-auto">
              <table className="w-full text-center text-[12px]">
                <thead>
                  <tr className="text-[10px] font-bold uppercase tracking-wide text-faint">
                    <th className="px-2 py-1.5 text-left">Colour</th>
                    {sizes.map((s) => <th key={s} className="px-2 py-1.5">{s}</th>)}
                    <th className="px-2 py-1.5 text-primary-ink">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {colorRows.map((c) => {
                    const rowTotal = sizes.reduce((a, s) => a + cellQty(s, c), 0);
                    return (
                      <tr key={c} className="border-t border-slate-50">
                        <td className="px-2 py-1.5 text-left font-semibold text-slate-600">{c === "" ? "—" : c}</td>
                        {sizes.map((s) => (
                          <td key={s} className="px-2 py-1.5 tnum">{cellQty(s, c) || ""}</td>
                        ))}
                        <td className="px-2 py-1.5 font-bold text-primary-ink tnum">{num(rowTotal)}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-border">
                    <td className="px-2 py-1.5 text-left text-[10px] font-bold text-primary-ink">Total</td>
                    {sizes.map((s) => (
                      <td key={s} className="px-2 py-1.5 font-bold tnum">{num(colorRows.reduce((a, c) => a + cellQty(s, c), 0))}</td>
                    ))}
                    <td className="px-2 py-1.5 font-extrabold text-primary-ink tnum">{num(sizeTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid gap-2 text-center" style={{ gridTemplateColumns: `repeat(${j.sizeBreakup.length + 1}, minmax(0, 1fr))` }}>
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
          )}
        </Card>
      )}

      {/* BOM card */}
      {j.jobLines.length > 0 && (
        <Card className="mt-3.5 overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3 text-[13px] font-bold">
            Bill of Materials <span className="font-medium text-faint">· frozen at job creation</span>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">Material</th>
                <th className="px-5 py-2.5 font-semibold">Colour</th>
                <th className="px-5 py-2.5 text-right font-semibold">Per pc</th>
                <th className="px-5 py-2.5 text-right font-semibold">Total Used</th>
                <th className="px-5 py-2.5 text-right font-semibold">Trim Now</th>
              </tr>
            </thead>
            <tbody>
              {j.jobLines.map((l) => (
                <tr key={l.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2 font-medium">{l.material}</td>
                  <td className="px-5 py-2 text-slate-500">{l.color ?? "—"}</td>
                  <td className="px-5 py-2 text-right tnum text-slate-500">{l.perPieceQty != null ? num(l.perPieceQty, 2) : "—"}</td>
                  <td className="px-5 py-2 text-right font-bold tnum">{l.totalQty != null ? num(l.totalQty) : "—"}</td>
                  <td className="px-5 py-2 text-right tnum text-slate-500">{l.trimItem ? num(l.trimItem.currentStock) : "not tracked"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
