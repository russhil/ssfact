import Link from "next/link";
import { getDashboard } from "@/lib/queries";
import { Card, Badge, Bar, PageHeader } from "@/components/ui";
import { CountUp } from "@/components/count-up";
import { TrendChart } from "@/components/trend-chart";
import { num, pct } from "@/lib/format";
import { ArrowUpRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { kpis, vendors, overdue, trend } = await getDashboard();

  const cards = [
    { label: "Total Cut", value: kpis.totalCut, foot: `${kpis.totalJobs} job cards`, tone: "ink" },
    { label: "Received", value: kpis.totalDispatched, foot: `${pct(kpis.fillRate, 1)} fill rate`, tone: "ink" },
    { label: "Balance to Receive", value: kpis.balance, foot: `across ${kpis.activeJobs} active jobs`, tone: "ink" },
    { label: "Overdue Jobs", value: kpis.overdue, foot: "ETD passed · needs action", tone: "danger" },
  ] as const;

  return (
    <div className="p-6">
      <PageHeader
        title="Production Dashboard"
        subtitle={`Live from ${kpis.totalJobs} job cards · "Received" = stitched goods back in the warehouse (market dispatch to dealers is tracked separately in E-manage)`}
        actions={
          <Link
            href="/job-cards/new"
            className="rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-indigo-600"
          >
            + New Job Card
          </Link>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3.5">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{c.label}</div>
            <div className={`mt-2 text-[27px] font-extrabold leading-none ${c.tone === "danger" ? "text-danger" : "text-ink"}`}>
              <CountUp value={c.value} />
            </div>
            <div className={`mt-2 text-[11px] ${c.tone === "danger" ? "text-danger" : "text-muted"}`}>{c.foot}</div>
          </Card>
        ))}
      </div>

      {/* vendor + overdue */}
      <div className="mt-3.5 grid grid-cols-[1.4fr_1fr] gap-3.5">
        <Card className="p-5">
          <h3 className="mb-4 text-[13px] font-bold">
            Vendor Receipt Progress <span className="font-medium text-faint">· active jobs</span>
          </h3>
          <div className="space-y-3">
            {vendors.map((v) => {
              const low = v.fill < 0.65;
              return (
                <div key={v.name} className="flex items-center gap-3 text-[12px]">
                  <span className="w-32 truncate font-semibold">{v.name}</span>
                  <div className="flex-1">
                    <Bar value={v.fill} tone={low ? "warn" : "primary"} />
                  </div>
                  <span className="w-9 text-right font-bold tnum">{pct(v.fill)}</span>
                  <span className="w-14 text-right text-faint tnum">{num(v.cut)}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-[13px] font-bold">
            Overdue — needs action <span className="font-medium text-faint">· top 5</span>
          </h3>
          <div>
            {overdue.length === 0 && <p className="py-6 text-center text-[12px] text-muted">Nothing overdue 🎉</p>}
            {overdue.map((o) => (
              <Link
                key={o.siNo}
                href={`/job-cards/${encodeURIComponent(o.siNo.replace(/\s/g, ""))}`}
                className="flex items-center justify-between border-b border-slate-50 py-2.5 text-[12px] last:border-0 hover:opacity-80"
              >
                <span>
                  <span className="font-bold text-primary-ink">{o.siNo}</span>{" "}
                  <span className="ml-1 text-slate-500">{o.item}</span>
                </span>
                <Badge tone="danger">{o.daysLate}d late</Badge>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      {/* trend */}
      <Card className="mt-3.5 p-5">
        <h3 className="mb-1 flex items-center gap-2 text-[13px] font-bold">
          Weekly Production Trend <span className="font-medium text-faint">· cut qty by order week</span>
          <ArrowUpRight size={14} className="text-emerald-500" />
        </h3>
        <TrendChart data={trend} />
      </Card>
    </div>
  );
}
