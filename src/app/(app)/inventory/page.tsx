import Link from "next/link";
import { getFabricStock } from "@/lib/inventory";
import { Card, Badge, PageHeader } from "@/components/ui";
import { num, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const stock = await getFabricStock();
  const low = stock.filter((s) => s.usedPct >= 0.85 && s.available > 0).length;
  const short = stock.filter((s) => s.available <= 0).length;
  const totalAvail = stock.reduce((a, s) => a + Math.max(0, s.available), 0);

  return (
    <div className="p-6">
      <PageHeader
        title="Inventory"
        subtitle="Live fabric stock — depletes automatically as job cards consume it."
      />

      <div className="mb-4 grid grid-cols-4 gap-3.5">
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Fabrics Tracked</div>
          <div className="mt-1.5 text-[22px] font-extrabold tnum">{stock.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Available Stock</div>
          <div className="mt-1.5 text-[22px] font-extrabold tnum">{num(totalAvail)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Low (≥85% used)</div>
          <div className="mt-1.5 text-[22px] font-extrabold text-amber-500 tnum">{low}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Short / Indent</div>
          <div className="mt-1.5 text-[22px] font-extrabold text-danger tnum">{short}</div>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-semibold">Fabric</th>
              <th className="px-4 py-2.5 text-right font-semibold">Opening</th>
              <th className="px-4 py-2.5 text-right font-semibold">Issued</th>
              <th className="px-4 py-2.5 text-right font-semibold">Available</th>
              <th className="px-4 py-2.5 font-semibold">Utilisation</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {stock.map((s) => {
              const w = Math.min(100, Math.max(0, s.usedPct * 100));
              const tone = s.available <= 0 ? "danger" : s.usedPct >= 0.85 ? "warn" : "primary";
              return (
                <tr key={s.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-2.5">
                    <Link href={`/inventory/${s.id}`} className="font-semibold text-primary-ink hover:underline">
                      {s.name}
                    </Link>
                    <span className="ml-1.5 text-[10px] text-faint">{s.unit}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-500 tnum">{num(s.opening)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500 tnum">{num(s.issued)}</td>
                  <td className={`px-4 py-2.5 text-right font-bold tnum ${s.available <= 0 ? "text-danger" : ""}`}>
                    {num(s.available)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${tone === "danger" ? "bg-rose-500" : tone === "warn" ? "bg-amber-400" : "bg-primary"}`}
                          style={{ width: `${w}%` }}
                        />
                      </div>
                      <span className="tnum text-[11px] font-semibold">{pct(s.usedPct)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {s.available <= 0 ? (
                      <Badge tone="danger">Indent</Badge>
                    ) : s.usedPct >= 0.85 ? (
                      <Badge tone="warn">Low</Badge>
                    ) : (
                      <Badge tone="ok">OK</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
