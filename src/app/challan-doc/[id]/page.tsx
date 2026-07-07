import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getChallan } from "@/lib/masters";
import { getCurrentUser } from "@/lib/auth";
import { num, inr, fmtDate } from "@/lib/format";
import { ChallanDocActions } from "@/components/challan-doc-actions";

export const dynamic = "force-dynamic";

export default async function ChallanDoc({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getCurrentUser();
  if (!u || (u.role !== "ADMIN" && u.role !== "STAFF")) notFound();
  const c = await getChallan(Number(id));
  if (!c) notFound();

  const [fabrics, trims, colours] = c.status === "DRAFT"
    ? await Promise.all([
        db.fabric.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
        db.trimItem.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        db.colour.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } }),
      ])
    : [[], [], []];

  const isOut = c.direction === "OUTWARD";
  const docTitle = isOut ? "DELIVERY CHALLAN" : "INWARD CHALLAN";
  const hasRate = c.totalValue != null;
  const summary =
    `Sport Sun ${docTitle} ${c.challanNo ?? ""}\n${c.counterparty?.name ?? ""}\n` +
    c.lines.map((l) => `• ${l.name}${l.colour ? ` (${l.colour})` : ""}: ${num(l.qty)} ${l.unit}`).join("\n") +
    `\nTotal: ${num(c.totalQty)} pcs/units`;
  const subject = `${docTitle} ${c.challanNo ?? ""} — Sport Sun`;

  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-[12px] text-ink">
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; } } @page { margin: 14mm; }`}</style>

      <div className="mb-4 flex items-center justify-between">
        <Link href="/challans" className="no-print text-[12px] font-medium text-muted hover:text-ink">← Challans</Link>
      </div>

      <ChallanDocActions
        challanId={c.id}
        status={c.status}
        direction={c.direction}
        challanNo={c.challanNo}
        lines={c.lines.map((l) => ({ id: l.id, kind: l.kind, name: l.name, colour: l.colour, qty: l.qty, unit: l.unit }))}
        phone={c.counterparty?.phone ?? null}
        email={c.counterparty?.email ?? null}
        summary={summary}
        subject={subject}
        fabrics={fabrics}
        trims={trims}
        colours={colours}
      />

      {c.voided && <div className="no-print mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">This challan was voided — its stock movements have been reversed.</div>}

      <div className="flex items-start justify-between border-b-2 border-ink pb-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight">Sport Sun</h1>
          <p className="mt-0.5 text-[13px] font-bold tracking-wide">{docTitle}{c.voided ? " (VOID)" : ""}</p>
        </div>
        <div className="text-right">
          <div className="text-[16px] font-bold">{c.challanNo ?? `DRAFT #${c.id}`}</div>
          <div className="text-[11px] text-muted">{fmtDate(c.date)}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
        <div>
          <div className="text-faint">{isOut ? "To (Vendor)" : "From (Supplier)"}</div>
          <div className="font-semibold">{c.counterparty?.name ?? "—"}</div>
          {c.counterparty?.address && <div className="text-muted">{c.counterparty.address}</div>}
          {c.counterparty?.phone && <div className="text-muted">{c.counterparty.phone}</div>}
        </div>
        <div className="text-right">
          <div className="text-faint">Direction</div>
          <div className="font-semibold">{isOut ? "Outward — issued from master stock" : "Inward — received into master stock"}</div>
          {c.note && <div className="mt-1 text-muted">Note: {c.note}</div>}
        </div>
      </div>

      <table className="mt-5 w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-y border-ink text-left">
            <th className="px-2 py-1">#</th>
            <th className="px-2 py-1">Item</th>
            <th className="px-2 py-1">Colour</th>
            <th className="px-2 py-1 text-right">Qty</th>
            <th className="px-2 py-1">Unit</th>
            {hasRate && <th className="px-2 py-1 text-right">Rate</th>}
            {hasRate && <th className="px-2 py-1 text-right">Amount</th>}
          </tr>
        </thead>
        <tbody>
          {c.lines.map((l, i) => (
            <tr key={l.id} className="border-b border-slate-200">
              <td className="px-2 py-1">{i + 1}</td>
              <td className="px-2 py-1 font-medium">{l.name}</td>
              <td className="px-2 py-1">{l.colour ?? "—"}</td>
              <td className="px-2 py-1 text-right tnum">{num(l.qty)}</td>
              <td className="px-2 py-1">{l.unit}</td>
              {hasRate && <td className="px-2 py-1 text-right tnum">{l.rate != null ? inr(l.rate) : "—"}</td>}
              {hasRate && <td className="px-2 py-1 text-right tnum">{l.rate != null ? inr(Math.round(l.qty * l.rate)) : "—"}</td>}
            </tr>
          ))}
          <tr className="border-t border-ink font-bold">
            <td className="px-2 py-1" colSpan={3}>Total</td>
            <td className="px-2 py-1 text-right tnum">{num(c.totalQty)}</td>
            <td className="px-2 py-1"></td>
            {hasRate && <td className="px-2 py-1"></td>}
            {hasRate && <td className="px-2 py-1 text-right tnum">{inr(Math.round(c.totalValue ?? 0))}</td>}
          </tr>
        </tbody>
      </table>

      <div className="mt-10 flex justify-between text-[11px]">
        <div className="w-40 border-t border-ink pt-1 text-center">Authorised — Sport Sun</div>
        <div className="w-40 border-t border-ink pt-1 text-center">{isOut ? "Vendor" : "Supplier"} acknowledgement</div>
      </div>
    </div>
  );
}
