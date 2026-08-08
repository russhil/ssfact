"use client";

import { inputClass } from "@/components/ui";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDispatch } from "@/lib/actions";
import { num } from "@/lib/format";
import { cn } from "@/lib/cn";

const inp = inputClass("sm");

export type DispatchLayer = {
  id: number;
  layerNo: number;
  label: string | null;
  vendor: string | null;
  cells: { colour: string; size: string; qty: number }[];
};
export type PriorDispatch = { id: number; qty: number; layerIds: number[] };

const REASONS = ["ORDER", "SALE", "STOCK", "OTHER"] as const;

/**
 * Change 40 Part J — dispatch simplified to totals.
 *
 * Owner's ruling: the unit of account is (job card × vendor), NOT the layer. A job card has one
 * product, so every layer under a vendor is the same garment — pooling across a vendor's layers
 * loses no information. So the screen is one row: job card → vendor (mandatory) → two read-only
 * auto-fills (pooled pieces + how many layers) → one typed total → Order/Sale/Stock/Other.
 *
 * The size×colour grid and the layer picker are GONE (per the scope boundary, size-wise actuals
 * live on a printed sheet, not in software). Over-dispatch is shown and NEVER blocked; the
 * quality confirm survives. Historical dispatches keep their DispatchLines and still print.
 */
export function LayerDispatch({
  jobCardId,
  layers,
  prior = [],
  defaultArrangedBy,
  quality,
}: {
  jobCardId: number;
  layers: DispatchLayer[];
  prior?: PriorDispatch[];
  defaultArrangedBy: string;
  quality?: { status: "NONE" | "PASS" | "FAIL" | "PARTIAL" | "OPEN_REJECTS"; openRework: number };
}) {
  const router = useRouter();
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<(typeof REASONS)[number]>("ORDER");
  const [date, setDate] = useState("");
  const [challan, setChallan] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastDc, setLastDc] = useState<string | null>(null);

  const vendorList = useMemo(
    () => [...new Set(layers.map((l) => l.vendor).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b)),
    [layers]
  );
  // Vendor is mandatory; default to the only one when there is a single vendor on the card.
  const [vendor, setVendor] = useState<string | null>(vendorList.length === 1 ? vendorList[0] : null);

  // The vendor's layers on this card, and the two auto-filled numbers.
  const vendorLayers = useMemo(() => (vendor ? layers.filter((l) => l.vendor === vendor) : []), [layers, vendor]);
  const vendorLayerIds = useMemo(() => vendorLayers.map((l) => l.id), [vendorLayers]);
  const pooledPieces = useMemo(
    () => vendorLayers.reduce((a, l) => a + l.cells.reduce((b, c) => b + (c.qty > 0 ? c.qty : 0), 0), 0),
    [vendorLayers]
  );
  const priorDispatched = useMemo(
    () => prior.filter((e) => e.layerIds.some((id) => vendorLayerIds.includes(id))).reduce((a, e) => a + e.qty, 0),
    [prior, vendorLayerIds]
  );
  const entering = +qty || 0;
  // Running balance may go negative/over — never clamp (spec). Purely informational.
  const balance = pooledPieces - priorDispatched - entering;

  const hasLayers = layers.length > 0;
  const canSave = !busy && entering > 0 && (!hasLayers || !!vendor);

  function confirmQuality(): boolean {
    const q = quality;
    if (!q || q.status === "PASS") return true;
    const why =
      q.status === "NONE" ? "This card has not been inspected."
      : q.status === "FAIL" ? "The last inspection on this card FAILED."
      : q.status === "OPEN_REJECTS" ? `${q.openRework} piece(s) are still out for rework.`
      : "The last inspection passed only partially.";
    return confirm(`${why}\n\nDispatch anyway?`);
  }

  async function save() {
    if (!confirmQuality()) return;
    if (entering === 0) return;
    if (hasLayers && !vendor) { alert("Pick the vendor these goods are coming from."); return; }
    setBusy(true);
    try {
      const res = await addDispatch({
        jobCardId,
        qty: entering,
        reason,
        date: date || undefined,
        challan: challan.trim() || undefined,
        arrangedBy: defaultArrangedBy || null,
        // Attach every layer of the chosen vendor (or none for a legacy no-layer card). Nothing
        // reads a per-layer dispatch balance any more, so this is provenance only.
        layerIds: hasLayers ? vendorLayerIds : undefined,
      });
      setQty(""); setChallan(""); setLastDc(res?.dispatchNo ?? null);
      router.refresh();
    } catch (e) {
      alert("Could not dispatch: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-border p-3">
      <div className="mb-2 t-xs font-semibold text-t1">Log dispatch (vendor → warehouse)</div>

      {lastDc && (
        <div className="mb-2 rounded-md border border-ok/30 bg-ok-soft px-2.5 py-1.5 t-xs font-semibold text-ok">
          Dispatch logged — challan <span className="tnum">{lastDc}</span>. Open it from Recent Dispatches to print / share.
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2.5">
        {hasLayers && (
          <label className="flex flex-col gap-1">
            <span className="t-micro font-semibold uppercase tracking-wide text-faint">Vendor</span>
            <select value={vendor ?? ""} onChange={(e) => setVendor(e.target.value || null)} className={`${inp} min-w-[140px]`}>
              <option value="">— pick vendor —</option>
              {vendorList.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        )}

        {/* two read-only auto-fills from (job card × vendor) */}
        {hasLayers && vendor && (
          <div className="flex items-end gap-4 rounded-lg border border-border bg-surface-2 px-3 py-1.5">
            <div><div className="t-micro text-faint">Pieces held</div><div className="font-bold tnum">{num(pooledPieces)}</div></div>
            <div><div className="t-micro text-faint">Layers</div><div className="font-bold tnum">{vendorLayers.length}</div></div>
            <div><div className="t-micro text-faint">Already sent</div><div className="tnum text-t2">{num(priorDispatched)}</div></div>
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="t-micro font-semibold uppercase tracking-wide text-faint">Dispatch qty</span>
          <input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="total pieces" className={`${inp} w-32 text-right tnum`} />
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-micro font-semibold uppercase tracking-wide text-faint">Reason</span>
          <select value={reason} onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])} className={inp}>
            {REASONS.map((r) => <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-micro font-semibold uppercase tracking-wide text-faint">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="t-micro font-semibold uppercase tracking-wide text-faint">Challan #</span>
          <input value={challan} onChange={(e) => setChallan(e.target.value)} placeholder="optional" className={`${inp} w-28`} />
        </label>

        <button onClick={save} disabled={!canSave} className="ml-auto rounded-md bg-primary px-3 py-2 t-sm font-semibold text-accent-on hover:opacity-90 disabled:opacity-40">
          {busy ? "Saving…" : "Log dispatch"}
        </button>
      </div>

      {hasLayers && vendor && entering > 0 && (
        // Over-dispatch stays visible, never blocked (spec J6).
        <div className="mt-2 t-sm">
          Entering <span className="font-bold tnum">{num(entering)}</span> · balance{" "}
          <span className={cn("font-bold tnum", balance < 0 ? "text-ok" : "text-warn")}>{num(balance)}</span>
          {balance < 0 && <span className="ml-1 text-ok">(over the vendor's cut — allowed)</span>}
        </div>
      )}
    </div>
  );
}
