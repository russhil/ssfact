import { db } from "@/lib/db";
import { splitByLayerVendor, LAYER_VENDOR_INCLUDE } from "@/lib/vendor-split";
import { POSTED } from "@/lib/job-scope";

/**
 * Change 36 Part 5 — every extra metre, visible.
 *
 * ★ Yield is a COMPARISON, not a new measurement. Change 19 made consumption honest
 * (actual metres per lay) and the product master already knows the standard. This is a
 * selector and a report; nothing new is captured.
 *
 * ⚠️ The spec said the standard comes from the product's fabric BOM. It does not — there
 * is no fabric BOM in this schema. `Bom` and `BomLine` are TRIM-only and no BomLine ever
 * references a Fabric. The per-piece fabric standard lives on Product.avgConsumption,
 * which createJobCard already snapshots onto JobCard.estAvg.
 *
 * Fallback order: JobCard.stdFabricPerPc → Product.avgConsumption → JobCard.estAvg.
 * CuttingLayer.avgConsumption is deliberately NOT used — the schema marks it a "faint
 * suggestion/estimate only".
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export type JobYield = {
  jobCardId: number;
  siNo: string;
  unit: string;
  cutQty: number;
  stdPerPc: number | null;
  source: "card" | "product" | "estimate" | null;
  /** stdPerPc × cutQty */
  standard: number | null;
  /** Σ CuttingLayer.fabricMtr — which Change 37 redefines as Σ of its colour rows. */
  actual: number;
  /** actual − standard. Positive = over-consumed. */
  variance: number | null;
  /**
   * standard ÷ actual. Never clamped — but NULL when actual is 0, because a card that
   * has been cut but not reconciled would otherwise read as Infinity or 100% waste.
   */
  yieldPct: number | null;
  /** No layers at all — a legacy card. Excluded from reports rather than shown as 100% waste. */
  legacy: boolean;
};

export async function getJobYield(jobCardId: number): Promise<JobYield | null> {
  const j = await db.jobCard.findUnique({
    where: { id: jobCardId },
    select: {
      id: true, siNo: true, cutQty: true, estAvg: true, stdFabricPerPc: true,
      product: { select: { avgConsumption: true, unit: true } },
      layers: { select: { fabricMtr: true } },
    },
  });
  if (!j) return null;

  const stdPerPc = j.stdFabricPerPc ?? j.product?.avgConsumption ?? j.estAvg ?? null;
  const source: JobYield["source"] =
    j.stdFabricPerPc != null ? "card" : j.product?.avgConsumption != null ? "product" : j.estAvg != null ? "estimate" : null;

  const actual = r2(j.layers.reduce((a, l) => a + (l.fabricMtr ?? 0), 0));
  const standard = stdPerPc != null ? r2(stdPerPc * j.cutQty) : null;

  return {
    jobCardId: j.id,
    siNo: j.siNo,
    // Unit is per-fabric: KG or MTR. Never assume metres.
    unit: j.product?.unit ?? "MTR",
    cutQty: j.cutQty,
    stdPerPc,
    source,
    standard,
    actual,
    variance: standard != null ? r2(actual - standard) : null,
    yieldPct: standard != null && actual > 0 ? standard / actual : null,
    legacy: j.layers.length === 0,
  };
}

export type YieldGroup = {
  key: string;
  unit: string;
  cards: number;
  standard: number;
  actual: number;
  variance: number;
  /** Over-consumption as a share of standard. */
  wastePct: number | null;
};

type Grouped = Map<string, { unit: string; cards: number; standard: number; actual: number }>;

function finish(acc: Grouped): YieldGroup[] {
  return [...acc.entries()]
    .map(([key, g]) => ({
      key,
      unit: g.unit,
      cards: g.cards,
      standard: r2(g.standard),
      actual: r2(g.actual),
      variance: r2(g.actual - g.standard),
      wastePct: g.standard > 0 ? (g.actual - g.standard) / g.standard : null,
    }))
    .sort((a, b) => (b.wastePct ?? -1) - (a.wastePct ?? -1));
}

async function yieldRows(range?: { from?: Date; to?: Date }) {
  return db.jobCard.findMany({
    where: {
      ...POSTED,
      ...(range?.from || range?.to
        ? { orderDate: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
        : {}),
    },
    select: {
      id: true, cutQty: true, estAvg: true, stdFabricPerPc: true,
      product: { select: { name: true, skuCode: true, avgConsumption: true, unit: true } },
      vendor: { select: { name: true } },
      ...LAYER_VENDOR_INCLUDE,
      // LAYER_VENDOR_INCLUDE already selects `layers` for the vendor split; widen it
      // with fabricMtr rather than declaring a second `layers` key that would clobber it.
      layers: { select: { ...LAYER_VENDOR_INCLUDE.layers.select, fabricMtr: true } },
    },
  });
}

/**
 * Wastage by vendor. Cards with no layers are EXCLUDED, not reported as total waste —
 * getJobMatrix falls back to SizeBreakup for those, and their fabric was never captured
 * per lay in the first place.
 *
 * Units are never mixed: a KG fabric and a MTR fabric under one vendor are separate rows.
 */
export async function getYieldByVendor(range?: { from?: Date; to?: Date }): Promise<YieldGroup[]> {
  const jobs = await yieldRows(range);
  const acc: Grouped = new Map();

  for (const j of jobs) {
    if (j.layers.length === 0) continue;
    const stdPerPc = j.stdFabricPerPc ?? j.product?.avgConsumption ?? j.estAvg ?? null;
    if (stdPerPc == null) continue;
    const unit = j.product?.unit ?? "MTR";
    const actual = j.layers.reduce((a, l) => a + (l.fabricMtr ?? 0), 0);
    if (actual <= 0) continue;

    for (const s of splitByLayerVendor(j as never)) {
      const key = `${s.vendor}|${unit}`;
      const g = acc.get(key) ?? { unit, cards: 0, standard: 0, actual: 0 };
      g.cards += 1;
      // `share` apportions a split card the same way the cut quantity does.
      g.standard += stdPerPc * s.cutQty;
      g.actual += actual * s.share;
      acc.set(key, g);
    }
  }
  return finish(acc).map((g) => ({ ...g, key: g.key.split("|")[0] }));
}

export async function getYieldByProduct(range?: { from?: Date; to?: Date }): Promise<YieldGroup[]> {
  const jobs = await yieldRows(range);
  const acc: Grouped = new Map();

  for (const j of jobs) {
    if (j.layers.length === 0) continue;
    const stdPerPc = j.stdFabricPerPc ?? j.product?.avgConsumption ?? j.estAvg ?? null;
    if (stdPerPc == null) continue;
    const actual = j.layers.reduce((a, l) => a + (l.fabricMtr ?? 0), 0);
    if (actual <= 0) continue;

    const unit = j.product?.unit ?? "MTR";
    const name = j.product?.name || j.product?.skuCode || "—";
    const key = `${name}|${unit}`;
    const g = acc.get(key) ?? { unit, cards: 0, standard: 0, actual: 0 };
    g.cards += 1;
    g.standard += stdPerPc * j.cutQty;
    g.actual += actual;
    acc.set(key, g);
  }
  return finish(acc).map((g) => ({ ...g, key: g.key.split("|")[0] }));
}
