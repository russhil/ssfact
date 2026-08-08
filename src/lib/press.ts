import { db } from "@/lib/db";

/**
 * Change 40 Part K — everything the job-card Pressing section needs, all DERIVED on read
 * (K8: never store a shortfall). Two views: the vendors-and-their-layers structure the outward
 * form picks from (with each layer's live-outward marker so a used layer shows disabled), and the
 * press documents with their open balances.
 */
export type PressLayerOpt = { id: number; layerNo: number; label: string | null; pieces: number; usedByDocNo: string | null };
export type PressVendorOpt = { vendorId: number; vendorName: string; layers: PressLayerOpt[] };
export type PressDoc = {
  id: number; docNo: string | null; direction: "OUT" | "IN"; vendorId: number; vendorName: string;
  date: Date; qty: number; voidedAt: Date | null;
  // OUT only: the pooled cut of its layers, the shortfall (cut − sent), what's come back and what's open.
  layersCut: number; shortfall: number; back: number; openReturn: number; layerLabels: string[];
  pressOutId: number | null;
};
export type JobPress = { vendors: PressVendorOpt[]; docs: PressDoc[]; totalOpenShortfall: number };

function pooled(cells: { qty: number }[]): number {
  return cells.reduce((a, c) => a + (c.qty > 0 ? c.qty : 0), 0);
}

export async function getJobPress(jobCardId: number): Promise<JobPress> {
  const [layers, challans] = await Promise.all([
    db.cuttingLayer.findMany({
      where: { jobCardId, vendorId: { not: null } },
      select: { id: true, layerNo: true, label: true, vendorId: true, vendor: { select: { name: true } }, cells: { select: { qty: true } } },
      orderBy: { layerNo: "asc" },
    }),
    db.pressChallan.findMany({
      where: { jobCardId },
      select: {
        id: true, docNo: true, direction: true, vendorId: true, vendor: { select: { name: true } },
        date: true, qty: true, voidedAt: true, pressOutId: true,
        layers: { select: { id: true, layerNo: true, label: true, cells: { select: { qty: true } } } },
        pressIns: { where: { voidedAt: null }, select: { qty: true } },
      },
      orderBy: { id: "desc" },
    }),
  ]);

  // which layer ids are consumed by a live (non-void) outward, and by which doc
  const usedBy = new Map<number, string | null>();
  for (const c of challans) {
    if (c.direction !== "OUT" || c.voidedAt) continue;
    for (const l of c.layers) usedBy.set(l.id, c.docNo);
  }

  // vendors → their layers, with the used marker
  const vmap = new Map<number, PressVendorOpt>();
  for (const l of layers) {
    if (l.vendorId == null) continue;
    const v = vmap.get(l.vendorId) ?? { vendorId: l.vendorId, vendorName: l.vendor?.name ?? "—", layers: [] };
    v.layers.push({ id: l.id, layerNo: l.layerNo, label: l.label, pieces: pooled(l.cells), usedByDocNo: usedBy.get(l.id) ?? null });
    vmap.set(l.vendorId, v);
  }

  const docs: PressDoc[] = [];
  let totalOpenShortfall = 0;
  for (const c of challans) {
    const layersCut = c.direction === "OUT" ? c.layers.reduce((a, l) => a + pooled(l.cells), 0) : 0;
    const shortfall = c.direction === "OUT" && !c.voidedAt ? Math.max(0, layersCut - c.qty) : 0;
    const back = c.direction === "OUT" ? c.pressIns.reduce((a, i) => a + i.qty, 0) : 0;
    const openReturn = c.direction === "OUT" && !c.voidedAt ? c.qty - back : 0;
    if (!c.voidedAt) totalOpenShortfall += shortfall;
    docs.push({
      id: c.id, docNo: c.docNo, direction: c.direction as "OUT" | "IN", vendorId: c.vendorId,
      vendorName: c.vendor?.name ?? "—", date: c.date, qty: c.qty, voidedAt: c.voidedAt,
      layersCut, shortfall, back, openReturn, pressOutId: c.pressOutId,
      layerLabels: c.layers.map((l) => l.label || `Layer ${l.layerNo}`),
    });
  }

  return { vendors: [...vmap.values()], docs, totalOpenShortfall };
}
