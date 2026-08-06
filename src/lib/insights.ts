import { db } from "@/lib/db";
import { LAYER_VENDOR_INCLUDE, splitByLayerVendor } from "@/lib/vendor-split";
import { orderFlag, OPEN_ORDER_STATUSES } from "@/lib/order-flags";
import { POSTED } from "@/lib/job-scope";

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
    where: { ...POSTED, trimsPending: true },
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

// ── Change 39 Part E1 — cards ready to start: every trim covered by store stock ──
// The positive mirror of the shortage list. Computed LIVE against current stock (not the
// trimsPending flag) so a card whose stock was topped up via an inward challan surfaces here
// immediately, even though nothing recomputed its flag.
export type ReadyCard = { id: number; siNo: string; productName: string; cutQty: number };

export async function getReadyCards(): Promise<ReadyCard[]> {
  const jobs = await db.jobCard.findMany({
    // ACTIVE = posted and not closed (the only non-DRAFT, non-CLOSED status). Pre-stitch only.
    where: { status: "ACTIVE", stage: { in: ["FABRIC_AWAITED", "CUTTING"] } },
    include: { jobLines: { include: { trimItem: true } }, product: { select: { name: true } } },
  });
  const out: ReadyCard[] = [];
  for (const j of jobs) {
    const trimLines = j.jobLines.filter((l) => l.trimItemId && l.trimItem);
    if (trimLines.length === 0) continue; // no trims to be "ready" about
    const allCovered = trimLines.every((l) => {
      const need = (l.requiredQty ?? l.totalQty ?? 0) - (l.issuedQty ?? 0);
      if (need <= 0) return true; // already issued
      const stock = l.trimItem!.currentStock;
      return need <= stock && (l.requiredQty ?? 0) <= stock; // covered by store stock
    });
    if (allCovered) out.push({ id: j.id, siNo: j.siNo, productName: j.product?.name ?? j.customItem ?? "—", cutQty: j.cutQty });
  }
  return out.sort((a, b) => a.siNo.localeCompare(b.siNo));
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
    where: POSTED,
    include: { vendor: true, product: { include: { fabric: true } }, fabricLines: true, ...LAYER_VENDOR_INCLUDE },
  });
  const byVendor = new Map<string, VendorVariance>();
  for (const j of jobs) {
    const logged = j.fabricLines.filter((l) => l.qtyUsed != null);
    if (logged.length === 0) continue; // only cards with actuals
    const actual = logged.reduce((a, l) => a + (l.qtyUsed ?? 0), 0);
    const assumed = logged.reduce((a, l) => a + l.cutQty * (l.estAvg ?? j.estAvg ?? 0), 0);
    const extra = actual - assumed;
    const rate = j.product?.fabric?.ratePerUnit ?? 0;
    // Change 19 C: fabric lines are per colour, not per layer, so a split card's variance is
    // apportioned by each vendor's share of the cut — the closest honest attribution.
    for (const s of splitByLayerVendor(j)) {
      const g =
        byVendor.get(s.vendor) ??
        byVendor.set(s.vendor, { vendor: s.vendor, cards: 0, assumed: 0, actual: 0, extra: 0, cost: 0, unit: j.product?.unit ?? "MTR" }).get(s.vendor)!;
      g.cards += 1;
      g.assumed += assumed * s.share;
      g.actual += actual * s.share;
      g.extra += extra * s.share;
      g.cost += Math.max(0, extra * s.share) * rate;
    }
  }
  return [...byVendor.values()].filter((v) => v.extra > 0.5).sort((a, b) => b.cost - a.cost);
}

// ── Vendor pendency: pieces out + days held on open cards ──
export type VendorPendency = { vendor: string; openCards: number; piecesOut: number; daysHeld: number };

