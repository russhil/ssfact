"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addCuttingLayer } from "@/lib/actions";
import { num } from "@/lib/format";
import { Plus } from "lucide-react";
// Change 38 Part D — this modal used to carry its own fork of the layer grid, with its own
// copies of cellKey/numOrNull, its own "apply ratio" fill button and — crucially — its own
// colour-weight resolution (`?? 1`) that split "all colours" differently from the create
// form for the same card. It now renders the one shared layer UI.
import {
  deriveLayerCells,
  emptyLayer,
  layerCellRows,
  layerFabricPayload,
  layerTotal,
  numOrNull,
  type LayerState,
} from "@/components/job-card/layer-grid";
import { ResponsiveCuttingLayerGrid } from "@/components/job-card/layer-grid-mobile";

export function AddCuttingLayer({
  jobCardId,
  sizes,
  colours,
  masters,
  vendors = [],
}: {
  jobCardId: number;
  sizes: string[];
  colours: string[];
  masters: string[];
  vendors?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const blank = () => emptyLayer(sizes, sizes.map((s) => [s, 1] as [string, number]));
  const [layer, setLayer] = useState<LayerState>(blank);

  const cols = colours.length > 0 ? colours : [""];
  const cells = deriveLayerCells(layer, cols);
  const total = layerTotal(cells);

  async function save() {
    const payloadCells = layerCellRows(layer, cells);
    if (!payloadCells.length) return;
    setBusy(true);
    try {
      await addCuttingLayer({
        jobCardId,
        label: layer.label.trim() || null,
        cutDate: layer.date || null,
        cuttingMaster: layer.master || null,
        // Change 38: a layer added after creation can now carry its own stitching vendor —
        // before this the field existed on the action but no UI ever sent it.
        vendorName: layer.vendor || null,
        avgConsumption: numOrNull(layer.avg),
        rolls: numOrNull(layer.rolls),
        // Change 38 Part B: with colour rows the server derives the layer totals from them.
        fabricMtr: null,
        fabricBalance: null,
        fabricIssued: null,
        fabricByColour: layerFabricPayload(layer),
        sizeRatio: JSON.stringify(layer.ratio.filter(([s]) => layer.sizes.includes(s))),
        layerLength: numOrNull(layer.layerLength), // Change 39 B
        cells: payloadCells,
      });
      setLayer(blank());
      setOpen(false);
      router.refresh();
    } catch (e) {
      alert("Could not add layer: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-primary/40 px-3 py-2 t-sm font-semibold text-primary-ink hover:bg-primary-soft">
        <Plus size={13} /> Add layer
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface-2 p-3.5">
      <div className="mb-2 t-xs font-bold uppercase tracking-wide text-primary-ink">New layer · {num(total)} pcs</div>

      <ResponsiveCuttingLayerGrid
        layer={layer}
        colours={cols}
        masters={masters}
        vendors={vendors}
        onChange={(patch) => setLayer((L) => ({ ...L, ...patch }))}
      />

      <div className="mt-2 flex gap-1.5">
        <button onClick={save} disabled={busy || total <= 0} className="rounded-md bg-primary px-3 py-1.5 t-sm font-semibold text-accent-on hover:opacity-90 disabled:opacity-40">Save layer</button>
        <button onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-1.5 t-sm font-semibold text-t1 hover:bg-surface-2">Cancel</button>
      </div>
    </div>
  );
}
