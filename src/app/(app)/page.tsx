import { getDashboard } from "@/lib/queries";
import { Bar, Badge, ButtonLink, EmptyState, Panel, PageHeader, StatCard } from "@/components/ui";
import { CountUp } from "@/components/count-up";
import { TrendChart } from "@/components/trend-chart";
import { num, pct } from "@/lib/format";
import { CheckCircle2, Plus } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { kpis, vendors, overdue, trend } = await getDashboard();

  const cards = [
    { label: "Total Cut", value: kpis.totalCut, foot: `${num(kpis.totalJobs)} job cards` },
    { label: "Received", value: kpis.totalDispatched, foot: `${pct(kpis.fillRate, 1)} fill rate` },
    { label: "Balance to Receive", value: kpis.balance, foot: `across ${num(kpis.activeJobs)} active jobs` },
    { label: "Overdue Jobs", value: kpis.overdue, foot: "ETD passed · needs action", tone: "danger" as const },
  ];

  return (
    <div className="p-6">
      <PageHeader
        title="Production Dashboard"
        subtitle={`Live from ${num(kpis.totalJobs)} job cards. “Received” means stitched goods back in the warehouse — market dispatch to dealers is tracked separately in E-manage.`}
        actions={
          <ButtonLink href="/job-cards/new" variant="primary">
            <Plus size={15} strokeWidth={2.4} />
            New Job Card
          </ButtonLink>
        }
      />

      <section className="grid grid-cols-2 gap-3.5 rise lg:grid-cols-4">
        {cards.map((c) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={<CountUp value={c.value} />}
            foot={c.foot}
            tone={c.tone}
          />
        ))}
      </section>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 rise lg:grid-cols-[1.4fr_1fr]" style={{ animationDelay: "80ms" }}>
        <Panel title="Vendor dispatch progress" note="active jobs">
          {vendors.length === 0 ? (
            <EmptyState
              title="No active vendor workload"
              hint="Vendor progress appears once job cards are cut and issued to a stitching unit."
              className="py-8"
            />
          ) : (
            <div className="flex flex-col gap-3">
              {vendors.map((v) => (
                <div key={v.name} className="grid grid-cols-[8rem_1fr_2.5rem_3.5rem] items-center gap-3 t-sm">
                  <span className="truncate font-semibold">{v.name}</span>
                  <Bar value={v.fill} tone={v.fill < 0.65 ? "warn" : v.fill >= 0.99 ? "ok" : "primary"} />
                  <span className="text-right font-bold tnum">{pct(v.fill)}</span>
                  <span className="text-right text-t3 tnum">{num(v.cut)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Overdue" note="needs action · top 5">
          {overdue.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={22} strokeWidth={1.8} />}
              title="Nothing overdue"
              hint="Every active job card is still inside its planned ETD."
              className="py-8"
            />
          ) : (
            <div className="-my-1">
              {overdue.map((o) => (
                <Link
                  key={o.slug}
                  href={`/job-cards/${o.slug}`}
                  className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 t-sm transition-opacity duration-150 last:border-0 hover:opacity-70"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-bold text-accent-ink">{o.siNo}</span>
                    <span className="ml-2 text-t2">{o.item}</span>
                  </span>
                  <Badge tone="danger">{o.daysLate}d late</Badge>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="Weekly production trend"
        note="cut qty by order week"
        className="mt-3.5 rise"
        style={{ animationDelay: "160ms" }}
      >
        <TrendChart data={trend} />
      </Panel>
    </div>
  );
}
