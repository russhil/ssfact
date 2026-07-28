import { db } from "@/lib/db";

/**
 * Change 36 Part 6 — supplier scorecards.
 *
 * ★ The score is 100% DERIVED from documents that already exist. No new data entry, no
 * new tables, no new columns. Every dimension comes from purchase orders and the inward
 * challans they were received on.
 *
 * Three judgement calls the source data forces, each of which changes the numbers:
 *
 * 1. WHICH DATE IS "DELIVERED"? MaterialChallan.date is the document date written on the
 *    paper; lockedAt is when someone keyed it in, routinely days later. We use `date` —
 *    the supplier is judged on when the goods arrived, not on our data entry.
 *
 * 2. ON-TIME ON WHICH RECEIPT? FabricOrder.receivedDate is NOT the delivery date for a
 *    split delivery: lockChallan writes `receivedDate ?? now` and flips status to
 *    RECEIVED on the FIRST locked challan, so a PO 20% delivered on time and 80% a month
 *    late would read as on time. We score on FULL receipt — the date the last challan
 *    that completes the ordered quantity arrived — and treat a still-short PO as not yet
 *    delivered rather than silently on-time.
 *
 * 3. VOIDED CHALLANS. A reversed receipt is not a receipt; those are excluded.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86400000;

export type SupplierScore = {
  supplierId: number;
  name: string;
  /** Orders that reached full receipt in the period. */
  completed: number;
  /** Orders still open or short. */
  open: number;
  /** Share of completed orders received on or before expectedDate. Null when none. */
  onTimeRate: number | null;
  /** Mean days from orderDate to full receipt. Null when unknown. */
  avgLeadDays: number | null;
  /** Received ÷ ordered across every order touched, so a chronic short-shipper shows. */
  fillRate: number | null;
  /** Last rate vs the mean of the 3 before it. Negative = getting cheaper. */
  priceTrend: number | null;
  lastRate: number | null;
  /**
   * Null until Part 8 lands. Part 3 knows the fabric rejects; nothing yet ties a reject
   * back to the supplier whose roll caused it. See the note in getSupplierScores.
   */
  qualityRejects: number | null;
};

type OrderLike = {
  id: number;
  supplierId: number | null;
  qty: number;
  rate: number | null;
  orderDate: Date | null;
  expectedDate: Date | null;
  challans: { status: string; date: Date; lines: { qty: number }[] }[];
};

/**
 * The date the order was fully received, and how much arrived.
 * Returns receivedOn = null while the order is still short — an incomplete delivery is
 * not an on-time one.
 */
function receipt(o: OrderLike): { receivedQty: number; receivedOn: Date | null } {
  const locked = o.challans
    .filter((c) => c.status === "LOCKED")
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  let running = 0;
  let receivedOn: Date | null = null;
  for (const c of locked) {
    running += c.lines.reduce((a, l) => a + l.qty, 0);
    if (receivedOn == null && o.qty > 0 && running >= o.qty - 0.001) receivedOn = c.date;
  }
  return { receivedQty: r2(running), receivedOn };
}

function scoreFrom(
  supplierId: number,
  name: string,
  orders: OrderLike[],
  rateHistory: number[],
  qualityRejects: number | null
): SupplierScore {
  let completed = 0;
  let open = 0;
  let onTime = 0;
  let leadTotal = 0;
  let leadCount = 0;
  let ordered = 0;
  let received = 0;

  for (const o of orders) {
    const { receivedQty, receivedOn } = receipt(o);
    ordered += o.qty;
    received += Math.min(receivedQty, o.qty || receivedQty);

    if (receivedOn) {
      completed++;
      if (o.expectedDate && receivedOn.getTime() <= o.expectedDate.getTime()) onTime++;
      if (o.orderDate) {
        leadTotal += Math.max(0, Math.round((receivedOn.getTime() - o.orderDate.getTime()) / DAY));
        leadCount++;
      }
    } else {
      open++;
    }
  }

  // Price trend: the latest rate against the mean of the three before it. Fewer than two
  // data points is not a trend, so it stays null rather than reading 0%.
  let priceTrend: number | null = null;
  const lastRate = rateHistory.length ? rateHistory[rateHistory.length - 1] : null;
  if (rateHistory.length >= 2) {
    const prior = rateHistory.slice(Math.max(0, rateHistory.length - 4), rateHistory.length - 1);
    const mean = prior.reduce((a, b) => a + b, 0) / prior.length;
    if (mean > 0 && lastRate != null) priceTrend = r2((lastRate - mean) / mean);
  }

  return {
    supplierId,
    name,
    completed,
    open,
    onTimeRate: completed > 0 ? onTime / completed : null,
    avgLeadDays: leadCount > 0 ? Math.round(leadTotal / leadCount) : null,
    fillRate: ordered > 0 ? Math.min(1, received / ordered) : null,
    priceTrend,
    lastRate,
    qualityRejects,
  };
}

