import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTrimOrder } from "@/lib/masters";
import { getCurrentUser } from "@/lib/auth";
import { num, inr, fmtDate } from "@/lib/format";
import { POActions } from "@/components/po-actions";
import { BrandLetterhead } from "@/components/brand";
import { DocShell, PoParties, PoTotals, PoSignatory, DocAttachments, docTitle } from "@/components/po-doc";
import { ImageUploader } from "@/components/image-uploader";

export const dynamic = "force-dynamic";

/** Change 25 Part K.1 — the PDF is named after the POT number, not the app. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = await getTrimOrder(Number(id));
  return { title: docTitle(o?.poNumber ?? null, `Trim Order #${id}`) };
}

// Change 18 Part B: the trim purchase order document (POT-YYYY-NNN). Mirror of /po/[id];
// lives outside the (app) group so it prints without the app chrome, hence its own gate.
export default async function TrimPOPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await getTrimOrder(Number(id));
  if (!o) notFound();
  const u = await getCurrentUser();
  if (!u || (u.role !== "ADMIN" && u.role !== "STAFF")) notFound();

  const unit = (o.unit ?? "").toLowerCase();
  const hasRate = o.rate != null && o.rate > 0;
  const subtotal = hasRate ? o.totalQty * (o.rate as number) : 0;
  // A flat order prints as a single row; a split order prints its colour/size lines.
  const rows = o.lines.length > 0
    ? o.lines.map((l) => ({ label: [l.colour, l.size].filter(Boolean).join(" · ") || "—", qty: l.qty }))
    : [{ label: o.trim, qty: o.totalQty }];

  const poNo = o.poNumber ?? "(draft — generate PO first)";
  const summary =
    `Sport Sun PO ${o.poNumber ?? ""}\n${o.trim}\n` +
    rows.map((r) => `• ${r.label}: ${num(r.qty)} ${unit}`).join("\n") +
    `\nTotal: ${num(o.totalQty)} ${unit}` +
    (o.expectedDate ? `\nExpected: ${fmtDate(o.expectedDate)}` : "");

  return (
    <DocShell>
      <div className="mb-4 flex items-center justify-between">
        <Link href="/trim-orders" className="no-print text-[12px] font-medium text-muted hover:text-ink">← Trim Orders</Link>
        <POActions
          orderId={o.id}
          kind="TRIM"
          email={o.supplier?.email ?? null}
          phone={o.supplier?.phone ?? null}
          subject={`Purchase Order ${o.poNumber ?? ""} — Sport Sun`}
          summary={summary}
        />
      </div>

      <div className="flex items-start justify-between border-b-2 border-ink pb-3">
        <div>
          <BrandLetterhead />
          <h1 className="mt-1.5 text-[13px] font-bold tracking-wide">PURCHASE ORDER (TRIMS)</h1>
        </div>
        <div className="text-right">
          <div className="text-[16px] font-bold">{poNo}</div>
          <div className="text-[11px] text-muted">{fmtDate(o.poGeneratedAt ?? o.orderDate)}</div>
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
        <span className="text-faint">Trim </span>
        <span className="font-semibold">{o.trim}</span>
        {o.expectedDate && <span className="text-slate-600"> · Expected {fmtDate(o.expectedDate)}</span>}
      </div>

      <table className="mt-5 w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-y border-ink text-left">
            <th className="px-2 py-1.5">Item</th>
            <th className="px-2 py-1.5 text-right">Qty{unit ? ` (${unit})` : ""}</th>
            {hasRate && <th className="px-2 py-1.5 text-right">Rate</th>}
            {hasRate && <th className="px-2 py-1.5 text-right">Amount</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-200">
              <td className="px-2 py-1.5 font-medium">{r.label}</td>
              <td className="px-2 py-1.5 text-right tnum">{num(r.qty)}</td>
              {hasRate && <td className="px-2 py-1.5 text-right tnum">{inr(o.rate)}</td>}
              {hasRate && <td className="px-2 py-1.5 text-right tnum">{inr(r.qty * (o.rate as number))}</td>}
            </tr>
          ))}
          <tr className="border-t border-ink font-bold">
            <td className="px-2 py-1.5">Total</td>
            <td className="px-2 py-1.5 text-right tnum">{num(o.totalQty)}</td>
            {hasRate && <td className="px-2 py-1.5"></td>}
            {hasRate && <td className="px-2 py-1.5 text-right tnum">{inr(subtotal)}</td>}
          </tr>
          {/* Change 25 Part K.2 */}
          {hasRate && <PoTotals subtotal={subtotal} gstRate={o.gstRate} colSpan={3} />}
        </tbody>
      </table>

      {/* Change 25 Part J */}
      {o.remarks && <p className="mt-4 text-[11px] text-slate-600">Remarks: {o.remarks}</p>}

      <PoSignatory signatory={o.signatory} />

      {/* Change 25 Part H.2 — sample photo against the trim order. */}
      <div className="no-print mt-6 border-t border-slate-200 pt-4">
        <ImageUploader entity="trimOrder" entityId={o.id} kind="trim" multiple images={o.images} label="Sample photos" />
      </div>

      {/* Change 25 Part K.3 — a trim sample photo prints as a following page. */}
      <DocAttachments images={o.images} label="Sample photo" showThumbnails={false} />
    </DocShell>
  );
}
