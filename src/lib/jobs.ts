import { db } from "@/lib/db";
import { isOverdue } from "@/lib/queries";
import { jobItem, jobStyle } from "@/lib/job-display";
import { LAYER_VENDOR_INCLUDE, layerVendorNames, vendorLabel, splitByLayerVendor, type VendorShare } from "@/lib/vendor-split";
import { sizeRank } from "@/lib/job-labels";
import { colorKey } from "@/lib/colour";
import { POSTED, DRAFTS_ONLY, draftLabel } from "@/lib/job-scope";

export const siSlug = (si: string) => si.replace(/\s/g, "");

/**
 * Change 19 C: a VENDOR login must see cards it is stitching, which since Change 14 means
 * cards where it owns a LAYER — not only cards where it happens to be the header vendor.
 * Scoping on the header alone 404'd a vendor out of work genuinely assigned to it.
 */
export function vendorScopeWhere(scope?: JobScope) {
  if (!scope?.vendorName) return undefined;
  return {
    OR: [{ vendor: { name: scope.vendorName } }, { layers: { some: { vendor: { name: scope.vendorName } } } }],
  };
}

// Change 26: one shared size axis (was five near-copies that disagreed).

export type JobScope = { vendorName?: string };

export type JobRow = {
  siNo: string;
  slug: string;
  item: string;
  styleNo: string;
  product: string | null;
  productId: number | null;
  /** Display label — the layer vendors ("Acme", "Acme +1"), Change 19 C. */
  vendor: string;
  /** Every vendor stitching this card; filters and search match against this. */
  vendors: string[];
  /** This card's work apportioned across its layer vendors — for vendor roll-ups. */
  split: VendorShare[];
  cutQty: number;
  dispatchedQty: number;
  balance: number;
  fill: number;
  status: string;
  overdue: boolean;
  trimsPending: boolean;
  plannedEtd: Date | null;
  orderDate: Date | null;
};

export async function getJobs(scope?: JobScope): Promise<JobRow[]> {
  const jobs = await db.jobCard.findMany({
    // Change 38 Part A: the master list is production. Drafts are fetched separately by
    // getDraftJobs so they can be shown as their own strip rather than mixed in here —
    // every other consumer of getJobs (dispatch, vendors, search) must not see them.
    where: { ...POSTED, ...vendorScopeWhere(scope) },
    include: { product: true, vendor: true, ...LAYER_VENDOR_INCLUDE },
    orderBy: { id: "desc" },
  });
  const now = new Date();
  return jobs.map((j) => {
    const vendors = layerVendorNames(j);
    return {
    siNo: j.siNo,
    slug: String(j.id),
    item: jobItem(j),
    styleNo: jobStyle(j),
    product: j.product?.name ?? null,
    productId: j.productId,
    vendor: vendorLabel(vendors),
    vendors,
    split: splitByLayerVendor(j),
    cutQty: j.cutQty,
    dispatchedQty: j.dispatchedQty,
    balance: j.cutQty - j.dispatchedQty,
    fill: j.cutQty ? j.dispatchedQty / j.cutQty : 0,
    status: j.status,
    overdue: isOverdue(j, now),
    trimsPending: (j as { trimsPending?: boolean }).trimsPending ?? false,
    plannedEtd: j.plannedEtd,
    orderDate: j.orderDate,
    };
  });
}

/**
 * Change 38 Part A — the drafts, for the strip on the board / job list / dashboard.
 *
 * Deliberately its own query rather than a flag on getJobs: every existing caller of getJobs
 * is a production view and none of them should have to remember to filter drafts out.
 *
 * A draft has no SI yet, so it names itself by what has been typed — see draftLabel.
 */
export type DraftRow = {
  id: number;
  label: string;
  cutQty: number;
  layers: number;
  updatedAt: Date | null;
};

