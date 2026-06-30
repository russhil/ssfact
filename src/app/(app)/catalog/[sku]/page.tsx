import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Factory } from "lucide-react";
import { getProductDetail, STATUS_LABEL, statusTone } from "@/lib/catalog";
import { listLookups } from "@/lib/masters";
import { PO_STATUS_LABEL, poStatusTone } from "@/lib/production";
import { getCurrentUser } from "@/lib/auth";
import { Card, Badge } from "@/components/ui";
import { ImageUploader } from "@/components/image-uploader";
import { ProductMasterForm } from "@/components/product-master-form";
import { num, inr, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const trimTone = (s: "ok" | "low" | "short") => (s === "short" ? "danger" : s === "low" ? "warn" : "ok");
const trimLabel = (s: "ok" | "low" | "short") => (s === "short" ? "Short" : s === "low" ? "Low" : "OK");
const lbl = (s: string | null) => (s ? s.replace(/_/g, " ") : "—");

export default async function ProductDetail({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const p = await getProductDetail(decodeURIComponent(sku));
  if (!p) notFound();
  const u = await getCurrentUser();
  const canEdit = u?.role === "ADMIN" || u?.role === "STAFF";
  const canSeeCost = u?.role === "ADMIN"; // cost hidden from office/production view
  const headCategories = canEdit ? await listLookups("HEAD_CATEGORY") : [];

  return (
    <div className="p-6">
      <Link href="/catalog" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Product Master
      </Link>

      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <h1 className="text-[22px] font-bold tracking-tight">{p.name}</h1>
        <span className="text-[12px] font-semibold text-faint">{p.skuCode}</span>
        <Badge tone={statusTone(p.status)}>{STATUS_LABEL[p.status] ?? p.status}</Badge>
        {p.styleNo && <span className="text-[12px] text-faint">Style #{p.styleNo}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        {([
          ...(canSeeCost ? [["MRP", inr(p.mrp)], ["Wholesale", inr(p.wholesale)]] : [["Category", p.headCategory ?? "—"], ["Fabric", p.fabricName ?? "—"]]),
          ["Sampling", lbl(p.samplingStatus)],
          ["Production lot", lbl(p.productionLot)],
        ] as [string, string][]).map(([l, v]) => (
          <Card key={l} className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{l}</div>
            <div className="mt-1.5 text-[18px] font-extrabold">{v}</div>
          </Card>
        ))}
      </div>

      {/* gallery + edit form */}
      <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <Card className="p-5">
          {canEdit ? (
            <ImageUploader entity="product" entityId={p.id} kind="product" multiple images={p.images} label="Product photos" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {p.images.map((i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i.id} src={i.thumbUrl ?? i.url} alt="" loading="lazy" className="h-24 w-24 rounded-lg border border-border object-cover" />
              ))}
              {p.images.length === 0 && <p className="text-[12px] text-muted">No photos.</p>}
            </div>
          )}
          {(p.fabricRemarks || p.otherRemarks) && (
            <div className="mt-3 space-y-1 text-[12px]">
              {p.fabricRemarks && <div><span className="text-faint">Fabric: </span>{p.fabricRemarks}</div>}
              {p.otherRemarks && <div><span className="text-faint">Remarks: </span>{p.otherRemarks}</div>}
            </div>
          )}
        </Card>

        {canEdit && (
          <ProductMasterForm
            product={{
              id: p.id, name: p.name, headCategory: p.headCategory, status: p.status,
              samplingStatus: p.samplingStatus, productionLot: p.productionLot, fabricRemarks: p.fabricRemarks, otherRemarks: p.otherRemarks,
              avgConsumption: p.avgConsumption, mrp: p.mrp, customWsRate: p.customWsRate, colors: p.colors,
            }}
            canSeeCost={canSeeCost}
            headCategories={headCategories}
          />
        )}
      </div>

      {/* Live production — from the linked workbook style's job cards */}
      {p.production && (
        <Card className="mt-3.5 p-5">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-bold">
            <Factory size={15} className="text-primary-ink" />
            In production
            <span className="font-medium text-faint">· linked style {p.production.styleNo}</span>
          </div>
          <div className="grid grid-cols-4 gap-3.5">
            {[
              ["Job Cards", num(p.production.jobCount)],
              ["Open", num(p.production.openJobs)],
              ["Cut", num(p.production.cut)],
              ["Received", num(p.production.received)],
            ].map(([l, v]) => (
              <div key={l}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{l}</div>
                <div className="mt-1 text-[18px] font-extrabold tnum">{v}</div>
              </div>
            ))}
          </div>
          {p.production.jobs.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.production.jobs.map((j) => (
                <Link
                  key={j.siNo}
                  href={`/job-cards/${j.slug}`}
                  className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-primary hover:text-primary-ink"
                >
                  {j.siNo} · {num(j.received)}/{num(j.cutQty)}
                </Link>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Bill of materials with live trim-store stock */}
      {p.boms.map((b) => (
        <Card key={b.id} className="mt-3.5 overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="text-[13px] font-bold">
              Bill of Materials <span className="font-medium text-faint">· {b.code} {b.styleName}</span>
            </div>
            <span className="text-[11px] text-faint">{b.matched} of {b.total} materials matched to Trims Store</span>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">#</th>
                <th className="px-5 py-2.5 font-semibold">Material</th>
                <th className="px-5 py-2.5 font-semibold">Colour</th>
                <th className="px-5 py-2.5 font-semibold">Qty · Avg</th>
                <th className="px-5 py-2.5 text-right font-semibold">Store Stock</th>
              </tr>
            </thead>
            <tbody>
              {b.lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-2 text-faint tnum">{l.sNo ?? ""}</td>
                  <td className="px-5 py-2 font-medium">{l.material}</td>
                  <td className="px-5 py-2 text-slate-500">{l.color ?? "—"}</td>
                  <td className="px-5 py-2 text-slate-500 tnum">
                    {l.qty != null ? num(l.qty) : ""}
                    {l.avg ? <span className="text-faint"> {l.avg}</span> : ""}
                    {l.qty == null && !l.avg ? "—" : ""}
                  </td>
                  <td className="px-5 py-2 text-right">
                    {l.trim ? (
                      <Link href={`/trims/${l.trim.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                        <span className={`tnum font-semibold ${l.trim.status === "short" ? "text-danger" : ""}`}>{num(l.trim.current)}</span>
                        <Badge tone={trimTone(l.trim.status)}>{trimLabel(l.trim.status)}</Badge>
                      </Link>
                    ) : (
                      <span className="text-[11px] text-faint">not tracked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {/* Production orders */}
      {p.orders.length > 0 && (
        <Card className="mt-3.5 overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3 text-[13px] font-bold">
            Production Orders <span className="font-medium text-faint">· target = 2× monthly sale</span>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">Order</th>
                <th className="px-5 py-2.5 font-semibold">Date</th>
                <th className="px-5 py-2.5 text-right font-semibold">Monthly Sale</th>
                <th className="px-5 py-2.5 text-right font-semibold">Target</th>
                <th className="px-5 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {p.orders.map((o) => (
                <tr key={o.orderNo} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2 font-semibold text-primary-ink">{o.orderNo}</td>
                  <td className="px-5 py-2 text-slate-500 tnum">{fmtDate(o.orderDate)}</td>
                  <td className="px-5 py-2 text-right tnum text-slate-500">{num(o.avgMonthlySale)}</td>
                  <td className="px-5 py-2 text-right font-bold tnum">{num(o.targetQty)}</td>
                  <td className="px-5 py-2"><Badge tone={poStatusTone(o.status)}>{PO_STATUS_LABEL[o.status] ?? o.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {!p.production && p.boms.length === 0 && p.orders.length === 0 && (
        <Card className="mt-3.5 p-8 text-center text-[12px] text-muted">
          This SKU isn’t linked to the production workbook and has no BOM or live orders yet.
        </Card>
      )}
    </div>
  );
}
