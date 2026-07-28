import { getVendorLoad } from "@/lib/capacity";
import { PageHeader, Card, StatCard } from "@/components/ui";
import { PlanningBoard } from "@/components/planning-board";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Change 36 Part 4 — the load view. Derived from open pieces per LAYER vendor, against
 * the one number each vendor carries: pieces per day.
 */
export default async function PlanningPage() {
  const load = await getVendorLoad();
  const active = load.filter((l) => l.openPcs > 0 || l.cards > 0);
  const over = load.filter((l) => l.overCommitted);
  const noCapacity = load.filter((l) => l.openPcs > 0 && l.capacityPcs == null);
  const totalOpen = load.reduce((a, l) => a + Math.max(0, l.openPcs), 0);

  return (
    <div className="p-6">
      <PageHeader title="Planning" subtitle="Open work against each vendor's daily capacity" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open pieces" value={num(totalOpen)} foot={`${num(active.length)} vendors working`} />
        <StatCard label="Over-committed" value={num(over.length)} tone={over.length ? "danger" : undefined} foot="backlog past nearest ETD" />
        <StatCard label="No capacity set" value={num(noCapacity.length)} tone={noCapacity.length ? "warn" : undefined} foot="no projection possible" />
        <StatCard label="Overdue cards" value={num(load.reduce((a, l) => a + l.overdueCards, 0))} foot="ETD already passed" />
      </div>

      {load.length === 0 ? (
        <Card className="mt-3.5 p-6 text-center t-body text-muted">No active work</Card>
      ) : (
        <PlanningBoard rows={load} />
      )}
    </div>
  );
}