export async function getDraftJobs(scope?: JobScope): Promise<DraftRow[]> {
  const rows = await db.jobCard.findMany({
    where: { ...DRAFTS_ONLY, ...vendorScopeWhere(scope) },
    include: { product: true, vendor: true, _count: { select: { layers: true } } },
    orderBy: { id: "desc" },
  });
  return rows.map((j) => ({
    id: j.id,
    label: draftLabel({ item: jobItem(j), vendor: j.vendor?.name ?? null }),
    cutQty: j.cutQty,
    layers: j._count.layers,
    updatedAt: (j as { updatedAt?: Date | null }).updatedAt ?? null,
  }));
}

/**
 * Change 38 Part A — reload a draft into the entry form so it can be resumed.
 *
 * The layers come back in MANUAL mode on both axes, seeded with the exact cell quantities
 * that were stored. Whether they were originally typed or filled from a ratio is not
 * persisted, and re-deriving them from the ratio could silently change a number the operator
 * had adjusted by hand — so the stored figures are shown as-is and stay editable.
 */
export async function getDraftForEdit(id: number) {
  const d = await db.jobCard.findUnique({
    where: { id },
    include: {
      layers: {
        orderBy: { layerNo: "asc" },
        include: { cells: true, colours: true, cuttingMaster: true, vendor: true },
      },
      vendor: true,
      cuttingMaster: true,
    },
  });
  if (!d || d.status !== "DRAFT") return null;
  return {
    id: d.id,
    productId: d.productId,
    productionOrderId: d.productionOrderId, // Change 39 Part C
    signatoryName: d.signatoryName, // Change 39 Part G1
    customItem: d.customItem,
    customSku: d.customSku,
    customStyle: d.customStyle,
    vendor: d.vendor?.name ?? "",
    master: d.cuttingMaster?.name ?? "",
    stage: d.stage as string,
    plannedEtd: d.plannedEtd ? d.plannedEtd.toISOString().slice(0, 10) : "",
    remark: d.remark ?? "",
    merchandiser: d.merchandiser ?? "",
    needsPrint: d.needsPrint,
    needsLaser: d.needsLaser,
    needsEmb: d.needsEmb,
    mrp: d.mrp,
    layers: d.layers.map((l) => {
      let ratio: [string, number][] = [];
      try {
        ratio = l.sizeRatio ? (JSON.parse(l.sizeRatio) as [string, number][]) : [];
      } catch {
        ratio = [];
      }
      const sizes = [...new Set([...l.cells.map((c) => c.size), ...ratio.map(([s]) => s)])].sort(
        (a, b) => sizeRank(a) - sizeRank(b)
      );
      return {
        label: l.label ?? "",
        date: l.cutDate ? l.cutDate.toISOString().slice(0, 10) : "",
        master: l.cuttingMaster?.name ?? "",
        vendor: l.vendor?.name ?? "",
        avg: l.avgConsumption != null ? String(l.avgConsumption) : "",
        rolls: l.rolls != null ? String(l.rolls) : "",
        // Change 39 B — carry the measured lay length back into a resumed draft.
        layerLength: l.layerLength != null ? String(l.layerLength) : "",
        sizes,
        ratio: ratio.length ? ratio : sizes.map((s) => [s, 1] as [string, number]),
        cells: Object.fromEntries(l.cells.map((c) => [`${c.size}|||${c.colour}`, c.qty])),
        colours: l.colours.map((c) => ({
          colour: c.colour,
          issued: c.fabricIssued != null ? String(c.fabricIssued) : "",
          balance: c.fabricBalance != null ? String(c.fabricBalance) : "",
          bundles: c.bundles ?? null, // Change 39 B
        })),
      };
    }),
  };
}

export type DraftForEdit = NonNullable<Awaited<ReturnType<typeof getDraftForEdit>>>;

/**
 * Resolve a job card by its slug. New cards use the numeric id (so the same SI can
 * repeat across cards — Change 10, Part A); legacy bookmarks using siSlug still work.
 */
