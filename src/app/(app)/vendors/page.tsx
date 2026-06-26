import Link from "next/link";
import { getJobs } from "@/lib/jobs";
import { Card, Bar, PageHeader } from "@/components/ui";
import { num, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const jobs = await getJobs();

  const map = new Map<string, { name: string; jobs: number; active: number; cut: number; disp: number; overdue: number }>();
  for (const j of jobs) {
    const v = map.get(j.vendor) ?? { name: j.vendor, jobs: 0, active: 0, cut: 0, disp: 0, overdue: 0 };
    v.jobs++;
    if (j.status === "ACTIVE") v.active++;
    if (j.overdue) v.overdue++;
    v.cut += j.cutQty;
    v.disp += j.dispatchedQty;
    map.set(j.vendor, v);
  }
  const vendors = [...map.values()]
    .filter((v) => v.cut > 0 && v.name !== "Unassigned")
    .map((v) => ({ ...v, fill: v.cut ? v.disp / v.cut : 0 }))
    .sort((a, b) => b.cut - a.cut);

  return (
    <div className="p-6">
      <PageHeader title="Vendors" subtitle="Stitching units — in-house and external — ranked by volume and fill rate." />
      <div className="grid grid-cols-2 gap-3.5">
        {vendors.map((v) => (
          <Card key={v.name} className="p-5">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <Link href={`/vendors/${encodeURIComponent(v.name)}`} className="text-[14px] font-bold text-primary-ink hover:underline">
                  {v.name}
                </Link>
                <div className="mt-0.5 text-[11px] text-faint">
                  {v.active} active · {v.jobs} total{v.overdue > 0 && <span className="text-danger"> · {v.overdue} overdue</span>}
                </div>
              </div>
              <span className="text-[18px] font-extrabold tnum">{pct(v.fill)}</span>
            </div>
            <Bar value={v.fill} tone={v.fill < 0.65 ? "warn" : "primary"} />
            <div className="mt-3 flex justify-between text-[11px] text-muted">
              <span>Cut <b className="text-ink tnum">{num(v.cut)}</b></span>
              <span>Received <b className="text-ink tnum">{num(v.disp)}</b></span>
              <span>Balance <b className="text-ink tnum">{num(v.cut - v.disp)}</b></span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