export async function getVendorPendency(now = new Date()): Promise<VendorPendency[]> {
  const jobs = await db.jobCard.findMany({
    where: { status: "ACTIVE" },
    include: {
      vendor: true,
      // Change 22 B.1: a voided dispatch never happened — it must not age a vendor's
      // pendency or count towards what they've returned.
      dispatches: { where: { voidedAt: null }, select: { qty: true, date: true, layers: { select: { id: true } } } },
      layers: { select: { id: true, cells: { select: { qty: true } }, vendor: { select: { name: true } } } },
    },
  });
  const byVendor = new Map<string, VendorPendency & { oldest: number }>();
  for (const j of jobs) {
    const bal = j.cutQty - j.dispatchedQty;
    if (bal <= 0) continue;
    const start = j.cuttingIssuedOn ?? j.orderDate;
    const lastReceipt = j.dispatches.length ? Math.max(...j.dispatches.map((d) => d.date.getTime())) : null;
    const end = lastReceipt ?? now.getTime();
    const days = start ? Math.round((end - start.getTime()) / 86_400_000) : 0;
    // Change 19 C: pieces still out sit with the vendor holding that LAYER, per vendor.
    for (const s of splitByLayerVendor(j)) {
      const vBal = s.cutQty - s.dispatchedQty;
      if (vBal <= 0) continue;
      const g =
        byVendor.get(s.vendor) ??
        byVendor.set(s.vendor, { vendor: s.vendor, openCards: 0, piecesOut: 0, daysHeld: 0, oldest: 0 }).get(s.vendor)!;
      g.openCards += 1;
      g.piecesOut += vBal;
      g.oldest = Math.max(g.oldest, days);
    }
  }
  return [...byVendor.values()]
    .filter((v) => v.vendor !== "Unassigned" && v.piecesOut > 0)
    .map(({ oldest, ...v }) => ({ ...v, daysHeld: oldest }))
    .sort((a, b) => b.piecesOut - a.piecesOut);
}

/* ── Change 25 Part E — low stock, from ONE selector ──────────────────────────
 *
 * Reorder level existed on trims only (Change 17 H) and was shown passively on a
 * page nobody opens until something has already run out. Nothing anywhere said
 * "you are about to run out".
 *
 * The dashboard widget, the inventory/trims below-reorder filters and any future
 * notification all read this one function, so the count on the dashboard and the
 * length of the filtered list can never disagree — the same rule the inventory KPI
 * cards follow.
 */

export type LowStockAlert = {
  kind: "FABRIC" | "TRIM";
  /** FabricColor.id or TrimItem.id — unique within `kind`. */
  id: number;
  name: string;
  colour: string | null;
  unit: string;
  currentStock: number;
  reorderLevel: number;
  /** How far under the trigger, always >= 0. */
  gap: number;
  href: string;
};

export async function getLowStockAlerts(): Promise<LowStockAlert[]> {
  const [colours, trims] = await Promise.all([
    db.fabricColor.findMany({
      where: { reorderLevel: { not: null } },
      include: { fabric: { select: { id: true, name: true, unit: true } } },
    }),
    db.trimItem.findMany({
      where: { reorderLevel: { not: null }, status: { not: "DISCONTINUED" } },
      select: { id: true, name: true, unit: true, currentStock: true, reorderLevel: true },
    }),
  ]);

  const out: LowStockAlert[] = [];
  for (const c of colours) {
    const level = c.reorderLevel!;
    if (c.currentStock > level) continue;
    out.push({
      kind: "FABRIC",
      id: c.id,
      name: c.fabric.name,
      colour: c.color,
      unit: String(c.fabric.unit),
      currentStock: c.currentStock,
      reorderLevel: level,
      gap: Math.round((level - c.currentStock) * 100) / 100,
      href: `/inventory/${c.fabric.id}`,
    });
  }
  for (const t of trims) {
    const level = t.reorderLevel!;
    if (t.currentStock > level) continue;
    out.push({
      kind: "TRIM",
      id: t.id,
      name: t.name,
      colour: null,
      unit: t.unit ?? "pcs",
      currentStock: t.currentStock,
      reorderLevel: level,
      gap: Math.round((level - t.currentStock) * 100) / 100,
      href: `/trims/${t.id}`,
    });
  }
  // Worst shortfall first — that is the buying order.
  return out.sort((a, b) => b.gap - a.gap);
}

/**
 * Deferred hook for a later WhatsApp/email push (Change 25 Part E.4). The call site
 * exists so the transport can attach without touching the selector above; no
 * transport is built here and no messaging library is installed.
 */
