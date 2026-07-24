/**
 * Change 19 Part C — vendor roll-ups read the LAYER vendor, not the card header vendor.
 *
 * Since Change 14 the stitching vendor lives on the cutting layer, and Change 16 F retired
 * card-level stitch assignments. But most roll-ups (board, vendor index, dashboard, reports)
 * still attributed a whole card to `JobCard.vendor` — so a card split across two vendors was
 * counted 100% against one of them, and `/vendors` disagreed with `/vendors/[name]`, which
 * was already layer-based. This module is the single place that split now happens.
 *
 * The header vendor remains the card's ORGANISER and is the fallback for legacy cards that
 * have no layers at all (the old SizeBreakup path) — those still need to appear somewhere.
 */

export type VendorShare = {
  vendor: string;
  cutQty: number;
  dispatchedQty: number;
  /** layer cut ÷ card cut — used to apportion card-level scalars that have no per-layer split. */
  share: number;
};

type LayerLike = {
  id: number;
  vendor?: { name: string } | null;
  cells?: { qty: number }[];
};

type DispatchLike = {
  qty: number;
  layers?: { id: number }[];
};

export type SplittableJob = {
  vendor: { name: string };
  cutQty?: number;
  dispatchedQty?: number;
  layers?: LayerLike[];
  dispatches?: DispatchLike[];
};

/**
 * Split a card's work across the vendors of its cutting layers.
 *
 * Cut qty per layer is the sum of its colour×size cells. Dispatch is booked against layers
 * (the DispatchLayers M2M from Change 14): a single-layer event — the overwhelming majority —
 * lands entirely on that layer's vendor; an event spanning several layers is split
 * proportionally by layer cut qty, which is the closest honest attribution available since
 * dispatch lines carry colour/size but not a layer.
 *
 * Returns one row per vendor. A card with no layers (or no layer vendors) yields a single
 * row for the header vendor carrying the whole card.
 */
export function splitByLayerVendor(job: SplittableJob): VendorShare[] {
  const cardCut = job.cutQty ?? 0;
  const cardDisp = job.dispatchedQty ?? 0;
  const layers = job.layers ?? [];

  const layerCut = new Map<number, number>();
  let totalLayerCut = 0;
  for (const l of layers) {
    const q = (l.cells ?? []).reduce((a, c) => a + c.qty, 0);
    layerCut.set(l.id, q);
    totalLayerCut += q;
  }

  const named = layers.filter((l) => l.vendor?.name);
  // Legacy card: no layers, or layers with no vendor — the header vendor owns it whole.
  if (named.length === 0 || totalLayerCut <= 0) {
    return [{ vendor: job.vendor.name, cutQty: cardCut, dispatchedQty: cardDisp, share: 1 }];
  }

  const acc = new Map<string, VendorShare>();
  const bump = (name: string, cut: number, disp: number) => {
    const row = acc.get(name) ?? { vendor: name, cutQty: 0, dispatchedQty: 0, share: 0 };
    row.cutQty += cut;
    row.dispatchedQty += disp;
    acc.set(name, row);
  };

  for (const l of named) bump(l.vendor!.name, layerCut.get(l.id) ?? 0, 0);

  // Attribute each dispatch event to the layer(s) it was booked against.
  const vendorOfLayer = new Map(layers.map((l) => [l.id, l.vendor?.name ?? null]));
  let attributed = 0;
  for (const e of job.dispatches ?? []) {
    const ls = (e.layers ?? []).filter((x) => vendorOfLayer.get(x.id));
    if (ls.length === 0) continue; // un-booked dispatch — handled by the remainder below
    const denom = ls.reduce((a, x) => a + (layerCut.get(x.id) ?? 0), 0);
    for (const x of ls) {
      const w = denom > 0 ? (layerCut.get(x.id) ?? 0) / denom : 1 / ls.length;
      bump(vendorOfLayer.get(x.id)!, 0, e.qty * w);
      attributed += e.qty * w;
    }
  }

  // Dispatches predating the layer M2M (or booked without layers) still have to land
  // somewhere — spread the remainder across vendors in proportion to their cut.
  const remainder = cardDisp - attributed;
  if (remainder > 0.005) {
    const totalCut = [...acc.values()].reduce((a, r) => a + r.cutQty, 0);
    for (const row of acc.values()) {
      row.dispatchedQty += totalCut > 0 ? remainder * (row.cutQty / totalCut) : remainder / acc.size;
    }
  }

  const rows = [...acc.values()];
  const sumCut = rows.reduce((a, r) => a + r.cutQty, 0);
  for (const r of rows) {
    r.share = sumCut > 0 ? r.cutQty / sumCut : 1 / rows.length;
    r.cutQty = Math.round(r.cutQty * 100) / 100;
    r.dispatchedQty = Math.round(r.dispatchedQty * 100) / 100;
  }
  return rows;
}

/** The vendors actually stitching a card — layer vendors, else the header vendor. */
export function layerVendorNames(job: SplittableJob): string[] {
  const names = [...new Set((job.layers ?? []).map((l) => l.vendor?.name).filter((n): n is string => !!n))];
  return names.length > 0 ? names : [job.vendor.name];
}

/** Compact column label: "Acme", or "Acme +2" when a card is split. */
export function vendorLabel(names: string[]): string {
  if (names.length === 0) return "—";
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
}

/** The include fragment every layer-aware roll-up query needs. */
export const LAYER_VENDOR_INCLUDE = {
  layers: { select: { id: true, cells: { select: { qty: true } }, vendor: { select: { name: true } } } },
  dispatches: { select: { qty: true, layers: { select: { id: true } } } },
} as const;