export async function getJob(slug: string, scope?: JobScope) {
  const include = {
    product: { include: { fabric: true } },
    vendor: true,
    cuttingMaster: true,
    // Change 39 G2 — who first raised the card, shown as "Prepared by".
    createdBy: { select: { displayName: true } },
    dispatches: {
      orderBy: { date: "asc" as const },
      include: { lines: true, layers: { select: { id: true, layerNo: true, label: true } } },
    },
    sizeBreakup: true,
    jobLines: { include: { trimItem: true } },
    fabricLines: { orderBy: { color: "asc" as const } },
    returnNotes: true,
    layers: {
      orderBy: { layerNo: "asc" as const },
      // Change 37: `colours` carries this lay's per-colour fabric. When present it is the
      // truth and fabricMtr/fabricIssued are its sum; when absent the lay is legacy.
      include: { cells: true, colours: true, cuttingMaster: true, vendor: true },
    },
    stitchAssignments: {
      include: { vendor: true, receipts: { orderBy: { date: "asc" as const } } },
    },
  };

  let j = /^\d+$/.test(slug)
    ? await db.jobCard.findUnique({ where: { id: Number(slug) }, include })
    : null;
  if (!j) {
    // legacy slug (siSlug of siNo) — first match
    const all = await db.jobCard.findMany({ include });
    j = all.find((x) => siSlug(x.siNo) === slug) ?? null;
  }
  if (!j) return null;
  // Change 19 C: a vendor may reach the card through a layer it owns, not just the header.
  if (
    scope?.vendorName &&
    j.vendor.name !== scope.vendorName &&
    !j.layers.some((l) => l.vendor?.name === scope.vendorName)
  )
    return null;
  j.sizeBreakup.sort(
    (a, b) => sizeRank(a.size) - sizeRank(b.size) || a.color.localeCompare(b.color)
  );
  return j;
}

/**
 * Change 38 Part E — the LIVE shared stock for every (fabric, colour) this card touches.
 *
 * `FabricColor.currentStock` is ONE scalar per (fabric, colour), shared by every card in the
 * factory. That sharing is the point: two people entering cards against the same fabric must
 * both see what is really left, so this is deliberately read fresh from the master rather
 * than snapshotted onto the card. Save a card that consumes NAVY and every other card
 * showing NAVY reflects it on its next load.
 *
 * A DRAFT card has posted nothing (Part A), so it does not appear in this number at all —
 * the card shows its own typed usage as a projection against it instead.
 */
export async function getJobFabricStock(jobCardId: number) {
  const [lines, job] = await Promise.all([
    db.jobFabricLine.findMany({ where: { jobCardId }, select: { fabricId: true } }),
    db.jobCard.findUnique({ where: { id: jobCardId }, select: { product: { select: { fabricId: true } } } }),
  ]);
  const fabricIds = [...new Set([...lines.map((l) => l.fabricId), job?.product?.fabricId].filter((x): x is number => x != null))];
  if (fabricIds.length === 0) return new Map<string, number>();
  const rows = await db.fabricColor.findMany({
    where: { fabricId: { in: fabricIds } },
    select: { fabricId: true, color: true, currentStock: true },
  });
  // Keyed on (fabricId, colour), never colour alone — two fabrics can share a colour name.
  return new Map(rows.map((r) => [`${r.fabricId}|${colorKey(r.color)}`, r.currentStock]));
}

/**
 * Change 19 A.4 — how many trims have ACTUALLY left the store for this job card.
 *
 * The BOM is a plan; the truth is the outward challan ledger. `locked` counts challans that
 * have been posted to stock, `draft` counts what's been prepared but not yet issued (shown
 * as "pending issue", never as issued). Voided challans are excluded.
 *
 * Trim movements carry no jobCardId, so this cannot come from TrimMovement — the challan
 * lines are the only job-scoped trim record.
 */
export type TrimIssueTotals = Map<number, { locked: number; draft: number }>;

export async function getJobTrimIssues(jobCardId: number): Promise<TrimIssueTotals> {
  const rows = await db.materialChallanLine.findMany({
    where: {
      trimItemId: { not: null },
      challan: { jobCardId, direction: "OUTWARD", voidedAt: null },
    },
    select: { trimItemId: true, qty: true, challan: { select: { status: true } } },
  });
  const out: TrimIssueTotals = new Map();
  for (const r of rows) {
    const key = r.trimItemId!;
    const cur = out.get(key) ?? { locked: 0, draft: 0 };
    if (r.challan.status === "LOCKED") cur.locked += r.qty;
    else cur.draft += r.qty;
    out.set(key, cur);
  }
  return out;
}

