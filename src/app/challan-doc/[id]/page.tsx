import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getChallan, getFirmContactNames } from "@/lib/masters";
import { getCurrentUser } from "@/lib/auth";
import { num, inr, fmtDate } from "@/lib/format";
import { ChallanDocActions } from "@/components/challan-doc-actions";
import { PurchaseReturnButton } from "@/components/purchase-return";
import { ImageUploader } from "@/components/image-uploader";
import { BrandLetterhead } from "@/components/brand";
import { docTitle, DocAttachments } from "@/components/po-doc";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/** Change 25 Part K.1 — the exported PDF is named after the challan, not the app. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const c = await getChallan(Number(id));
  return { title: docTitle(c?.challanNo ?? null, `Challan #${id}`) };
}

export default async function ChallanDoc({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getCurrentUser();
  if (!u || (u.role !== "ADMIN" && u.role !== "STAFF")) notFound();
  const c = await getChallan(Number(id));
  if (!c) notFound();

  // Draft AND locked (non-void) challans can be edited, so load the pick-lists for both.
  const editable = !c.voided;
  const [fabrics, trims, colours, rawLines] = editable
    ? await Promise.all([
        db.fabric.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
        db.trimItem.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        db.colour.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } }),
        db.materialChallanLine.findMany({
          where: { challanId: c.id },
          orderBy: { id: "asc" },
          select: { fabricId: true, trimItemId: true, colour: true, qty: true, unit: true, rate: true, note: true },
        }),
      ])
    : [[], [], [], []];

  // Change 39 G1 — firm contact names for the authorised-signatory picker.
  const signatories = editable ? await getFirmContactNames() : [];
  const isOut = c.direction === "OUTWARD";
  // Change 25 Part D: a return is outward, but it is a debit note to a supplier, not a
  // delivery challan to a vendor — it must not print as one.
  const isReturn = !!c.returnOf;
  const heading = isReturn ? "PURCHASE RETURN" : isOut ? "DELIVERY CHALLAN" : "INWARD CHALLAN";
  const hasRate = c.totalValue != null;
  const summary =
    `Sport Sun ${heading} ${c.challanNo ?? ""}\n${c.counterparty?.name ?? ""}\n` +
    c.lines.map((l) => `• ${l.name}${l.colour ? ` (${l.colour})` : ""}: ${num(l.qty)} ${l.unit}`).join("\n") +
    `\nTotal: ${num(c.totalQty)} pcs/units`;
  const subject = `${heading} ${c.challanNo ?? ""} — Sport Sun`;

  return (
    <div className="doc-light mx-auto max-w-[800px] bg-white p-8 text-[12px] text-ink">
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; } } @page { margin: 14mm; }`}</style>

      <div className="mb-4 flex items-center justify-between">
        <Link href="/challans" className="no-print text-[12px] font-medium text-muted hover:text-ink">← Challans</Link>
      </div>

      <ChallanDocActions
        challanId={c.id}
        status={c.status}
        direction={c.direction}
        challanNo={c.challanNo}
        lines={c.lines.map((l) => ({ id: l.id, kind: l.kind, name: l.name, colour: l.colour, qty: l.qty, unit: l.unit, rate: l.rate }))}
        editLines={rawLines.map((l) => ({ fabricId: l.fabricId, trimItemId: l.trimItemId, colour: l.colour, qty: l.qty, unit: l.unit, rate: l.rate, note: l.note }))}
        phone={c.counterparty?.phone ?? null}
        email={c.counterparty?.email ?? null}
        summary={summary}
        subject={subject}
        fabrics={fabrics}
        trims={trims}
        colours={colours}
        signatories={signatories}
        signatoryName={c.signatoryName}
      />

      {c.voided && <div className="no-print mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">This challan was voided — its stock movements have been reversed.</div>}

      {/* Change 25 Part D — a locked, live inward receipt can be returned to the supplier.
          Separate from ChallanDocActions' Void, which is the "this receipt never happened"
          path; this one is a new outward document and leaves the PO received. */}
      {c.direction === "INWARD" && c.status === "LOCKED" && !c.voided && (
        <div className="no-print mb-3 flex flex-wrap items-center gap-2">
          <PurchaseReturnButton
            challanId={c.id}
            challanNo={c.challanNo}
            supplier={c.counterparty?.name ?? null}
            lines={c.lines.map((l) => ({ id: l.id, name: l.name, colour: l.colour, qty: l.qty, unit: l.unit }))}
          />
          {c.returns.map((r) => (
            <Link
              key={r.id}
              href={`/challan-doc/${r.id}`}
              className="text-[11px] font-semibold text-primary-ink hover:underline"
            >
              {r.challanNo ?? `draft return #${r.id}`}
              {r.status === "VOID" ? " (void)" : ""}
            </Link>
          ))}
        </div>
      )}

      {c.returnOf && (
        <div className="no-print mb-3 text-[12px] text-muted">
          Return against{" "}
          <Link href={`/challan-doc/${c.returnOf.id}`} className="font-semibold text-primary-ink hover:underline">
            {c.returnOf.challanNo ?? `challan #${c.returnOf.id}`}
          </Link>
          {c.returnReason && ` · ${c.returnReason}`}
        </div>
      )}

      <div className="flex items-start justify-between border-b-2 border-ink pb-3">
        <div>
          <BrandLetterhead />
          <h1 className="mt-1.5 text-[13px] font-bold tracking-wide">{heading}{c.voided ? " (VOID)" : ""}</h1>
          <p className="mt-0.5 text-[11px] text-muted">
            {c.kind ?? "—"}
            {c.jobCardSiNo && <> · Job <Link href={`/job-cards/${c.jobCardId}`} className="no-print text-primary-ink hover:underline">{c.jobCardSiNo}</Link><span className="hidden print:inline">{c.jobCardSiNo}</span></>}
            {/* Change 18 Part C: which purchase order this receipt belongs to. */}
            {c.poRef && (
              <>
                {" "}· For{" "}
                <Link href={c.poRef.kind === "FABRIC" ? `/po/${c.poRef.id}` : `/pot/${c.poRef.id}`} className="no-print font-semibold text-primary-ink hover:underline">
                  {c.poRef.poNumber ?? `order #${c.poRef.id}`}
                </Link>
                <span className="hidden print:inline">{c.poRef.poNumber ?? `order #${c.poRef.id}`}</span>
              </>
            )}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[16px] font-bold">{c.challanNo ?? `DRAFT #${c.id}`}</div>
          <div className="text-[11px] text-muted">{fmtDate(c.date)}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
        <div>
          <div className="text-faint">
            {isOut ? "To" : "From"} ({c.counterpartyKind === "VENDOR" ? "Vendor" : "Supplier"})
          </div>
          <div className="font-semibold">{c.counterparty?.name ?? "—"}</div>
          {c.counterparty?.address && <div className="text-muted">{c.counterparty.address}</div>}
          {c.counterparty?.phone && <div className="text-muted">{c.counterparty.phone}</div>}
        </div>
        <div className="text-right">
          <div className="text-faint">Direction</div>
          <div className="font-semibold">
            {isReturn
              ? "Outward — returned to supplier from master stock"
              : isOut
                ? "Outward — issued from master stock"
                : "Inward — received into master stock"}
          </div>
          {c.note && <div className="mt-1 text-muted">Note: {c.note}</div>}
        </div>
      </div>

      {/* Change 39 Part D1 — fabric and trims shown & subtotalled as separate sections;
          Part D2 — cut-goods lines render as a colour × size grid, not in the flat list. */}
      {(() => {
        const cutLines = c.lines.filter((l) => l.isCut);
        const fabricLines = c.lines.filter((l) => l.kind === "fabric" && !l.isCut);
        const trimLines = c.lines.filter((l) => l.kind === "trim" && !l.isCut);
        return (
          <div className="mt-5 space-y-4">
            <LineSection title="Fabric" lines={fabricLines} hasRate={hasRate} />
            <LineSection title="Trims / Accessories" lines={trimLines} hasRate={hasRate} />
            {cutLines.length > 0 && <CutGoodsGrid lines={cutLines} />}
            <div className="flex justify-end border-t border-ink pt-1.5 text-[12px] font-bold">
              <span className="mr-4">Grand total</span>
              <span className="tnum">{num(c.totalQty)}{hasRate ? ` · ${inr(Math.round(c.totalValue ?? 0))}` : ""}</span>
            </div>
          </div>
        );
      })()}

      <div className="mt-10 flex justify-between text-[11px]">
        {/* Change 39 G1 — the named authorised signatory (a firm contact); firm name when
            unset. Never the login user. */}
        <div className="w-44 border-t border-ink pt-1 text-center">
          <div className="font-semibold">{c.signatoryName ?? "Sport Sun"}</div>
          <div className="text-slate-600">Authorised signatory</div>
        </div>
        {/* Follows the counterparty, not the direction: a Change 25 return is outward
            but goes back to a supplier, so "Vendor acknowledgement" would be wrong. */}
        <div className="w-40 border-t border-ink pt-1 text-center">{c.counterpartyKind === "VENDOR" ? "Vendor" : "Supplier"} acknowledgement</div>
      </div>

      {/* Change 39 G2 — who prepared the document (display only; omitted when unknown). */}
      {c.preparedBy && (
        <div className="mt-4 text-[11px] text-slate-600">Prepared by {c.preparedBy.name}{c.preparedBy.at ? ` · ${fmtDate(c.preparedBy.at)}` : ""}</div>
      )}

      {/* Change 25 Part H.3 — the boxman photographs the paper challan / the bundle
          against this receipt, which is the photographic backup for the posting.
          Change 25 Part K.3 — those photos print as following pages of the PDF. */}
      {c.direction === "INWARD" && (
        <div className="no-print mt-6 border-t border-slate-200 pt-4">
          <ImageUploader
            entity="challan"
            entityId={c.id}
            kind="challan"
            multiple
            images={c.images}
            label="Proof photos"
          />
        </div>
      )}
      <DocAttachments images={c.images} label="Proof photo" showThumbnails={false} />
    </div>
  );
}

