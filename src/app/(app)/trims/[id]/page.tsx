import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTrimStock, getTrimLedger } from "@/lib/trims";
import { getTrimSourcing } from "@/lib/masters";
import { db } from "@/lib/db";
import { getCurrentUser, canSeeCost as canSee } from "@/lib/auth";
import { Card, Badge } from "@/components/ui";
import { ImageUploader } from "@/components/image-uploader";
import { SourcingPanel } from "@/components/sourcing-panel";
import { StockAdjust } from "@/components/stock-adjust";
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
  const canSeeCost = canSee(u); // sourcing rates are cost data — owner only
  const images = await db.imageAsset.findMany({ where: { trimItemId: trimId }, orderBy: { sortOrder: "asc" } });
  // Change 18 Part E: trim PO history (trims have no per-supplier rate record of their own).
  const sourcing = canSeeCost ? await getTrimSourcing(trimId) : null;
  // The unit is needed by the stock-adjust control for everyone who can edit; the rate is
  // cost data and stays owner-only.
  const master = await db.trimItem.findUnique({ where: { id: trimId }, select: { ratePerUnit: true, unit: true } });
  const trimMaster = canSeeCost ? master : null;

  return (
    <div className="p-6">
      <Link href="/trims" className="mb-4 inline-flex items-center gap-1.5 t-sm font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Trims Store
      </Link>

      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <h1 className="t-display font-bold tracking-tight">{stock.name}</h1>
        {stock.family && <span className="t-sm text-faint">{stock.family}</span>}
        {stock.status === "short" ? <Badge tone="danger">Indent</Badge> : stock.status === "low" ? <Badge tone="warn">Low</Badge> : <Badge tone="ok">OK</Badge>}
        {/* Change 22 Part E: count the rack, write off damage, set an opening figure —
            posted through the ledger with a reason, never a silent overwrite. */}
        {canEdit && (
          <span className="ml-auto">
            <StockAdjust
              target={{ kind: "trim", trimItemId: stock.id }}
              name={stock.name}
              current={stock.current}
              unit={master?.unit ?? null}
              size="md"
            />
          </span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3.5">
        {[
          ["Opening", num(stock.opening)],
          ["Current", num(stock.current)],
          ["Stock In", num(stock.inTotal)],
          ["Stock Out", num(stock.outTotal)],
        ].map(([l, v]) => (
          <Card key={l} className="p-4">
            <div className="t-xs font-semibold uppercase tracking-wide text-muted">{l}</div>
            <div className={`mt-1.5 t-display font-extrabold tnum ${l === "Current" && stock.current <= 0 ? "text-danger" : ""}`}>{v}</div>
          </Card>
        ))}
      </div>
      

      {sourcing && (
        <SourcingPanel pos={sourcing.pos} unit={trimMaster?.unit ?? ""} poHref="/pot" estimate={trimMaster?.ratePerUnit ?? null} />
      )}

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
        <div className="border-b border-border px-5 py-3 t-body font-bold">
          Stock Ledger <span className="font-medium text-faint">· every recorded movement</span>
        </div>
        <table className="w-full t-sm">
          <thead>
            <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
              <th className="px-5 py-2.5 font-semibold">Date</th>
              <th className="px-5 py-2.5 font-semibold">Type</th>
              <th className="px-5 py-2.5 font-semibold">Invoice</th>
              <th className="px-5 py-2.5 font-semibold">Vendor</th>
              {/* Change 22 Part E: an adjustment says WHY here — the ledger and the balance
                  can no longer disagree without a recorded reason. */}
              <th className="px-5 py-2.5 font-semibold">Reason</th>
              <th className="px-5 py-2.5 text-right font-semibold">Qty</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((m) => (
              <tr key={m.id} className="border-b border-hairline last:border-0">
                <td className="px-5 py-2.5 text-t2 tnum">{fmtDate(m.date)}</td>
                <td className="px-5 py-2.5">
                  <Badge tone={m.type === "ISSUE" ? "danger" : "ok"}>{m.type === "ISSUE" ? "OUT" : "IN"}</Badge>
                </td>
                <td className="px-5 py-2.5 text-t2">{m.invoice ?? "—"}</td>
                <td className="px-5 py-2.5 text-t2">{m.vendor ?? "—"}</td>
                <td className="px-5 py-2.5 text-t2">
                  {m.reason ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={m.reason === "DAMAGE" || m.reason === "WASTAGE" ? "warn" : "default"}>{m.reason}</Badge>
                      {m.note && <span className="t-xs text-faint">{m.note}</span>}
                    </span>
                  ) : (
                    <span className="text-faint">{m.note ?? "—"}</span>
                  )}
                </td>
                <td className={`px-5 py-2.5 text-right font-bold tnum ${m.type === "ISSUE" ? "text-danger" : "text-ok"}`}>
                  {m.type === "ISSUE" ? "−" : "+"}
                  {num(m.qty)}
                </td>
              </tr>
            ))}
            {ledger.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-muted">No movements.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
