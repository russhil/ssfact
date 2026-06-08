import Link from "next/link";
import { db } from "@/lib/db";
import { getJobs, siSlug } from "@/lib/jobs";
import { DispatchForm } from "@/components/dispatch-form";
import { Card, PageHeader } from "@/components/ui";
import { num, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DispatchPage() {
  const jobs = await getJobs();
  const open = jobs
    .filter((j) => j.balance > 0)
    .sort((a, b) => b.balance - a.balance)
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
    include: { jobCard: { include: { style: true } } },
    orderBy: { date: "desc" },
    take: 12,
  });

  return (
    <div className="p-6">
      <PageHeader title="Dispatch" subtitle="Log shipments against open job cards — balances and the dashboard update instantly." />
      <div className="grid grid-cols-[1fr_1.3fr] gap-3.5">
        <DispatchForm jobs={openJobs} />

        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3 text-[13px] font-bold">Recent Dispatches</div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">Date</th>
                <th className="px-5 py-2.5 font-semibold">Job</th>
                <th className="px-5 py-2.5 font-semibold">Item</th>
                <th className="px-5 py-2.5 text-right font-semibold">Qty</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e) => (
                <tr key={e.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2.5 text-slate-500 tnum">{fmtDate(e.date)}</td>
                  <td className="px-5 py-2.5">
                    <Link href={`/job-cards/${siSlug(e.jobCard.siNo)}`} className="font-bold text-primary-ink hover:underline">{e.jobCard.siNo}</Link>
                  </td>
                  <td className="px-5 py-2.5 text-slate-500">{e.jobCard.style.itemDesc}</td>
                  <td className="px-5 py-2.5 text-right font-bold text-emerald-600 tnum">+{num(e.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
