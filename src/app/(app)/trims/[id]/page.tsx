import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTrimStock, getTrimLedger } from "@/lib/trims";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Card, Badge } from "@/components/ui";
import { ImageUploader } from "@/components/image-uploader";
import { num, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TrimDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trimId = Number(id);
  const stock = (await getTrimStock()).find((s) => s.id === trimId);
  if (!stock) notFound();
  const ledger = await getTrimLedger(trimId);
  const u = await getCurrentUser();
  const canEdit = u?.role === "ADMIN" || u?.role === "STAFF";
  const images = await db.imageAsset.findMany({ where: { trimItemId: trimId }, orderBy: { sortOrder: "asc" } });

  return (
    <div className="p-6">
      <Link href="/trims" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Trims Store
      </Link>

      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <h1 className="text-[22px] font-bold tracking-tight">{stock.name}</h1>
        {stock.family && <span className="text-[12px] text-faint">{stock.family}</span>}
        {stock.status === "short" ? <Badge tone="danger">Indent</Badge> : stock.status === "low" ? <Badge tone="warn">Low</Badge> : <Badge tone="ok">OK</Badge>}
      </div>

      <div className="grid grid-cols-4 gap-3.5">
        {[
          ["Opening", num(stock.opening)],
          ["Current", num(stock.current)],
          ["Stock In", num(stock.inTotal)],
          ["Stock Out", num(stock.outTotal)],
        ].map(([l, v]) => (
          <Card key={l} className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{l}</div>
            <div className={`mt-1.5 text-[22px] font-extrabold tnum ${l === "Current" && stock.current <= 0 ? "text-danger" : ""}`}>{v}</div>
          </Card>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-faint">Current is the latest physical count from the store register — opening ± movements may not fully reconcile.</p>

      {(canEdit || images.length > 0) && (
        <Card className="mt-3.5 p-5">
          {canEdit ? (
            <ImageUploader entity="trim" entityId={trimId} kind="trim" multiple images={images.map((i) => ({ id: i.id, url: i.url, thumbUrl: i.thumbUrl, caption: i.caption }))} label="Trim photos" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {images.map((i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i.id} src={i.thumbUrl ?? i.url} alt="" loading="lazy" className="h-20 w-20 rounded-lg border border-border object-cover" />
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className="mt-3.5 overflow-hidden p-0">
        <div className="border-b border-border px-5 py-3 text-[13px] font-bold">
          Stock Ledger <span className="font-medium text-faint">· every recorded movement</span>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-5 py-2.5 font-semibold">Date</th>
              <th className="px-5 py-2.5 font-semibold">Type</th>
              <th className="px-5 py-2.5 font-semibold">Invoice</th>
              <th className="px-5 py-2.5 font-semibold">Vendor</th>
              <th className="px-5 py-2.5 text-right font-semibold">Qty</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((m) => (
              <tr key={m.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2.5 text-slate-500 tnum">{fmtDate(m.date)}</td>
                <td className="px-5 py-2.5">
                  <Badge tone={m.type === "ISSUE" ? "danger" : "ok"}>{m.type === "ISSUE" ? "OUT" : "IN"}</Badge>
                </td>
                <td className="px-5 py-2.5 text-slate-500">{m.invoice ?? "—"}</td>
                <td className="px-5 py-2.5 text-slate-500">{m.vendor ?? "—"}</td>
                <td className={`px-5 py-2.5 text-right font-bold tnum ${m.type === "ISSUE" ? "text-danger" : "text-emerald-600"}`}>
                  {m.type === "ISSUE" ? "−" : "+"}
                  {num(m.qty)}
                </td>
              </tr>
            ))}
            {ledger.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-muted">No movements recorded for this item.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
