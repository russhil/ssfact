import { db } from "@/lib/db";

/**
 * Change 36 Part 8 — from roll to garment.
 *
 * When a buyer says "this batch's shade is off", the owner could not say which roll the
 * cut came from. ★ Capture identity where it ALREADY enters the system — inward (lot and
 * shade on the challan line), cutting (which lot a lay used), dispatch (already
 * size×colour) — then walk the chain. Document-level; no barcodes.
 *
 * Every hop is a foreign key that already existed:
 *   DispatchEvent -[DispatchLayers]- CuttingLayer -> JobCard -> MaterialChallan -> Supplier
 *
 * Two honesty constraints:
 *  - The challan→job-card link is OPTIONAL and often absent (a pure fabric stock purchase
 *    carries no jobCardId). The trace degrades to "inward challan unknown" rather than
 *    erroring or implying there wasn't one.
 *  - There is NO per-lot stock. FabricColor.currentStock is one scalar per (fabric,
 *    colour). This is provenance, not a lot-level balance, and the UI must not imply one.
 */

export type TraceLayer = {
  layerId: number;
  layerNo: number;
  label: string | null;
  lotNo: string | null;
  vendor: string | null;
  colours: string[];
  qty: number;
};

export type TraceChallan = {
  challanId: number;
  challanNo: string | null;
  date: Date;
  supplier: string | null;
  lots: { lotNo: string | null; shadeRef: string | null; fabric: string | null; qty: number }[];
  poNumber: string | null;
};

export type TraceResult = {
  jobCardId: number;
  siNo: string;
  product: string | null;
  dispatches: { id: number; dispatchNo: string | null; date: Date; qty: number; layerIds: number[] }[];
  layers: TraceLayer[];
  challans: TraceChallan[];
  /** True when no inward challan is linked — common for pure stock purchases. */
  inwardUnknown: boolean;
};

export async function traceGarment(input: { jobCardId?: number; dispatchEventId?: number }): Promise<TraceResult | null> {
  let jobCardId = input.jobCardId ?? null;

  if (jobCardId == null && input.dispatchEventId != null) {
    const ev = await db.dispatchEvent.findUnique({
      where: { id: input.dispatchEventId },
      select: { jobCardId: true },
    });
    jobCardId = ev?.jobCardId ?? null;
  }
  if (jobCardId == null) return null;

  const job = await db.jobCard.findUnique({
    where: { id: jobCardId },
    select: {
      id: true, siNo: true,
      product: { select: { name: true, skuCode: true } },
      layers: {
        orderBy: { layerNo: "asc" },
        select: {
          id: true, layerNo: true, label: true, fabricLotNo: true,
          vendor: { select: { name: true } },
          cells: { select: { colour: true, qty: true } },
        },
      },
      dispatches: {
        where: { voidedAt: null },
        orderBy: { date: "asc" },
        select: { id: true, dispatchNo: true, date: true, qty: true, layers: { select: { id: true } } },
      },
      materialChallans: {
        where: { direction: "INWARD", voidedAt: null },
        orderBy: { date: "asc" },
        select: {
          id: true, challanNo: true, date: true,
          supplier: { select: { name: true } },
          fabricOrder: { select: { poNumber: true } },
          lines: { select: { lotNo: true, shadeRef: true, qty: true, fabric: { select: { name: true } } } },
        },
      },
    },
  });
  if (!job) return null;

  return {
    jobCardId: job.id,
    siNo: job.siNo,
    product: job.product?.name || job.product?.skuCode || null,
    dispatches: job.dispatches.map((d) => ({
      id: d.id, dispatchNo: d.dispatchNo, date: d.date, qty: d.qty,
      layerIds: d.layers.map((l) => l.id),
    })),
    layers: job.layers.map((l) => ({
      layerId: l.id,
      layerNo: l.layerNo,
      label: l.label,
      lotNo: l.fabricLotNo,
      vendor: l.vendor?.name ?? null,
      colours: [...new Set(l.cells.map((c) => c.colour))],
      qty: l.cells.reduce((a, c) => a + c.qty, 0),
    })),
    challans: job.materialChallans.map((c) => ({
      challanId: c.id,
      challanNo: c.challanNo,
      date: c.date,
      supplier: c.supplier?.name ?? null,
      poNumber: c.fabricOrder?.poNumber ?? null,
      lots: c.lines.map((l) => ({ lotNo: l.lotNo, shadeRef: l.shadeRef, fabric: l.fabric?.name ?? null, qty: l.qty })),
    })),
    inwardUnknown: job.materialChallans.length === 0,
  };
}

