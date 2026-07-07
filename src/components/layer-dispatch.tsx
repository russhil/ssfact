"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDispatch } from "@/lib/actions";
import { num } from "@/lib/format";
import { cn } from "@/lib/cn";

const inp = "rounded-md border border-border px-2 py-1.5 text-[12px] outline-none focus:border-primary";
const DEFAULT_SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];
const sizeRank = (s: string) => { const i = DEFAULT_SIZES.indexOf(s.toUpperCase()); return i === -1 ? 99 : i; };

export type DispatchLayer = {
  id: number;
  layerNo: number;
  label: string | null;
  vendor: string | null;
  cells: { colour: string; size: string; qty: number }[];
};
export type PriorDispatch = { id: number; qty: number; layerIds: number[] };

/**
 * Change 14 Part B — dispatch finished garments against one or more cutting layers of the
 * SAME vendor, in a size×colour grid derived from what those layers cut. Sale = colour-less.
 * Legacy cards with no layers fall back to a single-qty dispatch.
 */
export function LayerDispatch({
  jobCardId,
  layers,
  prior = [],
  defaultArrangedBy,
}: {
  jobCardId: number;
  layers: DispatchLayer[];
  prior?: PriorDispatch[];
  defaultArrangedBy: string;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [sale, setSale] = useState(false);
  const [grid, setGrid] = useState<Record<string, string>>({}); // key `colour|||size` -> qty
  const [saleGrid, setSaleGrid] = useState<Record<string, string>>({}); // size -> qty
  const [date, setDate] = useState("");
  const [challan, setChallan] = useState("");
  const [busy, setBusy] = useState(false);

  // legacy fallback (no layers) — simple total qty + reason
  const [legacyQty, setLegacyQty] = useState("");
  const [legacyReason, setLegacyReason] = useState<"ORDER" | "SALE">("ORDER");

  const key = (c: string, s: string) => `${c}|||${s}`;
  const lockedVendor = useMemo(() => {
    const first = [...sel][0];
    return first != null ? layers.find((l) => l.id === first)?.vendor ?? null : null;
  }, [sel, layers]);

  const selectedLayers = layers.filter((l) => sel.has(l.id));

  // union of colours/sizes cut in the selected layers, and pooled cut per cell
  const { colours, sizes, cutCell, poolCut } = useMemo(() => {
    const cutMap = new Map<string, number>();
    const colSet = new Set<string>();
    const sizeSet = new Set<string>();
    let pool = 0;
    for (const l of selectedLayers)
      for (const c of l.cells) {
        if (c.qty <= 0) continue;
        colSet.add(c.colour); sizeSet.add(c.size); pool += c.qty;
        cutMap.set(key(c.colour, c.size), (cutMap.get(key(c.colour, c.size)) ?? 0) + c.qty);
      }
    return {
      colours: [...colSet].sort((a, b) => a.localeCompare(b)),
      sizes: [...sizeSet].sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b)),
      cutCell: (c: string, s: string) => cutMap.get(key(c, s)) ?? 0,
      poolCut: pool,
    };
  }, [selectedLayers]);

  const saleSizes = sizes.length ? sizes : DEFAULT_SIZES;

  const priorDispatched = useMemo(
    () => prior.filter((e) => e.layerIds.some((id) => sel.has(id))).reduce((a, e) => a + e.qty, 0),
    [prior, sel]
  );
  const enteringNow = useMemo(() => {
    if (sale) return Object.values(saleGrid).reduce((a, v) => a + (+v || 0), 0);
    return Object.values(grid).reduce((a, v) => a + (+v || 0), 0);
  }, [grid, saleGrid, sale]);
  const balance = poolCut - priorDispatched - enteringNow;

  function toggleLayer(l: DispatchLayer) {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(l.id)) next.delete(l.id);
      else next.add(l.id);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    try {
      const lines = sale
        ? saleSizes
            .map((s) => ({ colour: null, size: s, qty: +saleGrid[s] || 0 }))
            .filter((l) => l.qty !== 0)
        : colours.flatMap((c) =>
            sizes
              .map((s) => ({ colour: c, size: s, qty: +grid[key(c, s)] || 0 }))
              .filter((l) => l.qty !== 0)
          );
      if (!lines.length) { setBusy(false); return; }
      await addDispatch({
        jobCardId,
        reason: sale ? "SALE" : "ORDER",
        date: date || undefined,
        challan: challan.trim() || undefined,
        arrangedBy: defaultArrangedBy || null,
        layerIds: [...sel],
        lines,
      });
      setGrid({}); setSaleGrid({}); setChallan(""); setSel(new Set()); setSale(false);
      router.refresh();
    } catch (e) {
      alert("Could not dispatch: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ── legacy card: no cutting layers → single-qty dispatch ─────────────────────
  if (layers.length === 0) {
    async function saveLegacy() {
      if (!legacyQty || +legacyQty === 0) return;
      setBusy(true);
      try {
        await addDispatch({ jobCardId, qty: +legacyQty, reason: legacyReason, date: date || undefined, challan: challan.trim() || undefined, arrangedBy: defaultArrangedBy || null });
        setLegacyQty(""); setChallan("");
        router.refresh();
      } catch (e) { alert("Could not dispatch: " + (e as Error).message); } finally { setBusy(false); }
    }
    return (
      <div className="mt-3 rounded-lg border border-dashed border-border p-2.5">
        <div className="mb-1.5 text-[11px] font-semibold text-slate-600">Log dispatch</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input type="number" value={legacyQty} onChange={(e) => setLegacyQty(e.target.value)} placeholder="qty" className={`${inp} w-24 text-right tnum`} />
          <div className="flex rounded-md border border-border p-0.5">
            {(["ORDER", "SALE"] as const).map((r) => (
              <button key={r} onClick={() => setLegacyReason(r)} className={cn("rounded px-2 py-1 text-[11px] font-semibold", legacyReason === r ? "bg-primary text-white" : "text-slate-500 hover:text-ink")}>{r}</button>
            ))}
          </div>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
          <input value={challan} onChange={(e) => setChallan(e.target.value)} placeholder="challan #" className={`${inp} w-28`} />
          <button onClick={saveLegacy} disabled={busy || !legacyQty} className="rounded-md bg-primary px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-40">Log</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-600">Log dispatch (vendor → warehouse)</span>
        <button onClick={() => { setSale((s) => !s); }} className={cn("rounded-md border px-2 py-1 text-[11px] font-semibold", sale ? "border-amber-300 bg-amber-100 text-amber-700" : "border-border bg-surface text-slate-500")}>
          {sale ? "Sale (defective)" : "Mark as Sale"}
        </button>
      </div>

      {/* layer multi-select — same vendor only */}
      <div className="mb-2.5 flex flex-wrap gap-1.5">
        {layers.map((l) => {
          const disabled = lockedVendor != null && l.vendor !== lockedVendor && !sel.has(l.id);
          return (
            <button
              key={l.id}
              disabled={disabled}
              onClick={() => toggleLayer(l)}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold",
                sel.has(l.id) ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-surface text-slate-600",
                disabled && "cursor-not-allowed opacity-40"
              )}
              title={l.vendor ? `Vendor: ${l.vendor}` : "No vendor set"}
            >
              {l.label || `Layer ${l.layerNo}`}
              <span className="ml-1 font-normal text-faint">· {l.vendor ?? "—"}</span>
            </button>
          );
        })}
      </div>

      {sel.size === 0 ? (
        <p className="py-2 text-center text-[11px] text-muted">Pick one or more layers (same vendor) to dispatch against.</p>
      ) : (
        <>
          {lockedVendor && <div className="mb-2 text-[11px] text-muted">Vendor: <span className="font-semibold text-ink">{lockedVendor}</span> · pool cut {num(poolCut)} · dispatched {num(priorDispatched)}</div>}

          {sale ? (
            <div className="overflow-x-auto">
              <table className="text-center text-[12px]">
                <thead><tr className="text-[10px] font-bold text-faint">{saleSizes.map((s) => <th key={s} className="px-2 py-1">{s}</th>)}</tr></thead>
                <tbody><tr>{saleSizes.map((s) => (
                  <td key={s} className="px-1 py-1">
                    <input type="number" value={saleGrid[s] ?? ""} onChange={(e) => setSaleGrid((p) => ({ ...p, [s]: e.target.value }))} placeholder="0" className="w-14 rounded-md border border-border py-1 text-center text-[12px] tnum outline-none focus:border-primary" />
                  </td>
                ))}</tr></tbody>
              </table>
              <p className="mt-1 text-[10px] text-faint">Sale is colour-less — any size, not clamped to the cut.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-center text-[12px]">
                <thead>
                  <tr className="text-[10px] font-bold text-faint">
                    <th className="px-2 py-1 text-left">Colour \ Size</th>
                    {sizes.map((s) => <th key={s} className="px-2 py-1">{s}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {colours.map((c) => (
                    <tr key={c} className="border-t border-slate-50">
                      <td className="px-2 py-1 text-left font-semibold text-slate-600">{c || "—"}</td>
                      {sizes.map((s) => {
                        const cut = cutCell(c, s);
                        if (cut <= 0) return <td key={s} className="px-1 py-1 text-faint">·</td>;
                        return (
                          <td key={s} className="px-1 py-1">
                            <input type="number" value={grid[key(c, s)] ?? ""} onChange={(e) => setGrid((p) => ({ ...p, [key(c, s)]: e.target.value }))} placeholder={String(cut)} className="w-14 rounded-md border border-border py-1 text-center text-[12px] tnum outline-none focus:border-primary" />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
            <input value={challan} onChange={(e) => setChallan(e.target.value)} placeholder="challan #" className={`${inp} w-28`} />
            <span className="text-[12px]">Entering <span className="font-bold tnum">{num(enteringNow)}</span> · balance <span className={cn("font-bold tnum", balance < 0 ? "text-emerald-600" : "text-amber-600")}>{num(balance)}</span></span>
            <button onClick={save} disabled={busy || enteringNow === 0} className="ml-auto rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-40">
              {busy ? "Saving…" : sale ? "Log sale" : "Log dispatch"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
