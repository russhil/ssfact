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
      <PageHeader title="Pending Trims" subtitle="Trims short of store stock across active job cards — a live arrange/buy list. Cutting is never blocked; this is what to chase." />

      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Trims Short</div>
          <div className="mt-1.5 text-[22px] font-extrabold text-danger tnum">{rows.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Total Shortfall (units)</div>
          <div className="mt-1.5 text-[22px] font-extrabold tnum">{num(totalShort)}</div>
        </Card>
      </div>

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-[13px] text-muted">No trims short right now — every active card is covered. 🎉</Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 font-semibold">Trim</th>
                <th className="px-4 py-2.5 text-right font-semibold">Required</th>
                <th className="px-4 py-2.5 text-right font-semibold">In store</th>
                <th className="px-4 py-2.5 text-right font-semibold">Shortfall</th>
                <th className="px-4 py-2.5 font-semibold">Needed by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.trimId} className="border-b border-slate-50 last:border-0 align-top">
                  <td className="px-4 py-2.5 font-semibold text-ink">{r.trimName}</td>
                  <td className="px-4 py-2.5 text-right tnum">{num(r.required)}</td>
                  <td className={`px-4 py-2.5 text-right tnum ${r.inStore <= 0 ? "text-danger" : "text-slate-500"}`}>{num(r.inStore)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Badge tone="danger">−{num(r.shortfall)}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {r.cards.map((c) => (
                        <Link key={c.slug} href={`/job-cards/${c.slug}`} className="rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-primary-ink hover:bg-slate-50">
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
