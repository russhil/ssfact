import Link from "next/link";
import { notFound } from "next/navigation";
import { getTrimOrder } from "@/lib/masters";
import { getCurrentUser } from "@/lib/auth";
import { num, inr, fmtDate } from "@/lib/format";
import { POActions } from "@/components/po-actions";

export const dynamic = "force-dynamic";

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
  const grand = hasRate ? o.totalQty * (o.rate as number) : null;
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
    <div className="mx-auto max-w-[800px] bg-white p-8 text-[12px] text-ink">
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; } } @page { margin: 14mm; }`}</style>

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
          <h1 className="text-[20px] font-extrabold tracking-tight">Sport Sun</h1>
          <p className="mt-0.5 text-[13px] font-bold tracking-wide">PURCHASE ORDER (TRIMS)</p>
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

      <div className="mt-3 grid grid-cols-2 gap-4 text-[12px]">
        <div>
          <div className="text-faint">To</div>
          <div className="font-semibold">{o.supplier?.name ?? "—"}</div>
          {o.supplier?.address && <div className="text-slate-600">{o.supplier.address}</div>}
          {o.supplier?.phone && <div className="text-slate-600">{o.supplier.phone}</div>}
        </div>
        <div className="text-right">
          <div className="text-faint">Trim</div>
          <div className="font-semibold">{o.trim}</div>
          {o.expectedDate && <div className="text-slate-600">Expected: {fmtDate(o.expectedDate)}</div>}
        </div>
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