/**
 * Change 19 B — the net fabric already taken out of stock for a card, per colour
 * (Σ ISSUE − Σ RECEIPT). This is what the manually entered USED is reconciled against.
 *
 * Only createJobCard's "Cutting issue", addCuttingLayer's "Layer N issue" and the actuals
 * true-up write StockMovement rows with a jobCardId, so this net is exactly the card's own
 * consumption — challan postings deliberately carry a null jobCardId and never appear here.
 */
export async function getJobFabricPosted(jobCardId: number, fabricId: number): Promise<Map<string, number>> {
  const rows = await db.stockMovement.findMany({
    where: { fabricId, jobCardId },
    select: { type: true, qty: true, color: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    // legacy colourless movements stored null; the colour key for those is ""
    const key = r.color ?? "";
    out.set(key, (out.get(key) ?? 0) + (r.type === "ISSUE" ? r.qty : -r.qty));
  }
  return out;
}

export type MatrixCell = { colour: string; size: string; qty: number };
export type JobMatrix = {
  cells: MatrixCell[];
  byColour: { colour: string; qty: number }[];
  bySize: { size: string; qty: number }[];
  total: number;
  sizes: string[];
  colours: string[];
  cell: (colour: string, size: string) => number;
  fromLayers: boolean;
};

type MatrixInput = {
  layers?: { cells: { colour: string; size: string; qty: number }[] }[];
  sizeBreakup?: { size: string; color: string; qty: number }[];
};

/**
 * Canonical cut matrix for a job card (Change 10, Part B). When the card has cutting
 * layers, flatten + sum their cells; otherwise fall back to the legacy SizeBreakup grid.
 * Returns per-colour and per-size roll-ups plus a cell lookup, so callers never branch.
 */
export function getJobMatrix(job: MatrixInput): JobMatrix {
  const fromLayers = (job.layers?.length ?? 0) > 0;
  const raw: MatrixCell[] = fromLayers
    ? job.layers!.flatMap((l) => l.cells.map((c) => ({ colour: c.colour, size: c.size, qty: c.qty })))
    : (job.sizeBreakup ?? []).map((s) => ({ colour: s.color, size: s.size, qty: s.qty }));

  // merge duplicate (colour,size) pairs across layers
  const merged = new Map<string, MatrixCell>();
  for (const c of raw) {
    if (!c.qty) continue;
    const key = `${c.colour} ${c.size}`;
    const e = merged.get(key);
    if (e) e.qty += c.qty;
    else merged.set(key, { ...c });
  }
  const cells = [...merged.values()];

  const colOrder: string[] = [];
  const sizeSet = new Set<string>();
  const byColourMap = new Map<string, number>();
  const bySizeMap = new Map<string, number>();
  for (const c of cells) {
    if (!byColourMap.has(c.colour)) colOrder.push(c.colour);
    byColourMap.set(c.colour, (byColourMap.get(c.colour) ?? 0) + c.qty);
    sizeSet.add(c.size);
    bySizeMap.set(c.size, (bySizeMap.get(c.size) ?? 0) + c.qty);
  }
  const sizes = [...sizeSet].sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b));
  const colours = colOrder.sort((a, b) => a.localeCompare(b));
  const lookup = new Map(cells.map((c) => [`${c.colour} ${c.size}`, c.qty]));

  return {
    cells,
    byColour: colours.map((colour) => ({ colour, qty: byColourMap.get(colour) ?? 0 })),
    bySize: sizes.map((size) => ({ size, qty: bySizeMap.get(size) ?? 0 })),
    total: cells.reduce((a, c) => a + c.qty, 0),
    sizes,
    colours,
    cell: (colour, size) => lookup.get(`${colour} ${size}`) ?? 0,
    fromLayers,
  };
}