export async function notifyLowStock(_alerts: LowStockAlert[]): Promise<void> {
  return;
}

/* ── Change 25 Part L — late and un-tracked deliveries, from ONE selector ─────
 *
 * Every order can carry an expectedDate and nothing ever checked it: a supplier
 * could blow past the promised date and the row sat there looking normal. The
 * opposite problem is flagged too — a PO raised with no expected date logged, so
 * there is nothing to track it against.
 *
 * An order is still OPEN when its status is neither RECEIVED nor DISCARDED.
 * Read-only and derived; no schema or server-action change.
 */

export type DelayedOrder = {
  kind: "FABRIC" | "TRIM";
  id: number;
  item: string;
  supplier: string | null;
  poNumber: string | null;
  status: string;
  expectedDate: Date | null;
  /** "DELAYED" past its date, "NO_ETA" for a PO with no date logged at all. */
  flag: "DELAYED" | "NO_ETA";
  /** Whole days past expectedDate; 0 for NO_ETA. */
  daysLate: number;
  href: string;
};

export async function getDelayedOrders(now = new Date()): Promise<DelayedOrder[]> {
  const open = { status: { in: OPEN_ORDER_STATUSES as unknown as never } };
  const [fabric, trim] = await Promise.all([
    db.fabricOrder.findMany({
      where: open,
      include: { fabric: { select: { name: true } }, supplier: { select: { name: true } } },
    }),
    db.trimOrder.findMany({
      where: open,
      include: { trimItem: { select: { name: true } }, supplier: { select: { name: true } } },
    }),
  ]);

  const out: DelayedOrder[] = [];
  for (const o of fabric) {
    const { flag, daysLate } = orderFlag({ status: String(o.status), expectedDate: o.expectedDate, poNumber: o.poNumber }, now);
    if (!flag) continue;
    out.push({
      kind: "FABRIC", id: o.id, item: o.fabric.name, supplier: o.supplier?.name ?? null,
      poNumber: o.poNumber, status: String(o.status), expectedDate: o.expectedDate,
      flag, daysLate, href: "/fabric-orders",
    });
  }
  for (const o of trim) {
    const { flag, daysLate } = orderFlag({ status: String(o.status), expectedDate: o.expectedDate, poNumber: o.poNumber }, now);
    if (!flag) continue;
    out.push({
      kind: "TRIM", id: o.id, item: o.trimItem.name, supplier: o.supplier?.name ?? null,
      poNumber: o.poNumber, status: String(o.status), expectedDate: o.expectedDate,
      flag, daysLate, href: "/trim-orders",
    });
  }
  // Worst overdue first; NO_ETA rows sort after every delayed one.
  return out.sort((a, b) => b.daysLate - a.daysLate);
}

/* ── Change 25 Part F — the management view ───────────────────────────────────
 *
 * Reject / alter / extra were captured per card from Change 12 and never rolled up;
 * there was no per-job cost or margin anywhere, and no on-time measure at all.
 *
 * Everything below is READ-ONLY and derived from rows that already exist. No new
 * writes, no new columns. Cost figures are gated by the caller (canSeeCost), never
 * by these functions — they return the numbers and the page decides who sees them.
 */

export type QualityByVendor = {
  vendor: string;
  cards: number;
  cut: number;
  reject: number;
  alter: number;
  extra: number;
  /** reject ÷ cut, 0 when nothing was cut. This is the number that matters. */
  rejectRate: number;
  alterRate: number;
};

/**
 * Reject/alter/extra rolled up by vendor. Quantities are attributed with the same
 * layer-vendor split the rest of the app uses, so a card cut across two vendors
 * apportions its rejects rather than blaming whoever holds the card header.
 */
