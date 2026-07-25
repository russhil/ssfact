import Link from "next/link";
import { db } from "@/lib/db";
import { getJobs } from "@/lib/jobs";
import { getCurrentUser } from "@/lib/auth";
import { DispatchForm } from "@/components/dispatch-form";
import { Card, PageHeader } from "@/components/ui";
import { num, fmtDate } from "@/lib/format";
import { jobItem } from "@/lib/job-display";

export const dynamic = "force-dynamic";

export default async function DispatchPage() {
  const jobs = await getJobs();
  const me = await getCurrentUser();
  const open = jobs
    .filter((j) => j.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    // Change 19 C: the picker names the vendors actually stitching the card (its layer
    // vendors), not the header vendor — a split card would otherwise mislabel itself.
    .map((j) => ({ id: 0, siNo: j.siNo, item: j.item, vendor: j.vendor, balance: j.balance, slug: j.slug }));

  // attach real ids
  const all = await db.jobCard.findMany({ select: { id: true, siNo: true } });
  const idBySi = new Map<string, number[]>();
  for (const r of all) {
    const arr = idBySi.get(r.siNo) ?? [];
    arr.push(r.id);
    idBySi.set(r.siNo, arr);
  }
  const openJobs = open.map((o) => ({ ...o, id: (idBySi.get(o.siNo) ?? [0])[0] }));

  const recent = await db.dispatchEvent.findMany({
    include: { jobCard: { include: { product: true } } },
    orderBy: { date: "desc" },
    take: 12,
  });

  return (
    <div className="p-6">
      <PageHeader title="Dispatch" subtitle="Log finished garments dispatched from vendors back to the warehouse — size×colour, against the cutting layers. Balances and the dashboard update instantly." />
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[1fr_1.3fr]">
        <DispatchForm jobs={openJobs} defaultArrangedBy={me?.displayName ?? ""} />

        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3 t-body font-bold">Recent Dispatches</div>
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">Date</th>
                <th className="px-5 py-2.5 font-semibold">Challan</th>
                <th className="px-5 py-2.5 font-semibold">Job</th>
                <th className="px-5 py-2.5 font-semibold">Item</th>
                <th className="px-5 py-2.5 text-right font-semibold">Qty</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e) => (
                <tr key={e.id} className="border-b border-hairline last:border-0">
                  <td className="px-5 py-2.5 text-t2 tnum">{fmtDate(e.date)}</td>
                  <td className="px-5 py-2.5">
                    <Link href={`/dispatch-doc/${e.id}`} className="font-semibold text-primary-ink hover:underline tnum">{e.dispatchNo ?? e.challan ?? `#${e.id}`}</Link>
                  </td>
                  <td className="px-5 py-2.5">
                    <Link href={`/job-cards/${e.jobCard.id}`} className="font-bold text-primary-ink hover:underline">{e.jobCard.siNo}</Link>
                  </td>
                  <td className="px-5 py-2.5 text-t2">{jobItem(e.jobCard)}</td>
                  <td className="px-5 py-2.5 text-right font-bold text-ok tnum">+{num(e.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
