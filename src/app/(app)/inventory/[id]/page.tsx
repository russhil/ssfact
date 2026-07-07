import Link from "next/link";
import { notFound } from "next/navigation";
import { getFabricStock, getFabricLedger } from "@/lib/inventory";
import { getCurrentUser } from "@/lib/auth";
import { Card, Badge } from "@/components/ui";
import { FabricMasterForm } from "@/components/fabric-master-form";
import { num, pct, fmtDate } from "@/lib/format";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function FabricDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fabricId = Number(id);
  const stock = (await getFabricStock()).find((s) => s.id === fabricId);
  if (!stock) notFound();
  const ledger = await getFabricLedger(fabricId);
  const u = await getCurrentUser();
  const canEdit = u?.role === "ADMIN" || u?.role === "STAFF";

  const attrs: [string, string][] = [
    ["Unit", stock.unit],
    ["Preset GSM", stock.gsm != null ? num(stock.gsm) : "—"],
    ["Preset roll width", stock.rollWidth != null ? num(stock.rollWidth) : "—"],
    ["Form", stock.form ?? "—"],
    ["Est. price", stock.ratePerUnit != null ? `${num(stock.ratePerUnit)} /${stock.unit.toLowerCase()}` : "—"],
    ["Suppliers", stock.suppliers.length ? stock.suppliers.map((s) => s.name).join(", ") : "—"],
  ];

  return (
    <div className="p-6">
      <Link href="/inventory" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Inventory
      </Link>

      <div className="mb-5 flex items-center gap-2.5">
        <h1 className="text-[22px] font-bold tracking-tight">{stock.name}</h1>
        <span className="text-[12px] text-faint">{stock.unit}</span>
        {stock.available <= 0 ? <Badge tone="danger">Indent</Badge> : stock.usedPct >= 0.85 ? <Badge tone="warn">Low</Badge> : <Badge tone="ok">OK</Badge>}
      </div>

      <div className="grid grid-cols-4 gap-3.5">
        {[
          ["Opening", num(stock.opening)],
          ["Issued", num(stock.issued)],
          ["Available", num(stock.available)],
          ["Utilisation", pct(stock.usedPct)],
        ].map(([l, v]) => (
          <Card key={l} className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{l}</div>
            <div className={`mt-1.5 text-[22px] font-extrabold tnum ${l === "Available" && stock.available <= 0 ? "text-danger" : ""}`}>{v}</div>
          </Card>
        ))}
      </div>

      {/* master attributes */}
      <Card className="mt-3.5 p-5">
        <h3 className="mb-3 text-[13px] font-bold">Fabric Attributes</h3>
        <dl className="grid grid-cols-6 gap-x-6 gap-y-2.5 text-[12px]">
          {attrs.map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-[11px] text-faint">{k}</dt>
              <dd className="font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* per-colour stock */}
      {stock.colors.length > 0 && (
        <Card className="mt-3.5 overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3 text-[13px] font-bold">
            Stock by Colour <span className="font-medium text-faint">· {stock.colors.length} colours</span>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">Colour</th>
                <th className="px-5 py-2.5 text-right font-semibold">Opening</th>
                <th className="px-5 py-2.5 text-right font-semibold">Current</th>
                <th className="px-5 py-2.5 font-semibold">Utilisation</th>
                <th className="px-5 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {stock.colors.map((c) => {
                const w = Math.min(100, Math.max(0, c.usedPct * 100));
                return (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2.5 font-semibold text-slate-600">{c.color}</td>
                    <td className="px-5 py-2.5 text-right text-slate-500 tnum">{num(c.opening)}</td>
                    <td className={`px-5 py-2.5 text-right font-bold tnum ${c.current <= 0 ? "text-danger" : ""}`}>{num(c.current)}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${c.status === "Indent" ? "bg-rose-500" : c.status === "Low" ? "bg-amber-400" : "bg-primary"}`} style={{ width: `${w}%` }} />
                        </div>
                        <span className="tnum text-[11px] font-semibold">{pct(c.usedPct)}</span>
                      </div>
                    </td>
                    <td className="px-5 py-2.5">
                      {c.status === "Indent" ? <Badge tone="danger">Indent</Badge> : c.status === "Low" ? <Badge tone="warn">Low</Badge> : <Badge tone="ok">OK</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {canEdit && (
        <FabricMasterForm
          fabricId={stock.id}
          unit={stock.unit}
          gsm={stock.gsm}
          rollWidth={stock.rollWidth}
          form={stock.form}
          ratePerUnit={stock.ratePerUnit}
          suppliers={stock.suppliers}
          colors={stock.colors.map((c) => ({
            id: c.id,
            color: c.color,
            opening: Math.round(c.opening * 100) / 100,
            current: Math.round(c.current * 100) / 100,
          }))}
        />
      )}

      <Card className="mt-3.5 overflow-hidden p-0">
        <div className="border-b border-border px-5 py-3 text-[13px] font-bold">
          Stock Ledger <span className="font-medium text-faint">· every issue against this fabric</span>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-5 py-2.5 font-semibold">Date</th>
              <th className="px-5 py-2.5 font-semibold">Type</th>
              <th className="px-5 py-2.5 font-semibold">Colour</th>
              <th className="px-5 py-2.5 font-semibold">Job Card</th>
              <th className="px-5 py-2.5 font-semibold">Style</th>
              <th className="px-5 py-2.5 text-right font-semibold">Qty</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((m) => (
              <tr key={m.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2.5 text-slate-500 tnum">{fmtDate(m.date)}</td>
                <td className="px-5 py-2.5">
                  <Badge tone={m.type === "ISSUE" ? "danger" : "ok"}>{m.type}</Badge>
                </td>
                <td className="px-5 py-2.5 font-medium text-slate-500">{m.color ?? "—"}</td>
                <td className="px-5 py-2.5">
                  {m.jobCard ? (
                    <Link href={`/job-cards/${m.jobCard.id}`} className="font-semibold text-primary-ink hover:underline">
                      {m.jobCard.siNo}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-5 py-2.5 text-slate-500">{m.jobCard ? m.jobCard.product.itemDesc ?? m.jobCard.product.name : "—"}</td>
                <td className={`px-5 py-2.5 text-right font-bold tnum ${m.type === "ISSUE" ? "text-danger" : "text-emerald-600"}`}>
                  {m.type === "ISSUE" ? "−" : "+"}
                  {num(m.qty)}
                </td>
              </tr>
            ))}
            {ledger.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-muted">No movements yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
