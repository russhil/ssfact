import Link from "next/link";
import { db } from "@/lib/db";
import { getJobs } from "@/lib/jobs";
import { getCurrentUser } from "@/lib/auth";
import { DispatchForm } from "@/components/dispatch-form";
import { Card, PageHeader } from "@/components/ui";
import { num, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DispatchPage() {
  const jobs = await getJobs();
  const me = await getCurrentUser();
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
    include: { jobCard: { include: { product: true } } },
    orderBy: { date: "desc" },
    take: 12,
  });

  return (
    <div className="p-6">
      <PageHeader title="Receipts" subtitle="Log goods received from vendors against open job cards — balances and the dashboard update instantly. (Market dispatch to dealers is a separate stream in E-manage.)" />
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[1fr_1.3fr]">
        <DispatchForm jobs={openJobs} defaultArrangedBy={me?.displayName ?? ""} />

        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3 text-[13px] font-bold">Recent Receipts</div>
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
                    <Link href={`/job-cards/${e.jobCard.id}`} className="font-bold text-primary-ink hover:underline">{e.jobCard.siNo}</Link>
                  </td>
                  <td className="px-5 py-2.5 text-slate-500">{e.jobCard.product.itemDesc ?? e.jobCard.product.name}</td>
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
