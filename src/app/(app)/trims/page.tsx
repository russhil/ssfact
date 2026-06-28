import { getTrimSummary } from "@/lib/trims";
import { getTrimMaster, getSuppliers } from "@/lib/masters";
import { TrimMasterManager } from "@/components/trim-master-manager";
import { Card, PageHeader } from "@/components/ui";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TrimsPage() {
  const [trims, summary, suppliers] = await Promise.all([getTrimMaster(), getTrimSummary(), getSuppliers()]);

  return (
    <div className="p-6">
      <PageHeader
        title="Trim Master"
        subtitle="One unified trim master across the 7 categories — stock, supplier, rate & specs. Add a trim with ~4 fields; current = latest physical count."
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

      <TrimMasterManager trims={trims} suppliers={suppliers.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))} />
    </div>
  );
}
