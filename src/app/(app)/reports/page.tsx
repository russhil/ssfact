import { getDashboard } from "@/lib/queries";
import { getJobs } from "@/lib/jobs";
import { Card, Bar, PageHeader } from "@/components/ui";
import { num, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const [{ kpis }, jobs] = await Promise.all([getDashboard(), getJobs()]);

  const byItem = new Map<string, { item: string; cut: number; disp: number }>();
  for (const j of jobs) {
    const v = byItem.get(j.item) ?? { item: j.item, cut: 0, disp: 0 };
    v.cut += j.cutQty;
    v.disp += j.dispatchedQty;
    byItem.set(j.item, v);
  }
  const topItems = [...byItem.values()].sort((a, b) => b.cut - a.cut).slice(0, 10);
  const maxCut = Math.max(...topItems.map((t) => t.cut), 1);

  return (
    <div className="p-6">
      <PageHeader title="Reports" subtitle="Production summary across all job cards." />

      <div className="mb-4 grid grid-cols-4 gap-3.5">
        {[
          ["Total Job Cards", num(kpis.totalJobs)],
          ["Active", num(kpis.activeJobs)],
          ["Closed", num(kpis.closedJobs)],
          ["Overall Fill", pct(kpis.fillRate, 1)],
        ].map(([l, v]) => (
          <Card key={l} className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{l}</div>
            <div className="mt-1.5 text-[22px] font-extrabold tnum">{v}</div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <h3 className="mb-4 text-[13px] font-bold">Top Styles by Cut Quantity</h3>
        <div className="space-y-3">
          {topItems.map((t) => (
            <div key={t.item} className="flex items-center gap-3 text-[12px]">
              <span className="w-48 truncate font-semibold">{t.item}</span>
              <div className="flex-1">
                <Bar value={t.cut / maxCut} />
              </div>
              <span className="w-16 text-right font-bold tnum">{num(t.cut)}</span>
              <span className="w-12 text-right text-faint tnum">{pct(t.cut ? t.disp / t.cut : 0)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
