import Link from "next/link";
import { getPendingTrims, getReadyCards } from "@/lib/insights";
import { Card, PageHeader } from "@/components/ui";
import { num } from "@/lib/format";
import { PendingTrimsTable } from "@/components/pending-trims-table";

export const dynamic = "force-dynamic";

export default async function PendingTrimsPage() {
  const [rows, ready] = await Promise.all([getPendingTrims(), getReadyCards()]);
  const totalShort = rows.reduce((a, r) => a + r.shortfall, 0);

  return (
    <div className="p-6">
      <PageHeader title="Pending Trims" subtitle="Trims short of store stock across active job cards" />

      {/* Change 39 Part E1 — the positive mirror: cards whose every trim is now covered. */}
      {ready.length > 0 && (
        <Card className="mb-4 p-4">
          <div className="flex items-center justify-between">
            <div className="t-xs font-semibold uppercase tracking-wide text-muted">Ready to start · all trims covered</div>
            <span className="rounded-full bg-ok/15 px-2 py-0.5 t-xs font-bold text-ok">{ready.length} card{ready.length === 1 ? "" : "s"}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ready.map((c) => (
              <Link key={c.id} href={`/job-cards/${c.id}`} className="rounded-md border border-ok/40 bg-ok/5 px-2 py-0.5 t-xs font-medium text-ink hover:bg-ok/10">
                {c.siNo} <span className="text-faint">· {c.productName} · {num(c.cutQty)} pcs</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-3">
        <Card className="p-4">
          <div className="t-xs font-semibold uppercase tracking-wide text-muted">Trims Short</div>
          <div className="mt-1.5 t-display font-extrabold text-danger tnum">{rows.length}</div>
        </Card>
        <Card className="p-4">
          <div className="t-xs font-semibold uppercase tracking-wide text-muted">Total Shortfall (units)</div>
          <div className="mt-1.5 t-display font-extrabold tnum">{num(totalShort)}</div>
        </Card>
      </div>

      {rows.length === 0 ? (
        <Card className="p-10 text-center t-body text-muted">No trims short</Card>
      ) : (
        <PendingTrimsTable rows={rows} />
      )}
    </div>
  );
}
