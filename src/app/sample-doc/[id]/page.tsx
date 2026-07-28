import { notFound } from "next/navigation";
import { getSampleDoc } from "@/lib/samples";
import { getCurrentUser, canSeeCost } from "@/lib/auth";
import { num, inr, fmtDate } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { BrandLetterhead } from "@/components/brand";
import { docTitle } from "@/components/po-doc";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const doc = await getSampleDoc(Number(id));
  return { title: docTitle(doc ? `Tech pack ${doc.sample.code}` : null, "Tech pack") };
}

/**
 * Change 36 Part 7 Part D — the tech pack, in the house print format.
 *
 * The measurement grid is the reason SampleMeasurement exists: a size × point-of-measure
 * table has no home anywhere else in the schema, and without it there is nothing to send
 * a vendor beyond a photo.
 */
export default async function SampleDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getCurrentUser();
  if (!u || (u.role !== "ADMIN" && u.role !== "STAFF")) notFound();

  const doc = await getSampleDoc(Number(id));
  if (!doc) notFound();
  const { sample, bom, sizes, poms, grid } = doc;
  const owner = canSeeCost(u);

  return (
    <div className="doc-light mx-auto max-w-[820px] bg-white p-8 text-black">
      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>

      <div className="mb-5 flex items-start justify-between">
        <div>
          <BrandLetterhead />
          <h1 className="mt-1.5 text-[13px] font-bold tracking-wide">TECH PACK</h1>
          <p className="mt-0.5 text-[12px] text-muted">{sample.name}</p>
        </div>
        <div className="text-right">
          <div className="text-[18px] font-bold">{sample.code}</div>
          <div className="text-[11px] text-muted">round {sample.round} · {fmtDate(new Date())}</div>
        </div>
      </div>

      <table className="mb-5 w-full text-[12px]">
        <tbody>
          <tr>
            <td className="py-1 font-semibold">Sample</td><td className="py-1">{sample.name}</td>
            <td className="py-1 font-semibold">Status</td><td className="py-1">{sample.status.toLowerCase().replace("_", " ")}</td>
          </tr>
          <tr>
            <td className="py-1 font-semibold">Product</td><td className="py-1">{sample.product?.name || sample.product?.skuCode || "—"}</td>
            <td className="py-1 font-semibold">Fabric</td><td className="py-1">{sample.product?.fabric?.name ?? "—"}</td>
          </tr>
          <tr>
            <td className="py-1 font-semibold">Vendor</td><td className="py-1">{sample.vendor?.name ?? "—"}</td>
            <td className="py-1 font-semibold">Raised</td><td className="py-1">{fmtDate(sample.createdAt)}</td>
          </tr>
        </tbody>
      </table>

      <h3 className="mb-1 text-[13px] font-bold">Measurements (cm)</h3>
      {poms.length === 0 ? (
        <p className="mb-5 text-[12px] italic">No measurements recorded.</p>
      ) : (
        <table className="mb-5 w-full border border-black/20 text-[12px]">
          <thead>
            <tr className="bg-black/5">
              <th className="border border-black/20 px-2 py-1 text-left">Point</th>
              {sizes.map((s) => <th key={s} className="border border-black/20 px-2 py-1">{s}</th>)}
            </tr>
          </thead>
          <tbody>
            {poms.map((p) => (
              <tr key={p}>
                <td className="border border-black/20 px-2 py-1 font-semibold">{p}</td>
                {sizes.map((s) => {
                  const cell = grid.get(`${p}|${s}`);
                  return (
                    <td key={s} className="border border-black/20 px-2 py-1 text-center tabular-nums">
                      {cell ? `${num(cell.valueCm, 1)}${cell.tolerance != null ? ` ±${num(cell.tolerance, 1)}` : ""}` : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="mb-1 text-[13px] font-bold">Trims</h3>
      {!bom || bom.lines.length === 0 ? (
        <p className="mb-5 text-[12px] italic">No BOM on the linked product.</p>
      ) : (
        <table className="mb-5 w-full border border-black/20 text-[12px]">
          <thead>
            <tr className="bg-black/5">
              <th className="border border-black/20 px-2 py-1 text-left">Trim</th>
              <th className="border border-black/20 px-2 py-1 text-left">Applies to</th>
              <th className="border border-black/20 px-2 py-1 text-right">Per piece</th>
            </tr>
          </thead>
          <tbody>
            {bom.lines.map((l) => (
              <tr key={l.id}>
                <td className="border border-black/20 px-2 py-1">{l.trimItem?.name ?? l.material}</td>
                <td className="border border-black/20 px-2 py-1">{l.dimension}</td>
                <td className="border border-black/20 px-2 py-1 text-right tabular-nums">{num(l.perPieceQty ?? l.qty, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {owner && sample.costLines.length > 0 && (
        <>
          <h3 className="mb-1 text-[13px] font-bold">Costing</h3>
          <table className="mb-5 w-full border border-black/20 text-[12px]">
            <tbody>
              {sample.costLines.map((l) => (
                <tr key={l.id}>
                  <td className="border border-black/20 px-2 py-1">{l.kind.toLowerCase()}</td>
                  <td className="border border-black/20 px-2 py-1">{l.description}</td>
                  <td className="border border-black/20 px-2 py-1 text-right tabular-nums">{inr(l.qty * l.rate)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="border border-black/20 px-2 py-1" colSpan={2}>Total</td>
                <td className="border border-black/20 px-2 py-1 text-right tabular-nums">{inr(sample.cost)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {sample.notes && (
        <>
          <h3 className="mb-1 text-[13px] font-bold">Notes</h3>
          <p className="whitespace-pre-line text-[12px]">{sample.notes}</p>
        </>
      )}
    </div>
  );
}
