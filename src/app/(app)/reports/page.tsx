import Link from "next/link";
import { getDashboard } from "@/lib/queries";
import { getJobs } from "@/lib/jobs";
import {
  getVendorFabricVariance,
  getVendorPendency,
  getFabricPipeline,
  getQualityByVendor,
  getOnTimeDelivery,
  getJobMargins,
} from "@/lib/insights";
import { getCurrentUser, canSeeCost } from "@/lib/auth";
import { Card, Bar, Badge, PageHeader } from "@/components/ui";
import { getDefectBreakdown } from "@/lib/quality";
import { getYieldByVendor } from "@/lib/yield";
import { num, pct, inr } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const me = await getCurrentUser();
  const owner = canSeeCost(me);

  const [{ kpis }, jobs, variance, pendency, pipeline, quality, onTime, margins, defects, yieldByVendor] = await Promise.all([
    getDashboard(),
    getJobs(),
    getVendorFabricVariance(),
    getVendorPendency(),
    getFabricPipeline(),
    getQualityByVendor(),
    getOnTimeDelivery(),
    // Change 25 Part F: margin is owner-only, so it is not even queried otherwise.
    owner ? getJobMargins() : Promise.resolve([]),
    // Change 36 Part 3 — where the rejects actually come from.
    getDefectBreakdown(),
    // Change 36 Part 5 — owner-only: over-consumption is a cost figure.
    owner ? getYieldByVendor() : Promise.resolve([]),
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
      <PageHeader title="Reports" subtitle="Production summary across all job cards" />

      <div className="mb-4 grid grid-cols-5 gap-3.5">
        {[
          ["Total Job Cards", num(kpis.totalJobs)],
          ["Active", num(kpis.activeJobs)],
          ["Closed", num(kpis.closedJobs)],
          ["Overall Fill", pct(kpis.fillRate, 1)],
          // Change 25 Part F
          ["On-time Delivery", onTime.measured > 0 ? pct(onTime.rate, 1) : "—"],
        ].map(([l, v]) => (
          <Card key={l} className="p-4">
            <div className="t-xs font-semibold uppercase tracking-wide text-muted">{l}</div>
            <div className="mt-1.5 t-display font-extrabold tnum">{v}</div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <h3 className="mb-4 t-body font-bold">Top Styles by Cut Quantity</h3>
        <div className="space-y-3">
          {topItems.map((t) => (
            <div key={t.item} className="flex items-center gap-3 t-sm">
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
        <div className="border-b border-border px-5 py-3 t-body font-bold">
          Vendor Fabric Variance
        </div>
        {variance.length === 0 ? (
          <p className="px-5 py-8 text-center t-sm text-muted">No fabric actuals logged</p>
        ) : (
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
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
                <tr key={v.vendor} className="border-b border-hairline last:border-0">
                  <td className="px-5 py-2 font-semibold">{v.vendor}</td>
                  <td className="px-5 py-2 text-right tnum text-t2">{v.cards}</td>
                  <td className="px-5 py-2 text-right tnum text-t2">{num(v.assumed)}</td>
                  <td className="px-5 py-2 text-right tnum">{num(v.actual)}</td>
                  <td className="px-5 py-2 text-right tnum font-bold text-danger">+{num(v.extra)} {v.unit.toLowerCase()}</td>
                  <td className="px-5 py-2 text-right tnum font-bold">{inr(v.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Change 25 Part F — reject / alter / extra by vendor, and on-time by vendor */}
      <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3 t-body font-bold">
            Quality by Vendor <span className="font-medium text-faint">· reject · alter · extra</span>
          </div>
          {/* six numeric columns in a half-width card — scroll rather than clip */}
          <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">Vendor</th>
                <th className="px-5 py-2.5 text-right font-semibold">Cut</th>
                <th className="px-5 py-2.5 text-right font-semibold">Reject</th>
                <th className="px-5 py-2.5 text-right font-semibold">Reject %</th>
                <th className="px-5 py-2.5 text-right font-semibold">Alter</th>
                <th className="px-5 py-2.5 text-right font-semibold">Extra</th>
              </tr>
            </thead>
            <tbody>
              {quality.slice(0, 12).map((q) => (
                <tr key={q.vendor} className="border-b border-hairline last:border-0">
                  <td className="px-5 py-2 font-semibold">{q.vendor}</td>
                  <td className="px-5 py-2 text-right tnum text-t2">{num(q.cut)}</td>
                  <td className="px-5 py-2 text-right tnum">{num(q.reject)}</td>
                  <td className="px-5 py-2 text-right">
                    {q.rejectRate >= 0.03 ? (
                      <Badge tone="danger">{pct(q.rejectRate, 1)}</Badge>
                    ) : (
                      <span className="tnum text-t2">{pct(q.rejectRate, 1)}</span>
                    )}
                  </td>
                  <td className="px-5 py-2 text-right tnum text-t2">{num(q.alter)}</td>
                  <td className="px-5 py-2 text-right tnum text-t2">{num(q.extra)}</td>
                </tr>
              ))}
              {quality.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-muted">No reject, alter or extra recorded</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3 t-body font-bold">
            On-time Delivery <span className="font-medium text-faint">· ETD vs last dispatch</span>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">Vendor</th>
                <th className="px-5 py-2.5 text-right font-semibold">Cards</th>
                <th className="px-5 py-2.5 text-right font-semibold">On time</th>
                <th className="px-5 py-2.5 text-right font-semibold">Rate</th>
                <th className="px-5 py-2.5 text-right font-semibold">Avg days late</th>
              </tr>
            </thead>
            <tbody>
              {onTime.byVendor.slice(0, 12).map((v) => (
                <tr key={v.vendor} className="border-b border-hairline last:border-0">
                  <td className="px-5 py-2 font-semibold">{v.vendor}</td>
                  <td className="px-5 py-2 text-right tnum text-t2">{num(v.measured)}</td>
                  <td className="px-5 py-2 text-right tnum text-t2">{num(v.onTime)}</td>
                  <td className="px-5 py-2 text-right">
                    {v.rate < 0.8 ? <Badge tone="warn">{pct(v.rate)}</Badge> : <span className="tnum font-bold">{pct(v.rate)}</span>}
                  </td>
                  <td className="px-5 py-2 text-right tnum text-t2">{v.avgDaysLate}</td>
                </tr>
              ))}
              {onTime.byVendor.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-muted">No card has both a planned ETD and a dispatch</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </Card>
      </div>

      {/* Change 25 Part F — per-job margin. Owner-only: not rendered and not queried
          for anyone else, so cost never crosses the wire to a staff session. */}
      {owner && (
        <Card className="mt-3.5 overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3 t-body font-bold">
            Job Margins <span className="font-medium text-faint">· evidenced cost vs dispatched value</span>
          </div>
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">Job</th>
                <th className="px-5 py-2.5 font-semibold">Vendor</th>
                <th className="px-5 py-2.5 text-right font-semibold">Fabric</th>
                <th className="px-5 py-2.5 text-right font-semibold">Trims</th>
                <th className="px-5 py-2.5 text-right font-semibold">Finishing</th>
                <th className="px-5 py-2.5 text-right font-semibold">Cost</th>
                <th className="px-5 py-2.5 text-right font-semibold">Value</th>
                <th className="px-5 py-2.5 text-right font-semibold">Margin</th>
              </tr>
            </thead>
            <tbody>
              {margins.slice(0, 20).map((m) => (
                <tr key={m.jobCardId} className="border-b border-hairline last:border-0">
                  <td className="px-5 py-2">
                    <Link href={`/job-cards/${m.jobCardId}`} className="font-bold text-primary-ink hover:underline">{m.siNo}</Link>
                    <span className="ml-2 text-t3">{m.item}</span>
                  </td>
                  <td className="px-5 py-2 text-t2">{m.vendor}</td>
                  <td className="px-5 py-2 text-right tnum text-t2">{inr(m.fabricCost)}</td>
                  <td className="px-5 py-2 text-right tnum text-t2">{inr(m.trimCost)}</td>
                  <td className="px-5 py-2 text-right tnum text-t2">{inr(m.finishingCost)}</td>
                  <td className="px-5 py-2 text-right tnum font-semibold">{inr(m.cost)}</td>
                  <td className="px-5 py-2 text-right tnum font-semibold">{m.value > 0 ? inr(m.value) : "—"}</td>
                  <td className="px-5 py-2 text-right">
                    {m.value <= 0 ? (
                      <span className="text-t3">—</span>
                    ) : m.margin < 0 ? (
                      <Badge tone="danger">{inr(m.margin)}</Badge>
                    ) : (
                      <span className="tnum font-bold text-ok">{inr(m.margin)} <span className="font-medium text-t3">{pct(m.marginPct)}</span></span>
                    )}
                  </td>
                </tr>
              ))}
              {margins.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-muted">No job has a rated purchase or a dispatched value</td></tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {/* Vendor pendency */}
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3 t-body font-bold">Vendor Pendency <span className="font-medium text-faint">· goods out now</span></div>
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">Vendor</th>
                <th className="px-5 py-2.5 text-right font-semibold">Open</th>
                <th className="px-5 py-2.5 text-right font-semibold">Pieces out</th>
                <th className="px-5 py-2.5 text-right font-semibold">Days held</th>
              </tr>
            </thead>
            <tbody>
              {pendency.slice(0, 12).map((v) => (
                <tr key={v.vendor} className="border-b border-hairline last:border-0">
                  <td className="px-5 py-2 font-semibold">{v.vendor}</td>
                  <td className="px-5 py-2 text-right tnum text-t2">{v.openCards}</td>
                  <td className="px-5 py-2 text-right tnum font-bold">{num(v.piecesOut)}</td>
                  <td className="px-5 py-2 text-right">{v.daysHeld > 25 ? <Badge tone="danger">{v.daysHeld}d</Badge> : <span className="tnum text-t2">{v.daysHeld}d</span>}</td>
                </tr>
              ))}
              {pendency.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-muted">None pending</td></tr>}
            </tbody>
          </table>
        </Card>

        {/* Monthly fabric pipeline */}
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3 t-body font-bold">Monthly Fabric Pipeline <span className="font-medium text-faint">· demand × consumption</span></div>
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">Fabric</th>
                <th className="px-5 py-2.5 text-right font-semibold">Monthly req</th>
                <th className="px-5 py-2.5 text-right font-semibold">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.slice(0, 12).map((f) => (
                <tr key={f.fabric} className="border-b border-hairline last:border-0">
                  <td className="px-5 py-2 font-semibold">{f.fabric}</td>
                  <td className="px-5 py-2 text-right tnum">{num(f.monthlyReq)} {f.unit.toLowerCase()}</td>
                  <td className="px-5 py-2 text-right tnum font-bold">{inr(f.monthlyCost)}</td>
                </tr>
              ))}
              {pipeline.length === 0 && <tr><td colSpan={3} className="px-5 py-8 text-center text-muted">No forecast data</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Change 36 Part 3 — defect breakdown. "Reject 4%" is a number; "reject 4%, mostly
          stitching" is something the owner can act on. */}
      <Card className="mt-3.5 overflow-hidden p-0">
        <div className="border-b border-border px-5 py-3 t-body font-bold">
          Defects <span className="font-medium text-faint">· by category</span>
        </div>
        <table className="w-full t-sm">
          <thead>
            <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
              <th className="px-5 py-2.5 font-semibold">Defect</th>
              <th className="px-5 py-2.5 font-semibold">Category</th>
              <th className="px-5 py-2.5 text-right font-semibold">Pieces</th>
              <th className="px-5 py-2.5 text-right font-semibold">Share</th>
            </tr>
          </thead>
          <tbody>
            {defects.slice(0, 12).map((d) => (
              <tr key={`${d.category}-${d.name}`} className="border-b border-hairline last:border-0">
                <td className="px-5 py-2 font-semibold">{d.name}</td>
                <td className="px-5 py-2 text-t2">{d.category}</td>
                <td className="px-5 py-2 text-right tnum">{num(d.qty)}</td>
                <td className="px-5 py-2 text-right tnum text-t2">{pct(d.share, 1)}</td>
              </tr>
            ))}
            {defects.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-muted">No defects categorised yet</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* Change 36 Part 5 — wastage by vendor. Cards with no layers are excluded, not
          reported as total waste; units are never mixed. */}
      {owner && yieldByVendor.length > 0 && (
        <Card className="mt-3.5 overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3 t-body font-bold">
            Fabric yield <span className="font-medium text-faint">· standard vs actual by vendor</span>
          </div>
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">Vendor</th>
                <th className="px-5 py-2.5 text-right font-semibold">Cards</th>
                <th className="px-5 py-2.5 text-right font-semibold">Standard</th>
                <th className="px-5 py-2.5 text-right font-semibold">Actual</th>
                <th className="px-5 py-2.5 text-right font-semibold">Over</th>
                <th className="px-5 py-2.5 text-right font-semibold">Waste %</th>
              </tr>
            </thead>
            <tbody>
              {yieldByVendor.slice(0, 12).map((y) => (
                <tr key={`${y.key}-${y.unit}`} className="border-b border-hairline last:border-0">
                  <td className="px-5 py-2 font-semibold">{y.key} <span className="t-xs text-faint">{y.unit}</span></td>
                  <td className="px-5 py-2 text-right tnum text-t2">{num(y.cards)}</td>
                  <td className="px-5 py-2 text-right tnum text-t2">{num(y.standard, 2)}</td>
                  <td className="px-5 py-2 text-right tnum">{num(y.actual, 2)}</td>
                  <td className={`px-5 py-2 text-right tnum ${y.variance > 0 ? "text-danger" : "text-ok"}`}>
                    {y.variance > 0 ? "+" : ""}{num(y.variance, 2)}
                  </td>
                  <td className="px-5 py-2 text-right">
                    {y.wastePct != null && y.wastePct > 0.05
                      ? <Badge tone="danger">{pct(y.wastePct, 1)}</Badge>
                      : <span className="tnum text-t2">{y.wastePct == null ? "—" : pct(y.wastePct, 1)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
