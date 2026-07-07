import Link from "next/link";
import { notFound } from "next/navigation";
import { getJob, getJobMatrix } from "@/lib/jobs";
import { getCurrentUser } from "@/lib/auth";
import { num, fmtDate } from "@/lib/format";
import { jobItem, jobStyle } from "@/lib/job-display";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

export default async function ChallanPage({ params }: { params: Promise<{ si: string }> }) {
  const { si } = await params;
  const u = await getCurrentUser();
  const scope = u?.role === "VENDOR" ? { vendorName: u.vendor ?? "" } : undefined;
  const j = await getJob(si, scope);
  if (!j) notFound();

  const mx = getJobMatrix(j);
  const sizes = mx.sizes;
  const colors = mx.colours;
  const cell = (size: string, color: string) => mx.cell(color, size);
  const issued = j.jobLines.filter((l) => (l.issuedQty ?? 0) > 0 || (l.requiredQty ?? 0) > 0);

  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-[12px] text-ink">
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; } } @page { margin: 14mm; }`}</style>

      <div className="mb-4 flex items-center justify-between">
        <Link href={`/job-cards/${si}`} className="no-print text-[12px] font-medium text-muted hover:text-ink">← Back to card</Link>
        <PrintButton />
      </div>

      <div className="flex items-start justify-between border-b-2 border-ink pb-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight">SPORTSUN — Production Challan</h1>
          <p className="mt-0.5 text-[12px] text-muted">{jobItem(j)} · {jobStyle(j)}</p>
        </div>
        <div className="text-right">
          <div className="text-[18px] font-bold">{j.siNo}</div>
          <div className="text-[11px] text-muted">{fmtDate(j.orderDate)}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-3 text-[11px]">
        {[
          ["Vendor", j.vendor.name],
          ["Cutting Master", j.cuttingMaster?.name ?? "—"],
          ["Fabric", j.product?.fabric?.name ?? "—"],
          ["Cut Qty", `${num(j.cutQty)} pcs`],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="text-faint">{k}</div>
            <div className="font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <h2 className="mt-5 mb-1.5 text-[12px] font-bold uppercase tracking-wide">Size × Colour</h2>
      <table className="w-full border-collapse text-center text-[11px]">
        <thead>
          <tr className="border-y border-ink">
            <th className="px-2 py-1 text-left">Colour</th>
            {sizes.map((s) => <th key={s} className="px-2 py-1">{s}</th>)}
            <th className="px-2 py-1">Total</th>
          </tr>
        </thead>
        <tbody>
          {colors.map((c) => (
            <tr key={c} className="border-b border-slate-200">
              <td className="px-2 py-1 text-left font-semibold">{c || "—"}</td>
              {sizes.map((s) => <td key={s} className="px-2 py-1">{cell(s, c) || ""}</td>)}
              <td className="px-2 py-1 font-bold">{num(sizes.reduce((a, s) => a + cell(s, c), 0))}</td>
            </tr>
          ))}
          <tr className="border-t border-ink font-bold">
            <td className="px-2 py-1 text-left">Total</td>
            {sizes.map((s) => <td key={s} className="px-2 py-1">{num(colors.reduce((a, c) => a + cell(s, c), 0))}</td>)}
            <td className="px-2 py-1">{num(j.cutQty)}</td>
          </tr>
        </tbody>
      </table>

      {issued.length > 0 && (
        <>
          <h2 className="mt-5 mb-1.5 text-[12px] font-bold uppercase tracking-wide">Trims Issued</h2>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-y border-ink text-left">
                <th className="px-2 py-1">Material</th>
                <th className="px-2 py-1">Colour</th>
                <th className="px-2 py-1 text-right">Required</th>
                <th className="px-2 py-1 text-right">Issued</th>
                <th className="px-2 py-1">Arranged by</th>
              </tr>
            </thead>
            <tbody>
              {issued.map((l) => (
                <tr key={l.id} className="border-b border-slate-200">
                  <td className="px-2 py-1 font-medium">{l.material}</td>
                  <td className="px-2 py-1">{l.color || "—"}</td>
                  <td className="px-2 py-1 text-right">{num(l.requiredQty ?? l.totalQty ?? 0)}</td>
                  <td className="px-2 py-1 text-right">{num(l.issuedQty ?? 0)}</td>
                  <td className="px-2 py-1">{l.arrangedBy || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="mt-10 flex justify-between text-[11px]">
        <div className="border-t border-ink pt-1 w-40 text-center">Cutting</div>
        <div className="border-t border-ink pt-1 w-40 text-center">Fabric / Trims</div>
        <div className="border-t border-ink pt-1 w-40 text-center">Received by</div>
      </div>
    </div>
  );
}
