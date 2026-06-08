import Link from "next/link";
import { notFound } from "next/navigation";
import { getFabricStock, getFabricLedger } from "@/lib/inventory";
import { Card, Badge } from "@/components/ui";
import { num, pct, fmtDate } from "@/lib/format";
import { siSlug } from "@/lib/jobs";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function FabricDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fabricId = Number(id);
  const stock = (await getFabricStock()).find((s) => s.id === fabricId);
  if (!stock) notFound();
  const ledger = await getFabricLedger(fabricId);

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

      <Card className="mt-3.5 overflow-hidden p-0">
        <div className="border-b border-border px-5 py-3 text-[13px] font-bold">
          Stock Ledger <span className="font-medium text-faint">· every issue against this fabric</span>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-5 py-2.5 font-semibold">Date</th>
              <th className="px-5 py-2.5 font-semibold">Type</th>
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
                <td className="px-5 py-2.5">
                  {m.jobCard ? (
                    <Link href={`/job-cards/${siSlug(m.jobCard.siNo)}`} className="font-semibold text-primary-ink hover:underline">
                      {m.jobCard.siNo}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-5 py-2.5 text-slate-500">{m.jobCard?.style.itemDesc ?? "—"}</td>
                <td className={`px-5 py-2.5 text-right font-bold tnum ${m.type === "ISSUE" ? "text-danger" : "text-emerald-600"}`}>
                  {m.type === "ISSUE" ? "−" : "+"}
                  {num(m.qty)}
                </td>
              </tr>
            ))}
            {ledger.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-muted">No movements yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
