import { getDashboard } from "@/lib/queries";
import { getJobs } from "@/lib/jobs";
import { getVendorFabricVariance, getVendorPendency, getFabricPipeline } from "@/lib/insights";
import { Card, Bar, Badge, PageHeader } from "@/components/ui";
import { num, pct, inr } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const [{ kpis }, jobs, variance, pendency, pipeline] = await Promise.all([
    getDashboard(),
    getJobs(),
    getVendorFabricVariance(),
    getVendorPendency(),
    getFabricPipeline(),
  ]);

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

      {/* Vendor fabric variance — who over-consumes our fabric, and what it costs */}
      <Card className="mt-3.5 overflow-hidden p-0">
        <div className="border-b border-border px-5 py-3 text-[13px] font-bold">
          Vendor Fabric Variance <span className="font-medium text-faint">· extra fabric taken beyond assumed (cards with actuals)</span>
        </div>
        {variance.length === 0 ? (
          <p className="px-5 py-8 text-center text-[12px] text-muted">No fabric actuals logged yet.</p>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">Vendor</th>
                <th className="px-5 py-2.5 text-right font-semibold">Cards</th>
                <th className="px-5 py-2.5 text-right font-semibold">Assumed</th>
                <th className="px-5 py-2.5 text-right font-semibold">Actual</th>
                <th className="px-5 py-2.5 text-right font-semibold">Extra</th>
                <th className="px-5 py-2.5 text-right font-semibold">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {variance.map((v) => (
                <tr key={v.vendor} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2 font-semibold">{v.vendor}</td>
                  <td className="px-5 py-2 text-right tnum text-slate-500">{v.cards}</td>
                  <td className="px-5 py-2 text-right tnum text-slate-500">{num(v.assumed)}</td>
                  <td className="px-5 py-2 text-right tnum">{num(v.actual)}</td>
                  <td className="px-5 py-2 text-right tnum font-bold text-danger">+{num(v.extra)} {v.unit.toLowerCase()}</td>
                  <td className="px-5 py-2 text-right tnum font-bold">{inr(v.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {/* Vendor pendency */}
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3 text-[13px] font-bold">Vendor Pendency <span className="font-medium text-faint">· goods out now</span></div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">Vendor</th>
                <th className="px-5 py-2.5 text-right font-semibold">Open</th>
                <th className="px-5 py-2.5 text-right font-semibold">Pieces out</th>
                <th className="px-5 py-2.5 text-right font-semibold">Days held</th>
              </tr>
            </thead>
            <tbody>
              {pendency.slice(0, 12).map((v) => (
                <tr key={v.vendor} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2 font-semibold">{v.vendor}</td>
                  <td className="px-5 py-2 text-right tnum text-slate-500">{v.openCards}</td>
                  <td className="px-5 py-2 text-right tnum font-bold">{num(v.piecesOut)}</td>
                  <td className="px-5 py-2 text-right">{v.daysHeld > 25 ? <Badge tone="danger">{v.daysHeld}d</Badge> : <span className="tnum text-slate-500">{v.daysHeld}d</span>}</td>
                </tr>
              ))}
              {pendency.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-muted">Nothing pending.</td></tr>}
            </tbody>
          </table>
        </Card>

        {/* Monthly fabric pipeline */}
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3 text-[13px] font-bold">Monthly Fabric Pipeline <span className="font-medium text-faint">· demand × consumption</span></div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">Fabric</th>
                <th className="px-5 py-2.5 text-right font-semibold">Monthly req</th>
                <th className="px-5 py-2.5 text-right font-semibold">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.slice(0, 12).map((f) => (
                <tr key={f.fabric} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2 font-semibold">{f.fabric}</td>
                  <td className="px-5 py-2 text-right tnum">{num(f.monthlyReq)} {f.unit.toLowerCase()}</td>
                  <td className="px-5 py-2 text-right tnum font-bold">{inr(f.monthlyCost)}</td>
                </tr>
              ))}
              {pipeline.length === 0 && <tr><td colSpan={3} className="px-5 py-8 text-center text-muted">Add monthly sale on production orders to forecast.</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
