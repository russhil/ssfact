import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getFabricOrder } from "@/lib/masters";
import { getCurrentUser } from "@/lib/auth";
import { num, inr, fmtDate } from "@/lib/format";
import { POActions } from "@/components/po-actions";
import { BrandLetterhead } from "@/components/brand";
import { DocShell, PoParties, PoTotals, PoSignatory, DocAttachments, docTitle } from "@/components/po-doc";
import { ImageUploader } from "@/components/image-uploader";

export const dynamic = "force-dynamic";

/**
 * Change 25 Part K.1 — name the exported PDF after the document, not the app. A draft
 * with no PO number yet falls back to its order id so it is never the generic app name.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = await getFabricOrder(Number(id));
  return { title: docTitle(o?.poNumber ?? null, `Fabric Order #${id}`) };
}

export default async function POPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await getFabricOrder(Number(id));
  if (!o) notFound();
  // Change 25 Part B: this route used to call getCurrentUser() and throw the result
  // away, so it was the one document page with no role check — /pot, /challan-doc and
  // /dispatch-doc all gate. A PO carries supplier rates; it gets the same gate.
  const u = await getCurrentUser();
  if (!u || (u.role !== "ADMIN" && u.role !== "STAFF")) notFound();
  const hasRate = o.rate != null && o.rate > 0;
  const subtotal = hasRate ? o.totalQty * (o.rate as number) : 0;

  const poNo = o.poNumber ?? "(draft — generate PO first)";
  const summary =
    `Sport Sun PO ${o.poNumber ?? ""}\n${o.fabric}${o.gsm ? ` (${o.gsm} gsm)` : ""}\n` +
    o.lines.map((l) => `• ${l.colour}: ${num(l.qty)} ${o.unit.toLowerCase()}`).join("\n") +
    `\nTotal: ${num(o.totalQty)} ${o.unit.toLowerCase()}` +
    (o.expectedDate ? `\nExpected: ${fmtDate(o.expectedDate)}` : "");

  return (
    <DocShell>
      <div className="mb-4 flex items-center justify-between">
        <Link href="/fabric-orders" className="no-print text-[12px] font-medium text-muted hover:text-ink">← Fabric Orders</Link>
        <POActions orderId={o.id} email={o.supplier?.email ?? null} phone={o.supplier?.phone ?? null} subject={`Purchase Order ${o.poNumber ?? ""} — Sport Sun`} summary={summary} />
      </div>

      <div className="flex items-start justify-between border-b-2 border-ink pb-3">
        <div>
          <BrandLetterhead />
          <h1 className="mt-1.5 text-[13px] font-bold tracking-wide">PURCHASE ORDER</h1>
        </div>
        <div className="text-right">
          <div className="text-[16px] font-bold">{poNo}</div>
          <div className="text-[11px] text-muted">{fmtDate(o.poGeneratedAt ?? o.orderDate)}</div>
          {/* Change 18 Part C: the inward challans this PO actually came in on. */}
          {o.challans.length > 0 && (
            <div className="no-print mt-1 text-[11px] text-muted">
              Received on{" "}
              {o.challans.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ", "}
                  <Link href={`/challan-doc/${c.id}`} className="font-semibold text-primary-ink hover:underline">{c.challanNo ?? `Draft #${c.id}`}</Link>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Change 25 Part G.3 — both parties in full */}
      <PoParties supplier={o.supplier} buyer={o.buyer} shipTo={o.shipTo} />

      <div className="mt-3 text-[12px]">
        <span className="text-faint">Fabric </span>
        <span className="font-semibold">{o.fabric}{o.gsm ? ` · ${o.gsm} gsm` : ""}</span>
        {o.expectedDate && <span className="text-slate-600"> · Expected {fmtDate(o.expectedDate)}</span>}
      </div>

      <table className="mt-5 w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-y border-ink text-left">
            <th className="px-2 py-1.5">Colour</th>
            <th className="px-2 py-1.5 text-right">Qty ({o.unit.toLowerCase()})</th>
            {hasRate && <th className="px-2 py-1.5 text-right">Rate</th>}
            {hasRate && <th className="px-2 py-1.5 text-right">Amount</th>}
          </tr>
        </thead>
        <tbody>
          {o.lines.map((l, i) => (
            <tr key={i} className="border-b border-slate-200">
              <td className="px-2 py-1.5 font-medium">{l.colour}</td>
              <td className="px-2 py-1.5 text-right tnum">{num(l.qty)}</td>
              {hasRate && <td className="px-2 py-1.5 text-right tnum">{inr(o.rate)}</td>}
              {hasRate && <td className="px-2 py-1.5 text-right tnum">{inr(l.qty * (o.rate as number))}</td>}
            </tr>
          ))}
          <tr className="border-t border-ink font-bold">
            <td className="px-2 py-1.5">Total</td>
            <td className="px-2 py-1.5 text-right tnum">{num(o.totalQty)}</td>
            {hasRate && <td className="px-2 py-1.5"></td>}
            {hasRate && <td className="px-2 py-1.5 text-right tnum">{inr(subtotal)}</td>}
          </tr>
          {/* Change 25 Part K.2 — only meaningful once the order carries a rate. */}
          {hasRate && <PoTotals subtotal={subtotal} gstRate={o.gstRate} colSpan={3} />}
        </tbody>
      </table>

      {/* Change 25 Part J — the remark column existed and was stored; it just never printed. */}
      {o.remarks && <p className="mt-4 text-[11px] text-slate-600">Remarks: {o.remarks}</p>}

      <PoSignatory signatory={o.signatory} preparedBy={o.preparedBy} />

      {/* Change 25 Part H.1 — the shade card the supplier sent, attached against the
          order it belongs to. Pure UI: attachImages already mapped fabricOrder. */}
      <div className="no-print mt-6 border-t border-slate-200 pt-4">
        <ImageUploader
          entity="fabricOrder"
          entityId={o.id}
          kind="shade_card"
          multiple
          images={o.images}
          label="Shade card"
        />
      </div>

      {/* Change 25 Part K.3 — shade card becomes page 2 of the same PDF. */}
      <DocAttachments images={o.images} label="Shade card" showThumbnails={false} />
    </DocShell>
  );
}
