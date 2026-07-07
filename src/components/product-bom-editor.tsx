"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upsertBomLine, removeBomLine } from "@/lib/actions";
import { Card, Badge } from "@/components/ui";
import { num } from "@/lib/format";
import { Plus, X, Printer } from "lucide-react";

type Dim = "FLAT" | "COLOR" | "SIZE";
type Line = { id: number; material: string; color: string | null; dimension: string; perPieceQty: number | null; trimItemId: number | null; trim: { name: string; current: number } | null };
type TrimOpt = { id: number; name: string; current: number };

const inp = "rounded-md border border-border px-2 py-1.5 text-[12px] outline-none focus:border-primary";

/**
 * Change 15 Part C — author the product's master BOM (trim recipe) on the product.
 * New job cards inherit it (presetRows); each card keeps its own editable JobBomLine copy.
 * Reuses the existing upsertBomLine / removeBomLine actions.
 */
export function ProductBomEditor({ productId, extId, lines, trims }: { productId: number; extId: string; lines: Line[]; trims: TrimOpt[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [nMaterial, setNMaterial] = useState("");
  const [nTrimId, setNTrimId] = useState<string>("");
  const [nDim, setNDim] = useState<Dim>("FLAT");
  const [nColor, setNColor] = useState("");
  const [nQty, setNQty] = useState("");

  async function addLine() {
    const trimId = nTrimId ? +nTrimId : null;
    const material = nMaterial.trim() || (trimId ? trims.find((t) => t.id === trimId)?.name ?? "" : "");
    if (!material) return;
    setBusy(true);
    try {
      await upsertBomLine({ productId, trimItemId: trimId, material, color: nColor.trim() || null, dimension: nDim, perPieceQty: +nQty || 0 });
      setNMaterial(""); setNTrimId(""); setNColor(""); setNQty(""); setNDim("FLAT");
      router.refresh();
    } catch (e) { alert("Could not add: " + (e as Error).message); } finally { setBusy(false); }
  }
  async function del(id: number) {
    setBusy(true);
    try { await removeBomLine({ id }); router.refresh(); } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Card className="mt-3.5 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-bold">Master BOM <span className="font-medium text-faint">· authored on the product · inherited by new job cards</span></h3>
        <Link href={`/bom-doc/${extId}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-primary-ink hover:bg-slate-50"><Printer size={13} /> Print BOM</Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-faint">
              <th className="px-2 py-2 font-semibold">Particular</th>
              <th className="px-2 py-2 font-semibold">Applies to</th>
              <th className="px-2 py-2 font-semibold">Colour</th>
              <th className="px-2 py-2 text-right font-semibold">Per pc</th>
              <th className="px-2 py-2 text-right font-semibold">In store</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-50 last:border-0">
                <td className="px-2 py-1.5 font-semibold text-slate-700">{l.material}{l.trim && <Badge tone="ok" className="ml-1.5">linked</Badge>}</td>
                <td className="px-2 py-1.5 capitalize text-slate-500">{(l.dimension ?? "FLAT").toLowerCase()}</td>
                <td className="px-2 py-1.5 text-slate-500">{l.color || "—"}</td>
                <td className="px-2 py-1.5 text-right tnum">{l.perPieceQty != null ? num(l.perPieceQty, 3) : "—"}</td>
                <td className="px-2 py-1.5 text-right tnum text-slate-500">{l.trim ? num(l.trim.current) : "—"}</td>
                <td className="px-2 py-1.5 text-right"><button onClick={() => del(l.id)} disabled={busy} className="text-faint hover:text-danger"><X size={13} /></button></td>
              </tr>
            ))}
            {lines.length === 0 && <tr><td colSpan={6} className="px-2 py-4 text-center text-[12px] text-muted">No BOM lines yet — add the product&apos;s trims below.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* add row */}
      <div className="mt-3 flex flex-wrap items-end gap-1.5 border-t border-dashed border-border pt-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-faint">Trim (master)</span>
          <select value={nTrimId} onChange={(e) => { setNTrimId(e.target.value); const t = trims.find((x) => String(x.id) === e.target.value); if (t) setNMaterial(t.name); }} className={`${inp} w-40`}>
            <option value="">— free text —</option>
            {trims.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-faint">Or material</span>
          <input value={nMaterial} onChange={(e) => setNMaterial(e.target.value)} placeholder="e.g. Drawcord" className={`${inp} w-36`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-faint">Applies to</span>
          <select value={nDim} onChange={(e) => setNDim(e.target.value as Dim)} className={inp}>
            <option value="FLAT">Flat</option><option value="COLOR">Colour</option><option value="SIZE">Size</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-faint">Colour</span>
          <input value={nColor} onChange={(e) => setNColor(e.target.value)} placeholder="—" className={`${inp} w-24`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-faint">Per pc</span>
          <input type="number" step="0.001" value={nQty} onChange={(e) => setNQty(e.target.value)} placeholder="0" className={`${inp} w-20 text-right tnum`} />
        </label>
        <button onClick={addLine} disabled={busy || (!nMaterial.trim() && !nTrimId)} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-40"><Plus size={13} /> Add</button>
      </div>
    </Card>
  );
}
