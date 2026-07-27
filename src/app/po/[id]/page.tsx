import Link from "next/link";
import { notFound } from "next/navigation";
import { getFabricOrder } from "@/lib/masters";
import { getCurrentUser } from "@/lib/auth";
import { num, inr, fmtDate } from "@/lib/format";
import { POActions } from "@/components/po-actions";
import { BrandLetterhead } from "@/components/brand";

export const dynamic = "force-dynamic";

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
  const grand = hasRate ? o.totalQty * (o.rate as number) : null;

  const poNo = o.poNumber ?? "(draft — generate PO first)";
  const summary =
    `Sport Sun PO ${o.poNumber ?? ""}\n${o.fabric}${o.gsm ? ` (${o.gsm} gsm)` : ""}\n` +
    o.lines.map((l) => `• ${l.colour}: ${num(l.qty)} ${o.unit.toLowerCase()}`).join("\n") +
    `\nTotal: ${num(o.totalQty)} ${o.unit.toLowerCase()}` +
    (o.expectedDate ? `\nExpected: ${fmtDate(o.expectedDate)}` : "");

  return (
    <div className="doc-light mx-auto max-w-[800px] bg-white p-8 text-[12px] text-ink">
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; } } @page { margin: 14mm; }`}</style>

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

      <div className="mt-3 grid grid-cols-2 gap-4 text-[12px]">
        <div>
          <div className="text-faint">To</div>
          <div className="font-semibold">{o.supplier?.name ?? "—"}</div>
          {o.supplier?.address && <div className="text-slate-600">{o.supplier.address}</div>}
          {o.supplier?.phone && <div className="text-slate-600">{o.supplier.phone}</div>}
        </div>
        <div className="text-right">
          <div className="text-faint">Fabric</div>
          <div className="font-semibold">{o.fabric}{o.gsm ? ` · ${o.gsm} gsm` : ""}</div>
          {o.expectedDate && <div className="text-slate-600">Expected: {fmtDate(o.expectedDate)}</div>}
        </div>
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
            {hasRate && <td className="px-2 py-1.5 text-right tnum">{inr(grand)}</td>}
          </tr>
        </tbody>
      </table>

      {o.remarks && <p className="mt-4 text-[11px] text-slate-600">Remarks: {o.remarks}</p>}
      <div className="mt-10 flex justify-between text-[11px]">
        <div className="w-48 border-t border-ink pt-1 text-center">Authorised — Sport Sun</div>
        <div className="w-48 border-t border-ink pt-1 text-center">Supplier acknowledgement</div>
      </div>
    </div>
  );
}