export type LotTrace = {
  lotNo: string;
  received: { challanId: number; challanNo: string | null; date: Date; supplier: string | null; fabric: string | null; qty: number }[];
  consumed: {
    jobCardId: number;
    siNo: string;
    layerNo: number;
    qty: number;
    dispatches: { id: number; dispatchNo: string | null; qty: number }[];
  }[];
};

/** The reverse walk: a lot number in, every card and shipment that consumed it out. */
export async function traceLot(lotNo: string): Promise<LotTrace | null> {
  const lot = lotNo.trim();
  if (!lot) return null;

  const [lines, layers] = await Promise.all([
    db.materialChallanLine.findMany({
      where: { lotNo: lot },
      select: {
        qty: true,
        fabric: { select: { name: true } },
        challan: { select: { id: true, challanNo: true, date: true, supplier: { select: { name: true } } } },
      },
    }),
    db.cuttingLayer.findMany({
      where: { fabricLotNo: lot },
      select: {
        layerNo: true,
        cells: { select: { qty: true } },
        jobCard: { select: { id: true, siNo: true } },
        dispatches: { where: { voidedAt: null }, select: { id: true, dispatchNo: true, qty: true } },
      },
    }),
  ]);

  if (lines.length === 0 && layers.length === 0) return null;

  return {
    lotNo: lot,
    received: lines.map((l) => ({
      challanId: l.challan.id,
      challanNo: l.challan.challanNo,
      date: l.challan.date,
      supplier: l.challan.supplier?.name ?? null,
      fabric: l.fabric?.name ?? null,
      qty: l.qty,
    })),
    consumed: layers.map((l) => ({
      jobCardId: l.jobCard.id,
      siNo: l.jobCard.siNo,
      layerNo: l.layerNo,
      qty: l.cells.reduce((a, c) => a + c.qty, 0),
      dispatches: l.dispatches.map((d) => ({ id: d.id, dispatchNo: d.dispatchNo, qty: d.qty })),
    })),
  };
}

export type TraceStart = {
  lots: { lotNo: string; fabric: string | null; supplier: string | null; at: Date }[];
  dispatches: { id: number; dispatchNo: string | null; siNo: string; at: Date; qty: number }[];
  /** True when nothing anywhere carries a lot number yet. */
  noLotsAnywhere: boolean;
};

/**
 * What to offer when nobody has typed anything yet.
 *
 * A search page that renders only a box reads as broken — especially on a fresh install
 * where the answer to every search is "nothing found". This gives the page something to
 * show and something to click, and lets it say plainly when no lot has ever been recorded.
 */
export async function getTraceStartingPoints(): Promise<TraceStart> {
  const [lines, dispatches] = await Promise.all([
    db.materialChallanLine.findMany({
      where: { lotNo: { not: null } },
      orderBy: { id: "desc" },
      take: 40,
      select: {
        lotNo: true,
        fabric: { select: { name: true } },
        challan: { select: { date: true, supplier: { select: { name: true } } } },
      },
    }),
    db.dispatchEvent.findMany({
      where: { voidedAt: null },
      orderBy: { date: "desc" },
      take: 8,
      select: { id: true, dispatchNo: true, date: true, qty: true, jobCard: { select: { siNo: true } } },
    }),
  ]);

  // One row per lot, newest first.
  const seen = new Set<string>();
  const lots: TraceStart["lots"] = [];
  for (const l of lines) {
    const key = (l.lotNo ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    lots.push({ lotNo: key, fabric: l.fabric?.name ?? null, supplier: l.challan.supplier?.name ?? null, at: l.challan.date });
    if (lots.length >= 12) break;
  }

  return {
    lots,
    dispatches: dispatches.map((d) => ({
      id: d.id, dispatchNo: d.dispatchNo, siNo: d.jobCard.siNo, at: d.date, qty: d.qty,
    })),
    noLotsAnywhere: lots.length === 0,
  };
}
