import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductDetail } from "@/lib/catalog";
import { getCurrentUser } from "@/lib/auth";
import { num, fmtDate } from "@/lib/format";
import { waLink } from "@/lib/share";
import { PrintButton } from "@/components/print-button";
import { MessageCircle } from "lucide-react";
import { BrandLetterhead } from "@/components/brand";
import { docTitle } from "@/components/po-doc";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/** Change 25 Part K.1 — named after the product whose BOM this is. */
export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> {
  const { sku } = await params;
  const decoded = decodeURIComponent(sku);
  const p = await getProductDetail(decoded);
  return { title: docTitle(p ? `BOM ${p.skuCode ?? decoded}` : null, `BOM ${decoded}`) };
}

// Change 15 Part C/E: the product's master BOM in the shared "APPROVAL CHALLAN" print format.
export default async function BomDocPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  // Change 25 Part B: was getCurrentUser() with the result discarded — no gate at all.
  const u = await getCurrentUser();
  if (!u || (u.role !== "ADMIN" && u.role !== "STAFF")) notFound();
  const p = await getProductDetail(decodeURIComponent(sku));
  if (!p) notFound();

  const lines = p.boms.flatMap((b) => b.lines);
  const summary =
    `BILL OF MATERIALS — ${p.name} (#${p.styleNo ?? p.skuCode})\n` +
    lines.map((l) => `${(l.trim?.name ?? l.material)} · ${(l.dimension ?? "FLAT").toLowerCase()}${l.color ? " · " + l.color : ""} · ${l.perPieceQty != null ? num(l.perPieceQty, 3) : "—"}/pc`).join("\n");

  return (
    <div className="doc-light mx-auto max-w-[800px] bg-white p-8 text-[12px] text-ink">
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; } } @page { margin: 14mm; }`}</style>

      <div className="mb-4 flex items-center justify-between">
        <Link href={`/catalog/${p.extId}`} className="no-print text-[12px] font-medium text-muted hover:text-ink">← Back to product</Link>
        <div className="no-print flex items-center gap-2">
          <a href={waLink(null, summary)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-50">
            <MessageCircle size={14} /> WhatsApp
          </a>
          <PrintButton />
        </div>
      </div>

      <div className="flex items-start justify-between border-b-2 border-ink pb-3">
        <div>
          <BrandLetterhead />
          <h1 className="mt-1.5 text-[13px] font-bold tracking-wide">BILL OF MATERIALS</h1>
          <p className="mt-0.5 text-[12px] text-muted">{p.name} · {p.fabricName ?? "—"}</p>
        </div>
        <div className="text-right">
          <div className="text-[18px] font-bold">#{p.styleNo ?? p.skuCode}</div>
          <div className="text-[11px] text-muted">{fmtDate(new Date())}</div>
        </div>
      </div>

      {p.colors.length > 0 && (
        <p className="mt-3 text-[11px] text-muted">Colours: <span className="font-semibold text-ink">{p.colors.map((c) => c.name).join(", ")}</span></p>
      )}

      <h2 className="mt-5 mb-1.5 text-[12px] font-bold uppercase tracking-wide">Trims</h2>
      <table className="w-full border border-ink text-[12px]">
        <thead>
          <tr className="border-b border-ink text-left font-bold">
            <th className="border-r border-ink px-2 py-1.5">Particular</th>
            <th className="border-r border-ink px-2 py-1.5">Applies to</th>
            <th className="border-r border-ink px-2 py-1.5">Colour</th>
            <th className="px-2 py-1.5 text-right">Per pc</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b border-ink/30">
              <td className="border-r border-ink px-2 py-1.5 font-semibold">{l.trim?.name ?? l.material}</td>
              <td className="border-r border-ink/30 px-2 py-1.5 capitalize">{(l.dimension ?? "FLAT").toLowerCase()}</td>
              <td className="border-r border-ink/30 px-2 py-1.5">{l.color ?? "—"}</td>
              <td className="px-2 py-1.5 text-right tnum">{l.perPieceQty != null ? num(l.perPieceQty, 3) : "—"}</td>
            </tr>
          ))}
          {lines.length === 0 && <tr><td colSpan={4} className="px-2 py-4 text-center text-muted">No BOM lines</td></tr>}
        </tbody>
      </table>

      {/* Change 39 G4 — firm name as authoriser (never the login user) + a real "Prepared by". */}
      <div className="mt-10 flex items-end justify-between text-[11px]">
        <div className="text-slate-600">
          {u?.displayName && (
            <>Prepared by {u.displayName} · {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</>
          )}
        </div>
        <div className="w-44 border-t border-ink pt-1 text-center">
          <div className="font-semibold">Sport Sun</div>
          <div className="text-slate-600">Authorised signatory</div>
        </div>
      </div>
    </div>
  );
}
