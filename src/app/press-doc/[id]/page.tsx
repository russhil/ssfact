import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { num, fmtDate } from "@/lib/format";
import { sizeRank } from "@/lib/job-labels";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

/**
 * Change 40 Part K10 — the press document. OUT prints the frozen size×colour grid (from
 * PressChallanLine, so a reprint is identical after a layer is edited); IN prints a reference to
 * its outward plus the same-shape EMPTY grid for the pressing staff to fill by hand. `?blank`
 * forces the empty grid with taller rows. Reuses the shared print fixes (Part A, globals.css).
 */
export default async function PressDocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ blank?: string }> }) {
  const { id } = await params;
  const { blank } = await searchParams;
  const c = await db.pressChallan.findUnique({
    where: { id: Number(id) },
    include: {
      jobCard: { select: { siNo: true, id: true, product: { select: { name: true } }, customItem: true } },
      vendor: { select: { name: true } },
      lines: true,
      pressOut: { select: { docNo: true, qty: true, lines: true } },
    },
  });
  if (!c) notFound();

  const isBlank = blank != null || c.direction === "IN";
  // For an IN doc the reference grid shape comes from its outward's frozen lines.
  const gridLines = c.direction === "OUT" ? c.lines : c.pressOut?.lines ?? [];
  const sizes = [...new Set(gridLines.map((l) => l.size))].sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b));
  const colours = [...new Set(gridLines.map((l) => l.colour))].sort((a, b) => a.localeCompare(b));
  const cell = (colour: string, size: string) => gridLines.filter((l) => l.colour === colour && l.size === size).reduce((a, l) => a + l.qty, 0);
  const rowH = isBlank ? "h-9" : "";

  const item = c.jobCard.product?.name ?? c.jobCard.customItem ?? "—";

  return (
    <div className="doc-light doc-print-frame mx-auto max-w-[800px] bg-white p-8 text-[12px] text-ink">
      <style>{`@media print { .no-print { display:none !important; } body { background:#fff; } @page { margin: 0; } .doc-print-frame { padding: 14mm !important; } }`}</style>

      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/job-cards/${c.jobCard.id}`} className="t-sm font-medium text-muted hover:text-ink">← Back to card</Link>
        <div className="flex items-center gap-2">
          {c.direction === "OUT" && <Link href={`/press-doc/${c.id}?blank=1`} className="rounded-lg border border-border px-3 py-1.5 t-sm font-semibold text-t1 hover:bg-surface-2">Blank sheet</Link>}
          <PrintButton />
        </div>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[18px] font-bold">PRESS {c.direction === "OUT" ? "OUTWARD" : "RETURN"}</h1>
          <div className="text-slate-600">{c.docNo}</div>
        </div>
        <div className="text-right text-[12px]">
          <div className="font-semibold">SI {c.jobCard.siNo}</div>
          <div className="text-slate-600">{fmtDate(c.date)}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-4">
        <div><div className="text-faint">Product</div><div className="font-semibold">{item}</div></div>
        <div><div className="text-faint">Vendor (stitcher)</div><div className="font-semibold">{c.vendor?.name ?? "—"}</div></div>
        <div><div className="text-faint">Quantity</div><div className="font-semibold tnum">{num(c.qty)} pcs</div></div>
        {c.direction === "IN" && c.pressOut && <div><div className="text-faint">Answers</div><div className="font-semibold">{c.pressOut.docNo} (sent {num(c.pressOut.qty)})</div></div>}
      </div>

      <h2 className="mt-5 mb-1.5 text-[12px] font-bold uppercase tracking-wide">Colour × Size{isBlank ? " (fill by hand)" : ""}</h2>
      {sizes.length === 0 ? (
        <p className="text-slate-500">No grid.</p>
      ) : (
        <table className="w-full border border-ink text-center text-[12px]">
          <thead>
            <tr className="border-b border-ink font-bold">
              <th className="border-r border-ink px-2 py-1.5 text-left">Colour</th>
              {sizes.map((s) => <th key={s} className="border-r border-ink px-2 py-1.5">{s}</th>)}
              <th className="px-2 py-1.5">Total</th>
            </tr>
          </thead>
          <tbody>
            {colours.map((c2) => (
              <tr key={c2 || "—"} className={`border-b border-ink/30 ${rowH}`}>
                <td className="border-r border-ink px-2 py-1.5 text-left font-semibold">{c2 || "—"}</td>
                {sizes.map((s) => <td key={s} className="border-r border-ink/30 px-2 py-1.5 tnum">{isBlank ? "" : cell(c2, s) || ""}</td>)}
                <td className="px-2 py-1.5 font-bold tnum">{isBlank ? "" : num(sizes.reduce((a, s) => a + cell(c2, s), 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-10 grid grid-cols-3 gap-6 text-center text-[11px]">
        {["Sent by", "Pressed by", "Received by"].map((s) => <div key={s} className="border-t border-ink pt-1">{s}</div>)}
      </div>
    </div>
  );
}
