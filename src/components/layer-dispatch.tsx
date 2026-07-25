"use client";

import { inputClass } from "@/components/ui";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDispatch } from "@/lib/actions";
import { num } from "@/lib/format";
import { cn } from "@/lib/cn";

const inp = inputClass("sm");
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
  const [sale, setSale] = useState(false);
  const [grid, setGrid] = useState<Record<string, string>>({}); // key `colour|||size` -> qty
  const [saleGrid, setSaleGrid] = useState<Record<string, string>>({}); // size -> qty
  const [date, setDate] = useState("");
  const [challan, setChallan] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastDc, setLastDc] = useState<string | null>(null); // Change 17: last DC-YYYY-NNN issued

  // legacy fallback (no layers) — simple total qty + reason
  const [legacyQty, setLegacyQty] = useState("");
  const [legacyReason, setLegacyReason] = useState<"ORDER" | "SALE">("ORDER");

  const key = (c: string, s: string) => `${c}|||${s}`;

  // Change 17 Part I: card-driven — the table covers ALL layers of the card by default.
  // If the card spans >1 stitching vendor, an optional filter narrows it to one vendor so
  // per-vendor balances stay correct; a null-vendor layer only shows under "All".
  const vendorList = useMemo(
    () => [...new Set(layers.map((l) => l.vendor).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b)),
    [layers]
  );
  const multiVendor = vendorList.length > 1;
  const [vendorFilter, setVendorFilter] = useState<string | null>(null);

  const activeLayers = useMemo(
    () => (vendorFilter ? layers.filter((l) => l.vendor === vendorFilter) : layers),
    [layers, vendorFilter]
  );
  const activeLayerIds = useMemo(() => activeLayers.map((l) => l.id), [activeLayers]);

  // union of colours/sizes cut in the active layers, and pooled cut per cell
  const { colours, sizes, cutCell, poolCut } = useMemo(() => {
    const cutMap = new Map<string, number>();
    const colSet = new Set<string>();
    const sizeSet = new Set<string>();
    let pool = 0;
    for (const l of activeLayers)
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
  }, [activeLayers]);

  const saleSizes = sizes.length ? sizes : DEFAULT_SIZES;

  const priorDispatched = useMemo(
    () => prior.filter((e) => e.layerIds.some((id) => activeLayerIds.includes(id))).reduce((a, e) => a + e.qty, 0),
    [prior, activeLayerIds]
  );
  const enteringNow = useMemo(() => {
    if (sale) return Object.values(saleGrid).reduce((a, v) => a + (+v || 0), 0);
    return Object.values(grid).reduce((a, v) => a + (+v || 0), 0);
  }, [grid, saleGrid, sale]);
  const balance = poolCut - priorDispatched - enteringNow;

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
      const res = await addDispatch({
        jobCardId,
        reason: sale ? "SALE" : "ORDER",
        date: date || undefined,
        challan: challan.trim() || undefined,
        arrangedBy: defaultArrangedBy || null,
        layerIds: activeLayerIds,
        lines,
      });
      setGrid({}); setSaleGrid({}); setChallan(""); setSale(false);
      setLastDc(res?.dispatchNo ?? null);
      router.refresh();
    } catch (e) {
      alert("Could not dispatch: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const dcBanner = lastDc ? (
    <div className="mb-2 rounded-md border border-ok/30 bg-ok-soft px-2.5 py-1.5 t-xs font-semibold text-ok">
      Dispatch logged — challan <span className="tnum">{lastDc}</span>. Open it from Recent Dispatches to print / share.
    </div>
  ) : null;

  // ── legacy card: no cutting layers → single-qty dispatch ─────────────────────
  if (layers.length === 0) {
    async function saveLegacy() {
      if (!legacyQty || +legacyQty === 0) return;
      setBusy(true);
      try {
        const res = await addDispatch({ jobCardId, qty: +legacyQty, reason: legacyReason, date: date || undefined, challan: challan.trim() || undefined, arrangedBy: defaultArrangedBy || null });
        setLegacyQty(""); setChallan(""); setLastDc(res?.dispatchNo ?? null);
        router.refresh();
      } catch (e) { alert("Could not dispatch: " + (e as Error).message); } finally { setBusy(false); }
    }
    return (
      <div className="mt-3 rounded-lg border border-dashed border-border p-2.5">
        <div className="mb-1.5 t-xs font-semibold text-t1">Log dispatch</div>
        {dcBanner}
        <div className="flex flex-wrap items-center gap-1.5">
          <input type="number" value={legacyQty} onChange={(e) => setLegacyQty(e.target.value)} placeholder="qty" className={`${inp} w-24 text-right tnum`} />
          <div className="flex rounded-md border border-border p-0.5">
            {(["ORDER", "SALE"] as const).map((r) => (
              <button key={r} onClick={() => setLegacyReason(r)} className={cn("rounded px-2 py-1 t-xs font-semibold", legacyReason === r ? "bg-primary text-accent-on" : "text-t2 hover:text-ink")}>{r}</button>
            ))}
          </div>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
          <input value={challan} onChange={(e) => setChallan(e.target.value)} placeholder="challan #" className={`${inp} w-28`} />
          <button onClick={saveLegacy} disabled={busy || !legacyQty} className="rounded-md bg-primary px-2.5 py-1.5 t-sm font-semibold text-accent-on hover:opacity-90 disabled:opacity-40">Log</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="t-xs font-semibold text-t1">Log dispatch (vendor → warehouse)</span>
        <button onClick={() => { setSale((s) => !s); }} className={cn("rounded-md border px-2 py-1 t-xs font-semibold", sale ? "border-warn/30 bg-warn-soft text-warn" : "border-border bg-surface text-t2")}>
          {sale ? "Sale (defective)" : "Mark as Sale"}
        </button>
      </div>

      {dcBanner}

      {/* Change 17 Part I: card-wide table; vendor filter only when the card spans >1 vendor */}
      {multiVendor && (
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <span className="t-micro font-semibold uppercase tracking-wide text-faint">Vendor</span>
          <button
            onClick={() => setVendorFilter(null)}
            className={cn("rounded-lg border px-2.5 py-1 t-xs font-semibold", vendorFilter === null ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-surface text-t1")}
          >
            All
          </button>
          {vendorList.map((v) => (
            <button
              key={v}
              onClick={() => setVendorFilter(v)}
              className={cn("rounded-lg border px-2.5 py-1 t-xs font-semibold", vendorFilter === v ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-surface text-t1")}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      {poolCut === 0 ? (
        <p className="py-2 text-center t-xs text-muted">Nothing cut to dispatch{vendorFilter ? ` for ${vendorFilter}` : ""} yet.</p>
      ) : (
        <>
          <div className="mb-2 t-xs text-muted">
            {vendorFilter ? <>Vendor: <span className="font-semibold text-ink">{vendorFilter}</span> · </> : null}
            pool cut {num(poolCut)} · dispatched {num(priorDispatched)}
          </div>

          {sale ? (
            <div className="overflow-x-auto">
              <table className="text-center t-sm">
                <thead><tr className="t-micro font-bold text-faint">{saleSizes.map((s) => <th key={s} className="px-2 py-1">{s}</th>)}</tr></thead>
                <tbody><tr>{saleSizes.map((s) => (
                  <td key={s} className="px-1 py-1">
                    <input type="number" value={saleGrid[s] ?? ""} onChange={(e) => setSaleGrid((p) => ({ ...p, [s]: e.target.value }))} placeholder="0" className="w-14 rounded-md border border-border py-1 text-center t-sm tnum outline-none focus:border-primary" />
                  </td>
                ))}</tr></tbody>
              </table>
              <p className="mt-1 t-micro text-faint">Sale is colour-less — any size, not clamped to the cut.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-center t-sm">
                <thead>
                  <tr className="t-micro font-bold text-faint">
                    <th className="px-2 py-1 text-left">Colour \ Size</th>
                    {sizes.map((s) => <th key={s} className="px-2 py-1">{s}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {colours.map((c) => (
                    <tr key={c} className="border-t border-hairline">
                      <td className="px-2 py-1 text-left font-semibold text-t1">{c || "—"}</td>
                      {sizes.map((s) => {
                        const cut = cutCell(c, s);
                        if (cut <= 0) return <td key={s} className="px-1 py-1 text-faint">·</td>;
                        return (
                          <td key={s} className="px-1 py-1">
                            <input type="number" value={grid[key(c, s)] ?? ""} onChange={(e) => setGrid((p) => ({ ...p, [key(c, s)]: e.target.value }))} placeholder={String(cut)} className="w-14 rounded-md border border-border py-1 text-center t-sm tnum outline-none focus:border-primary" />
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
            <span className="t-sm">Entering <span className="font-bold tnum">{num(enteringNow)}</span> · balance <span className={cn("font-bold tnum", balance < 0 ? "text-ok" : "text-warn")}>{num(balance)}</span></span>
            <button onClick={save} disabled={busy || enteringNow === 0} className="ml-auto rounded-md bg-primary px-3 py-1.5 t-sm font-semibold text-accent-on hover:opacity-90 disabled:opacity-40">
              {busy ? "Saving…" : sale ? "Log sale" : "Log dispatch"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