type ChallanLineView = Awaited<ReturnType<typeof getChallan>> extends infer T
  ? T extends { lines: (infer L)[] } ? L : never
  : never;

/** Change 39 Part D1 — one material section (Fabric or Trims) with its own subtotal. */
function LineSection({ title, lines, hasRate }: { title: string; lines: ChallanLineView[]; hasRate: boolean }) {
  if (lines.length === 0) return null;
  const subQty = lines.reduce((a, l) => a + l.qty, 0);
  const subVal = lines.reduce((a, l) => a + l.qty * (l.rate ?? 0), 0);
  return (
    <div>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">{title}</div>
      <table className="w-full border-collapse text-[11px]">
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
          {lines.map((l, i) => (
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
          <tr className="border-t border-ink font-semibold">
            <td className="px-2 py-1" colSpan={3}>{title} subtotal</td>
            <td className="px-2 py-1 text-right tnum">{num(subQty)}</td>
            <td className="px-2 py-1"></td>
            {hasRate && <td className="px-2 py-1"></td>}
            {hasRate && <td className="px-2 py-1 text-right tnum">{subVal > 0 ? inr(Math.round(subVal)) : "—"}</td>}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Change 39 Part D2 — cut goods issued from a layer, as a colour × size grid of pieces. */
function CutGoodsGrid({ lines }: { lines: ChallanLineView[] }) {
  const colours = [...new Set(lines.map((l) => l.colour || "—"))];
  const sizes = [...new Set(lines.map((l) => l.size || "—"))];
  const at = (colour: string, size: string) =>
    lines.filter((l) => (l.colour || "—") === colour && (l.size || "—") === size).reduce((a, l) => a + l.qty, 0);
  const total = lines.reduce((a, l) => a + l.qty, 0);
  return (
    <div>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Cut goods (pieces)</div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center text-[11px]">
          <thead>
            <tr className="border-y border-ink">
              <th className="px-2 py-1 text-left">Colour \ Size</th>
              {sizes.map((s) => <th key={s} className="px-2 py-1">{s}</th>)}
              <th className="px-2 py-1">Total</th>
            </tr>
          </thead>
          <tbody>
            {colours.map((c) => (
              <tr key={c} className="border-b border-slate-200">
                <td className="px-2 py-1 text-left font-medium">{c}</td>
                {sizes.map((s) => <td key={s} className="px-2 py-1 tnum">{at(c, s) || ""}</td>)}
                <td className="px-2 py-1 font-semibold tnum">{num(sizes.reduce((a, s) => a + at(c, s), 0))}</td>
              </tr>
            ))}
            <tr className="border-t border-ink font-semibold">
              <td className="px-2 py-1 text-left">Total</td>
              {sizes.map((s) => <td key={s} className="px-2 py-1 tnum">{num(colours.reduce((a, c) => a + at(c, s), 0))}</td>)}
              <td className="px-2 py-1 tnum">{num(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
