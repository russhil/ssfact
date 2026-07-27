import Link from "next/link";
import { getPendingTrims } from "@/lib/insights";
import { Card, Badge, PageHeader } from "@/components/ui";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PendingTrimsPage() {
  const rows = await getPendingTrims();
  const totalShort = rows.reduce((a, r) => a + r.shortfall, 0);

  return (
    <div className="p-6">
      <PageHeader title="Pending Trims" subtitle="Trims short of store stock across active job cards" />

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
        <Card className="p-10 text-center t-body text-muted">No trims short.</Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 font-semibold">Trim</th>
                <th className="px-4 py-2.5 text-right font-semibold">Required</th>
                <th className="px-4 py-2.5 text-right font-semibold">In store</th>
                <th className="px-4 py-2.5 text-right font-semibold">Shortfall</th>
                <th className="px-4 py-2.5 font-semibold">Needed by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.trimId} className="border-b border-hairline last:border-0 align-top">
                  <td className="px-4 py-2.5 font-semibold text-ink">{r.trimName}</td>
                  <td className="px-4 py-2.5 text-right tnum">{num(r.required)}</td>
                  <td className={`px-4 py-2.5 text-right tnum ${r.inStore <= 0 ? "text-danger" : "text-t2"}`}>{num(r.inStore)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Badge tone="danger">−{num(r.shortfall)}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {r.cards.map((c) => (
                        <Link key={c.slug} href={`/job-cards/${c.slug}`} className="rounded-md border border-border px-1.5 py-0.5 t-xs font-medium text-primary-ink hover:bg-surface-2">
                          {c.siNo} <span className="text-faint">·{num(c.need)}</span>
                        </Link>
                      ))}
                    </div>
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