const ORDER_SELECT = {
  id: true,
  supplierId: true,
  qty: true,
  rate: true,
  orderDate: true,
  expectedDate: true,
  // A reversed receipt is not a receipt.
  challans: { where: { voidedAt: null }, select: { status: true, date: true, lines: { select: { qty: true } } } },
} as const;

function inPeriod(range?: { from?: Date; to?: Date }) {
  if (!range?.from && !range?.to) return {};
  return {
    orderDate: {
      ...(range?.from ? { gte: range.from } : {}),
      ...(range?.to ? { lte: range.to } : {}),
    },
  };
}

/**
 * Every supplier's score in ONE pass. A per-supplier query across ~26 suppliers on every
 * /suppliers render is an N+1; getDelayedOrders and getQualityByVendor already avoid it
 * the same way — fetch wide, group in memory.
 */
export async function getSupplierScores(range?: { from?: Date; to?: Date }): Promise<SupplierScore[]> {
  const where = { supplierId: { not: null }, ...inPeriod(range) };
  const [suppliers, fabricOrders, trimOrders, fabricRates] = await Promise.all([
    db.supplier.findMany({ select: { id: true, name: true } }),
    db.fabricOrder.findMany({ where, select: ORDER_SELECT }),
    db.trimOrder.findMany({ where, select: ORDER_SELECT }),
    db.fabricSupplier.findMany({
      where: { supplierId: { not: null }, rate: { not: null } },
      orderBy: { sourcedAt: "asc" },
      select: { supplierId: true, rate: true },
    }),
  ]);

  const byOrders = new Map<number, OrderLike[]>();
  for (const o of [...fabricOrders, ...trimOrders] as OrderLike[]) {
    if (o.supplierId == null) continue;
    const list = byOrders.get(o.supplierId) ?? [];
    list.push(o);
    byOrders.set(o.supplierId, list);
  }

  const byRates = new Map<number, number[]>();
  for (const r of fabricRates) {
    if (r.supplierId == null || r.rate == null) continue;
    const list = byRates.get(r.supplierId) ?? [];
    list.push(r.rate);
    byRates.set(r.supplierId, list);
  }

  // Quality stays null, deliberately. Part 3 records FABRIC-category rejects, but a
  // reject cannot be attributed to the supplier who sold the roll until Part 8 puts a lot
  // number on the inward line and the layer that consumed it. Reporting a factory-wide
  // reject count against every supplier alike would be worse than reporting nothing.
  return suppliers
    .map((s) => scoreFrom(s.id, s.name, byOrders.get(s.id) ?? [], byRates.get(s.id) ?? [], null))
    .filter((s) => s.completed > 0 || s.open > 0)
    .sort((a, b) => (b.onTimeRate ?? -1) - (a.onTimeRate ?? -1));
}

export async function getSupplierScore(supplierId: number, range?: { from?: Date; to?: Date }): Promise<SupplierScore | null> {
  const all = await getSupplierScores(range);
  return all.find((s) => s.supplierId === supplierId) ?? null;
}

export type SourceOption = {
  supplierId: number;
  name: string;
  lastRate: number | null;
  onTimeRate: number | null;
  /** Recent rates, newest last — the "last 3: ₹142, ₹138, ₹145" line. */
  history: number[];
};

/**
 * Who can supply this fabric, best first. Ranked on on-time rate and then price, because
 * a cheap supplier who never delivers on time costs more than the rate saves.
 */
export async function getBestSources(fabricId: number): Promise<SourceOption[]> {
  const [rows, scores] = await Promise.all([
    db.fabricSupplier.findMany({
      where: { fabricId, supplierId: { not: null } },
      orderBy: { sourcedAt: "asc" },
      select: { supplierId: true, rate: true, supplier: { select: { id: true, name: true } } },
    }),
    getSupplierScores(),
  ]);

  const byId = new Map<number, SourceOption>();
  for (const r of rows) {
    if (!r.supplier) continue;
    const o = byId.get(r.supplier.id) ?? { supplierId: r.supplier.id, name: r.supplier.name, lastRate: null, onTimeRate: null, history: [] };
    if (r.rate != null) {
      o.history.push(r.rate);
      o.lastRate = r.rate;
    }
    byId.set(r.supplier.id, o);
  }
  for (const o of byId.values()) {
    o.onTimeRate = scores.find((s) => s.supplierId === o.supplierId)?.onTimeRate ?? null;
    o.history = o.history.slice(-3);
  }
  return [...byId.values()].sort(
    (a, b) => (b.onTimeRate ?? -1) - (a.onTimeRate ?? -1) || (a.lastRate ?? Infinity) - (b.lastRate ?? Infinity)
  );
}
