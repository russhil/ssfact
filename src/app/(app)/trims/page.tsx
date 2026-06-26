import { getTrimStock, getTrimSummary } from "@/lib/trims";
import { TrimsTable } from "@/components/trims-table";
import { Card, PageHeader } from "@/components/ui";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TrimsPage() {
  const [rows, summary] = await Promise.all([getTrimStock(), getTrimSummary()]);
  const families = [...new Set(rows.map((r) => r.family).filter((f): f is string => !!f))].sort();

  return (
    <div className="p-6">
      <PageHeader
        title="Trims Store"
        subtitle="Live trims & accessories stock — zips, drawcord, niwad tape, labels, elastic. Current = latest physical count from the store register."
      />

      <div className="mb-4 grid grid-cols-4 gap-3.5">
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Items Tracked</div>
          <div className="mt-1.5 text-[22px] font-extrabold tnum">{num(summary.total)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Units in Store</div>
          <div className="mt-1.5 text-[22px] font-extrabold tnum">{num(summary.totalUnits)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Low (≥85% used)</div>
          <div className="mt-1.5 text-[22px] font-extrabold text-amber-500 tnum">{num(summary.low)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Short / Indent</div>
          <div className="mt-1.5 text-[22px] font-extrabold text-danger tnum">{num(summary.short)}</div>
        </Card>
      </div>

      <TrimsTable rows={rows} families={families} />
    </div>
  );
}