export async function getQualityByVendor(range?: { from?: Date; to?: Date }): Promise<QualityByVendor[]> {
  const jobs = await db.jobCard.findMany({
    where: {
      ...POSTED,
      ...(range?.from || range?.to
        ? { orderDate: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
        : {}),
    },
    include: { vendor: { select: { name: true } }, ...LAYER_VENDOR_INCLUDE },
  });

  // Change 36 Part 3 — inspections SUPERSEDE the card-level figures. Both existing and
  // both feeding this report would double-count: JobCard.rejectQty already drives it and
  // /board. So where a card has live inspections they are the source, and the card
  // fields are read only for cards inspected the old way (legacy, and still valid).
  const inspections = await db.inspection.groupBy({
    by: ["jobCardId"],
    where: { voidedAt: null },
    _sum: { rejectQty: true, reworkQty: true },
  });
  const inspected = new Map(inspections.map((i) => [i.jobCardId, { reject: i._sum.rejectQty ?? 0, rework: i._sum.reworkQty ?? 0 }]));

  const acc = new Map<string, QualityByVendor>();
  for (const j of jobs) {
    const insp = inspected.get(j.id);
    const reject = insp ? insp.reject : (j.rejectQty ?? 0);
    // Rework is the inspection-era equivalent of "alter": pieces that come back rather
    // than being written off.
    const alter = insp ? insp.rework : (j.alterQty ?? 0);
    const extra = j.extraQty ?? 0;
    for (const s of splitByLayerVendor(j)) {
      const g =
        acc.get(s.vendor) ??
        acc.set(s.vendor, { vendor: s.vendor, cards: 0, cut: 0, reject: 0, alter: 0, extra: 0, rejectRate: 0, alterRate: 0 }).get(s.vendor)!;
      g.cards += 1;
      g.cut += s.cutQty;
      // `share` is this vendor's fraction of the card, so quality figures recorded
      // at card level apportion the same way the cut quantity does.
      g.reject += reject * s.share;
      g.alter += alter * s.share;
      g.extra += extra * s.share;
    }
  }

  return [...acc.values()]
    .map((g) => ({
      ...g,
      reject: Math.round(g.reject * 100) / 100,
      alter: Math.round(g.alter * 100) / 100,
      extra: Math.round(g.extra * 100) / 100,
      rejectRate: g.cut > 0 ? g.reject / g.cut : 0,
      alterRate: g.cut > 0 ? g.alter / g.cut : 0,
    }))
    .filter((g) => g.reject > 0 || g.alter > 0 || g.extra > 0)
    .sort((a, b) => b.rejectRate - a.rejectRate);
}

export type OnTime = {
  vendor: string;
  /** Cards that both carry a plannedEtd and have actually been dispatched. */
  measured: number;
  onTime: number;
  rate: number;
  avgDaysLate: number;
};

export type OnTimeSummary = { measured: number; onTime: number; rate: number; byVendor: OnTime[] };

/**
 * On-time delivery: plannedEtd vs the LAST non-voided dispatch on the card.
 *
 * Only cards with both a planned date and a dispatch are measured — an undispatched
 * card is late-in-progress, not a delivery miss, and counting it would make the rate
 * drift with the size of the order book rather than with performance.
 */
export async function getOnTimeDelivery(range?: { from?: Date; to?: Date }): Promise<OnTimeSummary> {
  const jobs = await db.jobCard.findMany({
    where: {
      ...POSTED,
      plannedEtd: { not: null },
      ...(range?.from || range?.to
        ? { plannedEtd: { not: null, ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
        : {}),
    },
    include: {
      vendor: { select: { name: true } },
      ...LAYER_VENDOR_INCLUDE,
      // separate from LAYER_VENDOR_INCLUDE's dispatches: this one needs the date
      dispatches: { where: { voidedAt: null }, select: { qty: true, date: true, layers: { select: { id: true } } } },
    },
  });

  const acc = new Map<string, OnTime>();
  let measured = 0;
  let onTime = 0;

  for (const j of jobs) {
    if (!j.plannedEtd || j.dispatches.length === 0) continue;
    const last = j.dispatches.reduce((m, d) => (d.date > m ? d.date : m), j.dispatches[0].date);
    const daysLate = Math.max(0, Math.floor((last.getTime() - j.plannedEtd.getTime()) / 86_400_000));
    const hit = last <= j.plannedEtd;
    measured += 1;
    if (hit) onTime += 1;

    for (const s of splitByLayerVendor(j)) {
      const g = acc.get(s.vendor) ?? acc.set(s.vendor, { vendor: s.vendor, measured: 0, onTime: 0, rate: 0, avgDaysLate: 0 }).get(s.vendor)!;
      g.measured += 1;
      if (hit) g.onTime += 1;
      g.avgDaysLate += daysLate;
    }
  }

  const byVendor = [...acc.values()]
    .map((g) => ({
      ...g,
      rate: g.measured > 0 ? g.onTime / g.measured : 0,
      avgDaysLate: g.measured > 0 ? Math.round((g.avgDaysLate / g.measured) * 10) / 10 : 0,
    }))
    .sort((a, b) => a.rate - b.rate);

  return { measured, onTime, rate: measured > 0 ? onTime / measured : 0, byVendor };
}

export type JobMargin = {
  jobCardId: number;
  siNo: string;
  item: string;
  vendor: string;
  cutQty: number;
  dispatchedQty: number;
  fabricCost: number;
  trimCost: number;
  finishingCost: number;
  cost: number;
  /** MRP × dispatched. MRP is a retail price, so this is an indicative value only. */
  value: number;
  margin: number;
  marginPct: number;
};

/**
 * Per-job cost, value and margin. OWNER-ONLY — every caller must gate on canSeeCost.
 *
 * Cost is what we can actually evidence, in this order:
 *   fabric + trims — Σ (locked, non-voided inward challan line qty × its rate) for
 *                    challans raised against the card. Rate lives on the challan
 *                    line because that is the price actually paid, not the master's
 *                    estimate (Change 18 D).
 *   finishing      — Σ (FinishingJob.rate × qtyBack) from Change 20's JW- documents.
 *
 * Value is mrp × dispatchedQty. A card with no MRP or nothing dispatched yields a
 * zero value and is reported with its cost, rather than being silently dropped.
 */
export async function getJobMargins(range?: { from?: Date; to?: Date; jobCardId?: number }): Promise<JobMargin[]> {
  const jobs = await db.jobCard.findMany({
    where: {
      ...POSTED,
      ...(range?.jobCardId ? { id: range.jobCardId } : {}),
      ...(range?.from || range?.to
        ? { orderDate: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
        : {}),
    },
    include: {
      vendor: { select: { name: true } },
      product: { select: { name: true, mrp: true } },
      materialChallans: {
        where: { status: "LOCKED", voidedAt: null, direction: "INWARD" },
        select: { lines: { select: { qty: true, rate: true, fabricId: true, trimItemId: true } } },
      },
      finishingJobs: { select: { rate: true, qtyBack: true, qtyOut: true } },
    },
  });

  const out: JobMargin[] = [];
  for (const j of jobs) {
    let fabricCost = 0;
    let trimCost = 0;
    for (const c of j.materialChallans) {
      for (const l of c.lines) {
        if (l.rate == null) continue;
        const amount = l.qty * l.rate;
        if (l.fabricId != null) fabricCost += amount;
        else if (l.trimItemId != null) trimCost += amount;
      }
    }
    const finishingCost = j.finishingJobs.reduce(
      (a, f) => a + (f.rate ?? 0) * (f.qtyBack || f.qtyOut || 0),
      0,
    );

    const mrp = j.mrp ?? j.product?.mrp ?? j.customMrp ?? null;
    const value = mrp != null ? mrp * j.dispatchedQty : 0;
    const cost = Math.round((fabricCost + trimCost + finishingCost) * 100) / 100;

    // Nothing evidenced either way — omit from the report, but keep the row when a
    // single card was asked for so the job-card panel can say "no cost recorded".
    if (cost === 0 && value === 0 && !range?.jobCardId) continue;

    out.push({
      jobCardId: j.id,
      siNo: j.siNo,
      item: j.product?.name ?? j.customItem ?? "—",
      vendor: j.vendor.name,
      cutQty: j.cutQty,
      dispatchedQty: j.dispatchedQty,
      fabricCost: Math.round(fabricCost * 100) / 100,
      trimCost: Math.round(trimCost * 100) / 100,
      finishingCost: Math.round(finishingCost * 100) / 100,
      cost,
      value: Math.round(value * 100) / 100,
      margin: Math.round((value - cost) * 100) / 100,
      marginPct: value > 0 ? (value - cost) / value : 0,
    });
  }

  return out.sort((a, b) => a.marginPct - b.marginPct);
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
