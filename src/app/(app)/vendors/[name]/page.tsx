import Link from "next/link";
import { getJobs } from "@/lib/jobs";
import { db } from "@/lib/db";
import { getVendorChallans } from "@/lib/masters";
import { Card, Badge } from "@/components/ui";
import { num, pct, fmtDate } from "@/lib/format";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function VendorDetail({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const vendor = decodeURIComponent(name);
  const jobs = (await getJobs()).filter((j) => j.vendor === vendor);
  const cut = jobs.reduce((a, j) => a + j.cutQty, 0);
  const disp = jobs.reduce((a, j) => a + j.dispatchedQty, 0);
  const vRow = await db.vendor.findUnique({ where: { name: vendor }, select: { id: true } });
  const challans = vRow ? await getVendorChallans(vRow.id) : [];

  return (
    <div className="p-6">
      <Link href="/vendors" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Vendors
      </Link>
      <h1 className="mb-1 text-[22px] font-bold tracking-tight">{vendor}</h1>
      <p className="mb-5 text-[13px] text-muted">{jobs.length} job cards · {pct(cut ? disp / cut : 0)} fill rate</p>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-semibold">SI</th>
              <th className="px-4 py-2.5 font-semibold">Item</th>
              <th className="px-4 py-2.5 text-right font-semibold">Cut</th>
              <th className="px-4 py-2.5 text-right font-semibold">Disp.</th>
              <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
              <th className="px-4 py-2.5 font-semibold">ETD</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j, i) => (
              <tr key={`${j.siNo}-${i}`} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td className="px-4 py-2.5">
                  <Link href={`/job-cards/${j.slug}`} className="font-bold text-primary-ink hover:underline">{j.siNo}</Link>
                </td>
                <td className="px-4 py-2.5">{j.item}</td>
                <td className="px-4 py-2.5 text-right tnum">{num(j.cutQty)}</td>
                <td className="px-4 py-2.5 text-right tnum">{num(j.dispatchedQty)}</td>
                <td className="px-4 py-2.5 text-right tnum">{num(j.balance)}</td>
                <td className="px-4 py-2.5 text-slate-500 tnum">{fmtDate(j.plannedEtd)}</td>
                <td className="px-4 py-2.5">
                  {j.overdue ? <Badge tone="danger">Overdue</Badge> : j.status === "CLOSED" ? <Badge tone="ok">Closed</Badge> : <Badge tone="primary">Active</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {challans.length > 0 && (
        <Card className="mt-3.5 p-5">
          <h3 className="mb-3 text-[13px] font-bold">Materials Challans <span className="font-medium text-faint">· {challans.length}</span></h3>
          <div className="space-y-0">
            {challans.map((c) => (
              <Link key={c.id} href={`/challan-doc/${c.id}`} className="flex items-center justify-between border-b border-slate-50 py-2 text-[12px] last:border-0 hover:opacity-80">
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-primary-ink">{c.challanNo ?? `Draft #${c.id}`}</span>
                  <Badge tone={c.status === "LOCKED" ? "ok" : c.status === "VOID" ? "danger" : "default"}>{c.status}</Badge>
                  <span className="text-faint tnum">{fmtDate(c.date)}</span>
                </span>
                <span className="font-semibold tnum">{num(c.totalQty)} · {c.lineCount} lines</span>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
