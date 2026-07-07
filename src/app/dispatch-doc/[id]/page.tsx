import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { num, fmtDate } from "@/lib/format";
import { jobItem, jobStyle } from "@/lib/job-display";
import { waLink } from "@/lib/share";
import { PrintButton } from "@/components/print-button";
import { MessageCircle } from "lucide-react";

export const dynamic = "force-dynamic";

const SIZE_ORDER = ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
const sizeRank = (s: string) => { const i = SIZE_ORDER.indexOf(s.toUpperCase()); return i === -1 ? 99 : i; };

export default async function DispatchDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await getCurrentUser();
  const ev = await db.dispatchEvent.findUnique({
    where: { id: Number(id) },
    include: {
      lines: true,
      layers: { include: { vendor: true } },
      jobCard: { include: { product: true } },
    },
  });
  if (!ev) notFound();

  const isSale = ev.reason === "SALE";
  const vendor = ev.layers.find((l) => l.vendor)?.vendor?.name ?? null;
  const layerLabels = ev.layers.map((l) => l.label || `Layer ${l.layerNo}`);

  // build the colour × size matrix from the dispatch lines
  const sizes = [...new Set(ev.lines.map((l) => l.size))].sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b));
  const colours = isSale ? [""] : [...new Set(ev.lines.map((l) => l.colour ?? ""))].sort((a, b) => a.localeCompare(b));
  const cell = (colour: string, size: string) =>
    ev.lines.filter((l) => (l.colour ?? "") === colour && l.size === size).reduce((a, l) => a + l.qty, 0);
  const colTotal = (size: string) => ev.lines.filter((l) => l.size === size).reduce((a, l) => a + l.qty, 0);

  const title = isSale ? "SALE CHALLAN" : "DISPATCH CHALLAN";
  const summary =
    `${title} — ${jobItem(ev.jobCard)} (${jobStyle(ev.jobCard)})\n` +
    `SI ${ev.jobCard.siNo}${vendor ? ` · ${vendor}` : ""} · ${fmtDate(ev.date)}\n` +
    ev.lines.map((l) => `${l.colour ? l.colour + " " : ""}${l.size}: ${num(l.qty)}`).join("\n") +
    `\nTotal: ${num(ev.qty)} pcs`;

  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-[12px] text-ink">
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; } } @page { margin: 14mm; }`}</style>

      <div className="mb-4 flex items-center justify-between">
        <Link href={`/job-cards/${ev.jobCardId}`} className="no-print text-[12px] font-medium text-muted hover:text-ink">← Back to card</Link>
        <div className="no-print flex items-center gap-2">
          <a
            href={waLink(null, summary)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            <MessageCircle size={14} /> WhatsApp
          </a>
          <PrintButton />
        </div>
      </div>

      <div className="flex items-start justify-between border-b-2 border-ink pb-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight">SPORTSUN — {title}</h1>
          <p className="mt-0.5 text-[12px] text-muted">{jobItem(ev.jobCard)} · {jobStyle(ev.jobCard)}{vendor ? ` · ${vendor}` : ""}</p>
        </div>
        <div className="text-right">
          <div className="text-[18px] font-bold">{ev.jobCard.siNo}</div>
          <div className="text-[11px] text-muted">{fmtDate(ev.date)}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-3 text-[11px]">
        {[
          ["Challan", ev.challan ?? `DSP-${ev.id}`],
          ["Vendor / In-house", vendor ?? "—"],
          ["Layers", layerLabels.length ? layerLabels.join(", ") : "—"],
          ["Total pcs", `${num(ev.qty)}`],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="text-faint">{k}</div>
            <div className="font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <h2 className="mt-5 mb-1.5 text-[12px] font-bold uppercase tracking-wide">{isSale ? "Size (defective / sale)" : "Colour × Size"}</h2>
      <table className="w-full border border-ink text-center text-[12px]">
        <thead>
          <tr className="border-b border-ink font-bold">
            {!isSale && <th className="border-r border-ink px-2 py-1.5 text-left">Colour</th>}
            {sizes.map((s) => <th key={s} className="border-r border-ink px-2 py-1.5">{s}</th>)}
            <th className="px-2 py-1.5">Total</th>
          </tr>
        </thead>
        <tbody>
          {colours.map((c) => (
            <tr key={c || "—"} className="border-b border-ink/30">
              {!isSale && <td className="border-r border-ink px-2 py-1.5 text-left font-semibold">{c || "—"}</td>}
              {sizes.map((s) => <td key={s} className="border-r border-ink/30 px-2 py-1.5 tnum">{cell(c, s) || ""}</td>)}
              <td className="px-2 py-1.5 font-bold tnum">{num(sizes.reduce((a, s) => a + cell(c, s), 0))}</td>
            </tr>
          ))}
          <tr className="border-t border-ink font-bold">
            {!isSale && <td className="border-r border-ink px-2 py-1.5 text-left">Total</td>}
            {sizes.map((s) => <td key={s} className="border-r border-ink/30 px-2 py-1.5 tnum">{num(colTotal(s))}</td>)}
            <td className="px-2 py-1.5 tnum">{num(ev.qty)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-10 grid grid-cols-3 gap-6 text-center text-[11px]">
        {["Dispatched by", "Checked by", "Received by"].map((s) => (
          <div key={s} className="border-t border-ink pt-1">{s}</div>
        ))}
      </div>
    </div>
  );
}
