import { db } from "@/lib/db";

// ── Pending Trims: cards whose trim needs exceed store stock, grouped by trim ──
export type PendingTrim = {
  trimId: number;
  trimName: string;
  required: number; // sum of outstanding balance across short cards
  inStore: number;
  shortfall: number;
  cards: { siNo: string; slug: string; need: number }[];
};

export async function getPendingTrims(): Promise<PendingTrim[]> {
  const jobs = await db.jobCard.findMany({
    where: { trimsPending: true },
    include: { jobLines: { include: { trimItem: true } } },
  });
  const byTrim = new Map<number, PendingTrim>();
  for (const j of jobs) {
    for (const l of j.jobLines) {
      if (!l.trimItemId || !l.trimItem) continue;
      const need = (l.requiredQty ?? l.totalQty ?? 0) - (l.issuedQty ?? 0);
      if (need <= 0) continue;
      const stock = l.trimItem.currentStock;
      if (need <= stock && (l.requiredQty ?? 0) <= stock) continue; // covered → skip
      const g =
        byTrim.get(l.trimItemId) ??
        byTrim.set(l.trimItemId, { trimId: l.trimItemId, trimName: l.trimItem.name, required: 0, inStore: stock, shortfall: 0, cards: [] }).get(l.trimItemId)!;
      g.required += need;
      g.cards.push({ siNo: j.siNo, slug: String(j.id), need });
    }
  }
  const out = [...byTrim.values()].map((g) => ({ ...g, shortfall: Math.max(0, g.required - g.inStore) }));
  return out.filter((g) => g.shortfall > 0).sort((a, b) => b.shortfall - a.shortfall);
}

// ── Vendor fabric variance: who over-consumes fabric vs assumed, and what it costs ──
export type VendorVariance = {
  vendor: string;
  cards: number;
  assumed: number;
  actual: number;
  extra: number;
  cost: number;
  unit: string;
};

export async function getVendorFabricVariance(): Promise<VendorVariance[]> {
  const jobs = await db.jobCard.findMany({
    include: { vendor: true, product: { include: { fabric: true } }, fabricLines: true },
  });
  const byVendor = new Map<string, VendorVariance>();
  for (const j of jobs) {
    const logged = j.fabricLines.filter((l) => l.qtyUsed != null);
    if (logged.length === 0) continue; // only cards with actuals
    const actual = logged.reduce((a, l) => a + (l.qtyUsed ?? 0), 0);
    const assumed = logged.reduce((a, l) => a + l.cutQty * (l.estAvg ?? j.estAvg ?? 0), 0);
    const extra = actual - assumed;
    const rate = j.product?.fabric?.ratePerUnit ?? 0;
    const g =
      byVendor.get(j.vendor.name) ??
      byVendor.set(j.vendor.name, { vendor: j.vendor.name, cards: 0, assumed: 0, actual: 0, extra: 0, cost: 0, unit: j.product?.unit ?? "MTR" }).get(j.vendor.name)!;
    g.cards += 1;
    g.assumed += assumed;
    g.actual += actual;
    g.extra += extra;
    g.cost += Math.max(0, extra) * rate;
  }
  return [...byVendor.values()].filter((v) => v.extra > 0.5).sort((a, b) => b.cost - a.cost);
}

// ── Vendor pendency: pieces out + days held on open cards ──
export type VendorPendency = { vendor: string; openCards: number; piecesOut: number; daysHeld: number };

export async function getVendorPendency(now = new Date()): Promise<VendorPendency[]> {
  const jobs = await db.jobCard.findMany({
    where: { status: "ACTIVE" },
    include: { vendor: true, dispatches: true },
  });
  const byVendor = new Map<string, VendorPendency & { oldest: number }>();
  for (const j of jobs) {
    const bal = j.cutQty - j.dispatchedQty;
    if (bal <= 0) continue;
    const start = j.cuttingIssuedOn ?? j.orderDate;
    const lastReceipt = j.dispatches.length ? Math.max(...j.dispatches.map((d) => d.date.getTime())) : null;
    const end = lastReceipt ?? now.getTime();
    const days = start ? Math.round((end - start.getTime()) / 86_400_000) : 0;
    const g =
      byVendor.get(j.vendor.name) ??
      byVendor.set(j.vendor.name, { vendor: j.vendor.name, openCards: 0, piecesOut: 0, daysHeld: 0, oldest: 0 }).get(j.vendor.name)!;
    g.openCards += 1;
    g.piecesOut += bal;
    g.oldest = Math.max(g.oldest, days);
  }
  return [...byVendor.values()]
    .filter((v) => v.vendor !== "Unassigned" && v.piecesOut > 0)
    .map(({ oldest, ...v }) => ({ ...v, daysHeld: oldest }))
    .sort((a, b) => b.piecesOut - a.piecesOut);
}

// ── Monthly fabric pipeline (Change 05 Part D): demand × consumption × rate ──
export type FabricPipeline = { fabric: string; unit: string; monthlyReq: number; monthlyCost: number; products: number };

export async function getFabricPipeline(): Promise<FabricPipeline[]> {
  const products = await db.product.findMany({
    include: { fabric: true, productionOrders: true },
  });
  const byFabric = new Map<string, FabricPipeline>();
  for (const p of products) {
    if (!p.fabric || !p.avgConsumption) continue;
    const monthlySale = p.productionOrders.reduce((a, o) => a + (o.avgMonthlySale ?? 0), 0);
    if (monthlySale <= 0) continue;
    const req = monthlySale * p.avgConsumption;
    const cost = req * (p.fabric.ratePerUnit ?? 0);
    const g =
      byFabric.get(p.fabric.name) ??
      byFabric.set(p.fabric.name, { fabric: p.fabric.name, unit: p.fabric.unit, monthlyReq: 0, monthlyCost: 0, products: 0 }).get(p.fabric.name)!;
    g.monthlyReq += req;
    g.monthlyCost += cost;
    g.products += 1;
  }
  return [...byFabric.values()].sort((a, b) => b.monthlyCost - a.monthlyCost);
}
