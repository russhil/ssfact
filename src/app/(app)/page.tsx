import { getDashboard } from "@/lib/queries";
import { getLowStockAlerts, getDelayedOrders } from "@/lib/insights";
import { getPayables } from "@/lib/party-ledger";
import { getCurrentUser, canSeeCost } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getCockpitCapacity } from "@/lib/cockpit";
import { inr } from "@/lib/format";
import { Bar, Badge, ButtonLink, EmptyState, Panel, PageHeader, StatCard } from "@/components/ui";
import { CountUp } from "@/components/count-up";
import { DraftPOButton } from "@/components/draft-po-button";
import { TrendChart } from "@/components/trend-chart";
import { num, pct, fmtDate } from "@/lib/format";
import { CheckCircle2, Plus } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Change 36 Part 9 D — `/` is in NO proxy.ts rule, so until now every authenticated
  // role landed on the full ADMIN dashboard, reorder levels and delayed POs included.
  // Sending the floor roles to their own lens is both the feature and a security fix.
  const who = await getCurrentUser();
  if (who?.role === "VENDOR" || who?.role === "TRIMS") redirect("/my-work");

  // Change 25 E/L: both widgets read the single selector that also drives the
  // list filters, so the count here and the length of the filtered list agree.
  // Change 36 Part 1: payables are cost data, so they are gated by canSeeCost AND not
  // even queried otherwise — the discipline /reports already follows. This matters here
  // more than elsewhere: `/` is in no proxy.ts rule, so every role reaches this page.
  const me = who;
  const owner = canSeeCost(me);
  const [{ kpis, vendors, overdue, trend }, lowStock, delayed, payables, capacity] = await Promise.all([
    getDashboard(),
    getLowStockAlerts(),
    getDelayedOrders(),
    owner ? getPayables() : Promise.resolve([]),
    owner ? getCockpitCapacity() : Promise.resolve(null),
  ]);

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
        subtitle={`${num(kpis.totalJobs)} job cards`}
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
            <EmptyState title="No active vendor workload" className="py-8" />
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
                    <span className="font-bold text-accent">{o.siNo}</span>
                    <span className="ml-2 text-t2">{o.item}</span>
                  </span>
                  <Badge tone="danger">{o.daysLate}d late</Badge>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 rise lg:grid-cols-2" style={{ animationDelay: "120ms" }}>
        {/* Change 25 Part E */}
        <Panel title="Reorder now" note={lowStock.length ? `${num(lowStock.length)} at or below level` : undefined}>
          {lowStock.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={22} strokeWidth={1.8} />}
              title="Nothing below reorder level"
              className="py-8"
            />
          ) : (
            <div className="-my-1">
              {lowStock.slice(0, 6).map((a) => (
                <Link
                  key={`${a.kind}-${a.id}`}
                  href={a.href}
                  className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 t-sm transition-opacity duration-150 last:border-0 hover:opacity-70"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{a.name}</span>
                    {a.colour && <span className="ml-1.5 text-t3">{a.colour}</span>}
                  </span>
                  <span className="shrink-0 text-t3 tnum">
                    {num(a.currentStock, 2)} / {num(a.reorderLevel, 2)} {a.unit}
                  </span>
                  <Badge tone="warn">−{num(a.gap, 2)}</Badge>
                  {/* Change 36 Part 6 C — draft the shortfall without re-typing it. */}
                  <DraftPOButton kind={a.kind} id={a.id} gap={a.gap} unit={a.unit} name={a.name} />
                </Link>
              ))}
            </div>
          )}
        </Panel>

        {/* Change 36 Part 1 — owner-only. Worst-aged first: the oldest money is the
            money most likely to have been forgotten. */}
        {owner && payables.length > 0 && (
          <Panel
            title="Payables"
            note={`${num(payables.length)} ${payables.length === 1 ? "party" : "parties"}`}
          >
            <div className="-my-1">
              {payables.slice(0, 6).map((p) => (
                <Link
                  key={`${p.kind}-${p.partyId}`}
                  href={p.kind === "VENDOR" ? `/vendors/${encodeURIComponent(p.name)}/account` : `/suppliers/${p.partyId}/account`}
                  className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 t-sm transition-opacity duration-150 last:border-0 hover:opacity-70"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{p.name}</span>
                    <span className="ml-1.5 text-t3">{p.kind === "VENDOR" ? "vendor" : "supplier"}</span>
                  </span>
                  <span className="shrink-0 tnum">{inr(Math.abs(p.outstanding))}</span>
                  {p.ageing.d90plus > 0 ? (
                    <Badge tone="danger">90+</Badge>
                  ) : p.outstanding < 0 ? (
                    <Badge tone="ok">advance</Badge>
                  ) : null}
                </Link>
              ))}
            </div>
          </Panel>
        )}

        {/* Change 36 Part 9 D — capacity load. Only vendors whose backlog cannot clear
            before their nearest ETD; a clean board shows nothing rather than noise. */}
        {owner && capacity && capacity.overCommitted.length > 0 && (
          <Panel title="Over-committed vendors" note={`${num(capacity.totalOpen)} pcs open`}>
            <div className="-my-1">
              {capacity.overCommitted.map((v) => (
                <Link
                  key={v.vendor}
                  href="/planning"
                  className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 t-sm transition-opacity duration-150 last:border-0 hover:opacity-70"
                >
                  <span className="min-w-0 truncate font-semibold">{v.vendor}</span>
                  <span className="shrink-0 tnum text-t3">{num(v.openPcs)} pcs</span>
                  <Badge tone="danger">
                    {v.daysToClear}d vs {v.daysToEtd}d
                  </Badge>
                </Link>
              ))}
            </div>
          </Panel>
        )}

        {/* Change 25 Part L */}
        <Panel title="Delayed deliveries" note={delayed.length ? `${num(delayed.length)} open` : undefined}>
          {delayed.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={22} strokeWidth={1.8} />}
              title="No delayed orders"
              className="py-8"
            />
          ) : (
            <div className="-my-1">
              {delayed.slice(0, 6).map((o) => (
                <Link
                  key={`${o.kind}-${o.id}`}
                  href={o.href}
                  className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 t-sm transition-opacity duration-150 last:border-0 hover:opacity-70"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{o.item}</span>
                    {o.supplier && <span className="ml-1.5 text-t3">{o.supplier}</span>}
                  </span>
                  <span className="shrink-0 text-t3 tnum">{o.poNumber ?? fmtDate(o.expectedDate)}</span>
                  {o.flag === "DELAYED" ? (
                    <Badge tone="danger">{o.daysLate}d late</Badge>
                  ) : (
                    <Badge tone="warn">No ETA</Badge>
                  )}
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
