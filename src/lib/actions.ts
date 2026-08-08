"use server";

import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { requireRole, hashPassword, canSeeCost as canSeeCostFor } from "@/lib/auth";
import type { SessionPayload } from "@/lib/session";
import { logAudit, computeChanges } from "@/lib/audit";
import { colorKey } from "@/lib/colour";
import { sizeKey } from "@/lib/job-labels";
import { num } from "@/lib/format";
import { getJobTrimIssues } from "@/lib/jobs";
import { notifyAfter, ownerRecipients } from "@/lib/notify";
import { getLowStockAlerts } from "@/lib/insights";
import { getJobQuality } from "@/lib/quality";
import { withIdempotency } from "@/lib/idempotency";
import { getMasterRefs, refsMessage, type MasterKind } from "@/lib/master-refs";
import { getOpenOrdersForSupplier } from "@/lib/masters";
import { revalidatePath } from "next/cache";

type BomDim = "COLOR" | "SIZE" | "FLAT";
type Tx = Prisma.TransactionClient;

/**
 * The single master-inventory ledger writer (Change 11, Part B). Both the job-card
 * fabric/trim issue path and the standalone materials challan post through this so the
 * master stock has one source of truth. IN → RECEIPT + increment, OUT → ISSUE + decrement.
 */
export async function postMaterialMovement(
  tx: Tx,
  m: {
    direction: "IN" | "OUT";
    qty: number;
    date?: Date;
    note?: string | null;
    jobCardId?: number | null;
    // fabric line
    fabricId?: number | null;
    colour?: string | null;
    // trim/accessory line
    trimItemId?: number | null;
    vendor?: string | null;
    invoice?: string | null;
    rate?: number | null;
    // Change 22 Part E: why this movement happened, on a hand stock adjustment.
    reason?: string | null;
    // Change 40 Part L — the firm this movement belongs to. Null on legacy/unattributed
    // paths, which write ONLY the all-firms total (currentStock) and no per-firm row, so
    // pre-firm behaviour is byte-for-byte unchanged. When present, the firm's child stock
    // row is upserted with the SAME delta, keeping the invariant
    // currentStock == Σ firmStocks.currentStock true. (The strict "throw when unresolvable"
    // guard is enabled once every caller + opening balances are wired — see Part L9/L10.)
    buyerId?: number | null;
  }
): Promise<void> {
  if (!m.qty || m.qty <= 0) return;
  const type = m.direction === "IN" ? "RECEIPT" : "ISSUE";
  const date = m.date ?? new Date();
  const delta = m.direction === "IN" ? { increment: m.qty } : { decrement: m.qty };
  const buyerId = m.buyerId ?? null;

  if (m.fabricId) {
    const colour = colorKey(m.colour);
    await tx.stockMovement.create({
      data: { type, qty: m.qty, date, fabricId: m.fabricId, jobCardId: m.jobCardId ?? null, color: colour, note: m.note ?? null, reason: m.reason ?? null, buyerId } as any,
    });
    const fc = await tx.fabricColor.upsert({
      where: { fabricId_color: { fabricId: m.fabricId, color: colour } },
      create: { fabricId: m.fabricId, color: colour, openingStock: 0, currentStock: 0 },
      update: {},
    });
    // all-firms total (unchanged behaviour)
    await tx.fabricColor.update({ where: { id: fc.id }, data: { currentStock: delta } });
    // per-firm balance
    if (buyerId != null) {
      await tx.fabricColorStock.upsert({
        where: { fabricColorId_buyerId: { fabricColorId: fc.id, buyerId } },
        create: { fabricColorId: fc.id, buyerId, openingStock: 0, currentStock: m.direction === "IN" ? m.qty : -m.qty },
        update: { currentStock: delta },
      });
    }
  } else if (m.trimItemId) {
    await tx.trimMovement.create({
      data: { type, qty: m.qty, date, trimItemId: m.trimItemId, vendor: m.vendor ?? null, invoice: m.invoice ?? null, rate: m.rate ?? null, note: m.note ?? null, reason: m.reason ?? null, buyerId } as any,
    });
    await tx.trimItem.update({ where: { id: m.trimItemId }, data: { currentStock: delta } });
    if (buyerId != null) {
      await tx.trimItemStock.upsert({
        where: { trimItemId_buyerId: { trimItemId: m.trimItemId, buyerId } },
        create: { trimItemId: m.trimItemId, buyerId, openingStock: 0, currentStock: m.direction === "IN" ? m.qty : -m.qty },
        update: { currentStock: delta },
      });
    }
  }
}

/**
 * Change 37 — the ONLY place a job card's fabric stock is driven, for one
 * (fabric, jobCard, colour) triple.
 *
 * Change 19 Part B established the rule and it is unchanged: net the movements for the
 * triple and post whatever delta makes that net equal USED — in BOTH directions, NEVER
 * clamped. Negative stock is allowed because it is real over-cut. The old code returned
 * Math.max(0, issued − used), which clamped: when a lay was over-cut the net stayed
 * parked at the issued ESTIMATE and the extra fabric consumed was never deducted.
 * Owner's rule: "It should not look at issued. It should always look at the manually
 * filled one which is USED."
 *
 * What Change 37 adds is that this is now a FUNCTION with several callers rather than a
 * block inlined in recordFabricActuals. addCuttingLayer used to blindly APPEND an OUT
 * movement, so it and the actuals form were two writers stacking on one net — which is
 * exactly why updateCuttingLayer was forbidden from posting at all ("posting here too
 * would double-count the lay"). Netting is idempotent by construction: re-running with
 * the same `used` computes delta 0 and posts nothing. So every caller converges on the
 * same target instead of stacking, and the hazard that comment protected against stops
 * being possible.
 *
 * Returns the delta posted: > 0 deducted more (over-cut), < 0 gave stock back, 0 no-op.
 */
async function reconcileJobFabricColour(
  tx: Tx,
  a: { fabricId: number; jobCardId: number; siNo: string; colour: string; used: number; reason: string; buyerId?: number | null }
): Promise<number> {
  // Change 40 Part L — the netting is keyed on (fabricId, jobCardId, colour). jobCardId is in
  // that key and a card belongs to exactly one firm, so the groupBy is ALREADY single-firm and
  // cannot net one firm's over-cut against another's. What must carry the firm is the posted
  // delta below (a.buyerId = the card's firm), so it lands in the right FabricColorStock row.
  // We deliberately do NOT add buyerId to the groupBy where: an active card that gets a firm
  // after having pre-firm (null) movements would otherwise have those excluded and net wrong.
  const key = colorKey(a.colour);
  const agg = await tx.stockMovement.groupBy({
    by: ["type"],
    where: {
      fabricId: a.fabricId,
      jobCardId: a.jobCardId,
      // legacy colourless movements were stored as null; colorKey("") === ""
      ...(key === "" ? { OR: [{ color: "" }, { color: null }] } : { color: key }),
    },
    _sum: { qty: true },
  });
  const sumOf = (t: string) => agg.find((x) => x.type === t)?._sum.qty ?? 0;
  const postedSoFar = sumOf("ISSUE") - sumOf("RECEIPT");

  const raw = (a.used ?? 0) - postedSoFar;
  const delta = Math.abs(raw) < 0.005 ? 0 : Math.round(raw * 100) / 100;
  if (delta === 0) return 0;

  await postMaterialMovement(tx, {
    direction: delta > 0 ? "OUT" : "IN",
    qty: Math.abs(delta),
    date: new Date(),
    fabricId: a.fabricId,
    colour: key,
    jobCardId: a.jobCardId,
    buyerId: a.buyerId ?? null,
    note: `${delta > 0 ? a.reason : "Return"} ${a.siNo} · ${key || "—"}`,
  });
  return delta;
}

/**
 * Change 37 — a layer's fabric, per colour, when the lay carries CuttingLayerColour rows.
 * Returns null for a legacy layer (no colour rows), which is the signal to fall back to
 * the old proportional split.
 */
function layerColourUsed(layer: { colours?: { colour: string; fabricUsed: number | null }[] }): Map<string, number> | null {
  const rows = layer.colours ?? [];
  if (rows.length === 0) return null;
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.fabricUsed == null) continue;
    const k = colorKey(r.colour);
    out.set(k, (out.get(k) ?? 0) + r.fabricUsed);
  }
  return out.size > 0 ? out : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Change 38 Part B — what the floor actually types on a lay is ISSUED (metres given out) and
 * BALANCE (metres left on the table). USED is the number we derive: issued − balance.
 *
 * Change 37 had it the other way round (issued + used typed, balance derived). Only which
 * column is typed changed; `fabricUsed` is still STORED, because layerColourUsed →
 * reconcileJobFabricColour and recordFabricActuals all drive the ledger from USED. That is
 * what keeps this a write-time substitution with no ledger logic touched.
 *
 * Canonicalises the colour, sums duplicate rows, and drops any colour where neither figure
 * was typed — a blank colour posts nothing, exactly as before. Never clamped: a balance above
 * issued yields a negative USED, which the card shows in red rather than silently swallowing.
 */
// Change 39 Part B — bundles ride on the same per-colour row (CuttingLayerColour holds it).
export type ColourFabricInput = { colour: string; issued?: number | null; balance?: number | null; bundles?: number | null };
type ColourFabricRow = { fabricIssued: number | null; fabricBalance: number | null; fabricUsed: number | null; bundles: number | null };

function colourFabricRows(input: ColourFabricInput[] | null | undefined): Map<string, ColourFabricRow> {
  const acc = new Map<string, { issued: number | null; balance: number | null; bundles: number | null }>();
  for (const r of input ?? []) {
    const k = colorKey(r.colour);
    // Change 39 B: keep a row if it carries ANY of issued / balance / bundles.
    if (k === "" || (r.issued == null && r.balance == null && r.bundles == null)) continue;
    const prev = acc.get(k) ?? { issued: null, balance: null, bundles: null };
    acc.set(k, {
      issued: r.issued == null ? prev.issued : (prev.issued ?? 0) + r.issued,
      balance: r.balance == null ? prev.balance : (prev.balance ?? 0) + r.balance,
      bundles: r.bundles == null ? prev.bundles : (prev.bundles ?? 0) + Math.round(r.bundles),
    });
  }
  const out = new Map<string, ColourFabricRow>();
  for (const [k, v] of acc) {
    out.set(k, {
      fabricIssued: v.issued,
      fabricBalance: v.balance,
      // USED stays derived from issued/balance only; a bundles-only row has no fabric figure.
      fabricUsed: v.issued == null && v.balance == null ? null : round2((v.issued ?? 0) - (v.balance ?? 0)),
      bundles: v.bundles,
    });
  }
  return out;
}

/** Σ of one column across the colour rows; null when nothing was typed for it. */
function sumColourFabric(rows: Map<string, ColourFabricRow>, k: keyof ColourFabricRow): number | null {
  const vals = [...rows.values()].map((v) => v[k]).filter((v): v is number => v != null);
  return vals.length ? round2(vals.reduce((a, b) => a + b, 0)) : null;
}

/** Find-or-create a cutting master by name inside a transaction. */
async function resolveCuttingMaster(tx: Tx, name: string): Promise<number> {
  const cm =
    (await tx.cuttingMaster.findUnique({ where: { name: name.trim() } })) ??
    (await tx.cuttingMaster.create({ data: { name: name.trim() } }));
  return cm.id;
}

/** Resolve a vendor id by name (Change 14 per-layer vendor); null when blank/unknown. */
async function resolveVendorId(tx: Tx, name: string | null | undefined): Promise<number | null> {
  const n = name?.trim();
  if (!n) return null;
  const v = await tx.vendor.findUnique({ where: { name: n } });
  return v?.id ?? null;
}

// One cutting layer (lay) at create time (Change 10, Part B/C/D).
export type NewJobLayerInput = {
  label?: string | null;
  cutDate?: string | null;
  cuttingMaster?: string | null;
  vendorName?: string | null; // Change 14: this layer's stitching vendor (defaults to the card vendor)
  avgConsumption?: number | null;
  rolls?: number | null;
  fabricMtr?: number | null; // Fabric USED
  fabricBalance?: number | null;
  fabricIssued?: number | null; // Change 17 A: Fabric ISSUED (Extra = issued − used, derived)
  sizeRatio?: string | null; // Change 17 B: this lay's own size ratio JSON
  layerLength?: number | null; // Change 39 B: measured lay length (metres); avg/pc derived on read
  cells: { colour: string; size: string; qty: number }[];
  // Change 37: fabric per colour on this lay. When present it REPLACES the proportional
  // split for those colours — the ledger is driven to USED, not an estimate.
  // Change 38 Part B: issued + balance are typed, USED is derived (see colourFabricRows).
  fabricByColour?: ColourFabricInput[] | null;
};

export type NewJobInput = {
  // catalogue product OR a made-to-order free-text item (Change 12, Part D) — one is required
  productId?: number | null;
  customItem?: string | null;
  customSku?: string | null;
  customStyle?: string | null;
  customMrp?: number | null;
  // reuse an existing SI when adding a vendor split / re-cut (Change 12, Part F); else auto-assigned
  siNo?: string | null;
  // Change 39 Part C — the production order this card cuts against (optional link).
  productionOrderId?: number | null;
  // Change 39 Part G1 — authorised signatory (firm contact name; never the login user).
  signatoryName?: string | null;
  // Change 40 Part L2 — the firm (own factory) this card belongs to; it consumes only this
  // firm's stock. Required in the UI, defaulted from the logged-in user's home firm.
  buyerId?: number | null;
  vendorName: string;
  cuttingMaster?: string;
  // legacy single-grid entry (kept for back-compat); new cards send `layers` instead
  matrix?: { size: string; color: string; qty: number }[];
  // multi-layer cutting (Change 10) — the order total sums across all layers
  layers?: NewJobLayerInput[];
  // per-colour fabric overrides (assumed avg / GSM / roll width); blank ⇒ inherit defaults
  fabricLines?: { color: string; estAvg?: number | null; gsm?: number | null; rollWidth?: number | null }[];
  // fabric-detail plan per colour (Change 10, Part F)
  fabricDetail?: { colour: string; reqPcs?: number | null; reqMtr?: number | null; rolls?: number | null; imageUrl?: string | null }[];
  // edited trim sheet (Change 02); omit to fall back to the product's preset BOM
  bomLines?: { trimItemId: number | null; material: string; color?: string | null; dimension: BomDim; perPieceQty: number }[];
  // header additions (Change 10, Part E)
  needsPrint?: boolean;
  needsLaser?: boolean;
  needsEmb?: boolean;
  merchandiser?: string | null;
  mrp?: number | null;
  remark?: string;
  stage?: "FABRIC_AWAITED" | "CUTTING" | "ON_MACHINE" | "FINISHING" | "DISPATCH";
  plannedEtd?: string;
};

// Change 40 Part D — trim need is ALWAYS perPieceQty × total cutQty (every piece).
//
// The old COLOR branch (explode only against one colour's cut) is deleted, not repaired.
// In this factory the colour is baked into the trim's NAME (`120 CM NADA PLANE BLACK` vs
// `…NAVY` are different trim items), so scoping a BOM line by colour was redundant — and it
// carried two silent bugs the collapse removes for good: (1) a COLOR line with an empty
// colour box fell through to Flat with no warning (a silent 10× over/under-explosion), and
// (2) a colour-scoped line that didn't cover every cut colour silently under-ordered. Neither
// can exist once there is no colour scoping. The `dimension` column stays in the schema
// (house rule: never delete) and only FLAT is written going forward — do NOT reintroduce the
// option. `color`/`cutByColour` are kept in the signature so callers need no change.
function explodeBom(
  _dimension: BomDim,
  _color: string | null | undefined,
  perPieceQty: number,
  cutQty: number,
  _cutByColour: Map<string, { qty: number }>
): number {
  return perPieceQty * cutQty;
}

async function nextSiNo(): Promise<string> {
  const jobs = await db.jobCard.findMany({ select: { siNo: true } });
  let max = 0;
  for (const j of jobs) {
    const m = j.siNo.match(/(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `SI-${String(max + 1).padStart(2, "0")}`;
}

/**
 * Change 38 Part A — the one writer behind creating, drafting and finalising a job card.
 *
 * createJobCard was never inert: it snapshots the BOM, drives the fabric maths and posts the
 * cutting issue to the shared ledger. That is exactly why a speculative card used to be
 * refused (see the note above createSample). A DRAFT is the missing primitive — the same
 * document, written with every side effect switched off.
 *
 * `post: false` skips the JobFabricLine snapshot + postMaterialMovement loop, the JobBomLine
 * plan and the drafted trim challan, and refuses to invent a cutting master. `existingId`
 * finalises a draft in place: because that draft posted nothing, replacing its layers, cells,
 * colour rows and plan lines wholesale is safe, and the posting below then runs exactly once.
 *
 * The posting code is not duplicated anywhere — draft, create and finalise are all this.
 */
async function writeJobCard(input: NewJobInput, opts: { post: boolean; existingId?: number }) {
  const user = await requireRole("ADMIN", "STAFF");

  // A job card must reference a catalogue product OR carry a free-text custom item
  // (made-to-order, Change 12 Part D).
  const customItem = input.customItem?.trim() || null;
  const product = input.productId
    ? await db.product.findUnique({
        where: { id: input.productId },
        include: { boms: { include: { lines: true } } },
      })
    : null;
  if (input.productId && !product) throw new Error("Product not found");
  if (!product && !customItem) throw new Error("Provide a product or a custom item");

  const vendor =
    (await db.vendor.findUnique({ where: { name: input.vendorName } })) ??
    (await db.vendor.findUnique({ where: { name: "Unassigned" } }));
  if (!vendor) throw new Error('No vendor found — add the vendor, or an "Unassigned" vendor, first');

  let cuttingMasterId: number | null = null;
  if (input.cuttingMaster) {
    // Change 38 Part A: a draft only LINKS an existing master. Creating one here (which this
    // did unconditionally, and outside the transaction) meant every abandoned draft left a
    // master behind in the list. Create-if-missing belongs to the finalise path.
    const found = await db.cuttingMaster.findUnique({ where: { name: input.cuttingMaster } });
    const cm = found ?? (opts.post ? await db.cuttingMaster.create({ data: { name: input.cuttingMaster } }) : null);
    cuttingMasterId = cm?.id ?? null;
  }

  // Normalise cutting layers (Change 10): keep only cells with qty > 0.
  const layers = (input.layers ?? [])
    .map((l, i) => ({
      ...l,
      layerNo: i + 1,
      cells: l.cells
        // Change 26 E: sizes are hand-typed per lay — canonicalise like colours.
        .filter((c) => c.qty > 0 && sizeKey(c.size) !== "")
        .map((c) => ({ colour: colorKey(c.colour), size: sizeKey(c.size), qty: c.qty })),
    }))
    .filter((l) => l.cells.length > 0);
  const hasLayers = layers.length > 0;

  // The effective flat matrix: layers when present, else the legacy single grid.
  const flatMatrix = hasLayers
    ? layers.flatMap((l) => l.cells.map((c) => ({ size: c.size, color: c.colour, qty: c.qty })))
    : (input.matrix ?? []).filter((m) => m.qty > 0);
  const cutQty = flatMatrix.reduce((a, m) => a + m.qty, 0);
  const defaultAvg = product?.avgConsumption ?? null;
  const fabricId = product?.fabricId ?? null;

  // Group into per-colour cut quantities (colorKey canonical).
  const cutByColour = new Map<string, { display: string; qty: number }>();
  for (const m of flatMatrix) {
    const key = colorKey(m.color);
    const e = cutByColour.get(key) ?? { display: m.color || key, qty: 0 };
    e.qty += m.qty;
    cutByColour.set(key, e);
  }

  // Change 37 — per-colour fabric entered on the lay. Where a colour carries a real
  // figure it REPLACES the proportional split below: the derived USED is the truth.
  // Change 38 Part B — issued + balance typed, USED = issued − balance (colourFabricRows).
  const usedByColour = new Map<string, number>();
  const issuedByColour = new Map<string, number>();
  const layerColourRows = layers.map((l) => colourFabricRows(l.fabricByColour));
  for (const rows of layerColourRows) {
    for (const [colour, v] of rows) {
      if (v.fabricUsed != null) usedByColour.set(colour, (usedByColour.get(colour) ?? 0) + v.fabricUsed);
      if (v.fabricIssued != null) issuedByColour.set(colour, (issuedByColour.get(colour) ?? 0) + v.fabricIssued);
    }
  }

  // Per-colour fabric metres contributed by the layer maths (Part C). A layer's
  // fabricMtr is a lay total; split it across the layer's colours by cut proportion.
  // Skipped for any colour that carries an entered figure (Change 37).
  const mtrByColour = new Map<string, number>();
  const colourHasMtr = new Set<string>();
  for (const l of layers) {
    const layerTotal = l.cells.reduce((a, c) => a + c.qty, 0);
    if (l.fabricMtr == null || layerTotal <= 0) continue;
    const byCol = new Map<string, number>();
    for (const c of l.cells) byCol.set(c.colour, (byCol.get(c.colour) ?? 0) + c.qty);
    for (const [col, q] of byCol) {
      if (usedByColour.has(col) || issuedByColour.has(col)) continue;
      mtrByColour.set(col, (mtrByColour.get(col) ?? 0) + l.fabricMtr * (q / layerTotal));
      colourHasMtr.add(col);
    }
  }

  // Per-colour fabric overrides + fabric-detail plan, keyed by colour.
  const overrides = new Map((input.fabricLines ?? []).map((l) => [colorKey(l.color), l]));
  const detailByColour = new Map((input.fabricDetail ?? []).map((d) => [colorKey(d.colour), d]));

  // Per-colour fabric plan (only when the product has a fabric). Issue = summed layer
  // fabric-mtr when the layers carry maths, else the avg × cut estimate (agreed rule).
  const fabricPlan = fabricId
    ? [...cutByColour.entries()].map(([key, { qty }]) => {
        const ov = overrides.get(key);
        const detail = detailByColour.get(key);
        const lineAvg = ov?.estAvg ?? defaultAvg;
        // Change 37: an entered per-colour figure wins over both the split and the avg.
        const entIssued = issuedByColour.get(key) ?? null;
        const entUsed = usedByColour.get(key) ?? null;
        const qtyIssued =
          entIssued != null || entUsed != null
            ? Math.round(((entIssued ?? entUsed) as number) * 100) / 100
            : colourHasMtr.has(key)
              ? Math.round((mtrByColour.get(key) ?? 0) * 100) / 100
              : lineAvg != null
                ? Math.round(qty * lineAvg * 100) / 100
                : null;
        const qtyUsed = entUsed != null ? Math.round(entUsed * 100) / 100 : null;
        return {
          key,
          cutQty: qty,
          estAvg: lineAvg,
          qtyUsed,
          gsm: ov?.gsm ?? null,
          rollWidth: ov?.rollWidth ?? null,
          qtyIssued,
          reqPcs: detail?.reqPcs ?? null,
          reqMtr: detail?.reqMtr ?? null,
          rolls: detail?.rolls ?? null,
          imageUrl: detail?.imageUrl ?? null,
        };
      })
    : [];
  const estFabric = fabricPlan.length
    ? fabricPlan.reduce((a, l) => a + (l.qtyIssued ?? 0), 0)
    : defaultAvg != null
      ? cutQty * defaultAvg
      : null;

  // Build the trim sheet from the edited lines (fall back to the product preset).
  const presetLines = product?.boms.flatMap((b) => b.lines) ?? [];
  const rawBom =
    input.bomLines && input.bomLines.length
      ? input.bomLines
      : presetLines.map((l) => ({
          trimItemId: l.trimItemId,
          material: l.material,
          color: l.color,
          dimension: ((l.dimension ?? "FLAT") as BomDim),
          perPieceQty: l.perPieceQty ?? l.qty ?? 0,
        }));
  // Change 17 Part D: roll "applies to" (dimension) + per-piece average up from the Trim
  // Master when the BOM line doesn't carry them — single source of truth, no re-entry on
  // the job card. If the line supplies its own per-piece qty, trust its dimension; when the
  // figure comes from the master, use the master's "applies to" too.
  const bomTrimIds = [...new Set(rawBom.map((l) => l.trimItemId).filter((x): x is number => x != null))];
  const bomTrims = bomTrimIds.length
    ? await db.trimItem.findMany({
        where: { id: { in: bomTrimIds } },
        // `unit` feeds the auto-drafted outward trim challan (Change 19 A.2).
        select: { id: true, currentStock: true, dimension: true, perPieceAvg: true, unit: true },
      })
    : [];
  const trimById = new Map(bomTrims.map((t) => [t.id, t]));

  const bomPlan = rawBom.map((l) => {
    const master = l.trimItemId != null ? trimById.get(l.trimItemId) : undefined;
    const hasLinePerPiece = !!(l.perPieceQty && l.perPieceQty > 0);
    const perPieceQty = hasLinePerPiece ? l.perPieceQty! : master?.perPieceAvg ?? 0;
    const dimension = (hasLinePerPiece
      ? l.dimension
      : (master?.dimension as BomDim | undefined) ?? l.dimension ?? "FLAT") as BomDim;
    return {
      trimItemId: l.trimItemId ?? null,
      material: l.material,
      color: l.color ?? null,
      dimension,
      perPieceQty,
      requiredQty: explodeBom(dimension, l.color, perPieceQty, cutQty, cutByColour),
    };
  });
  // Flag shortage (trimsPending) against current stock BEFORE depletion.
  const trimStock = new Map(bomTrims.map((t) => [t.id, t.currentStock]));
  const trimsPending = bomPlan.some((l) => l.trimItemId != null && l.requiredQty > (trimStock.get(l.trimItemId) ?? 0));

  // MRP: only an owner may set/override it; otherwise default from the product master.
  const mrp = user.role === "ADMIN" && input.mrp != null ? input.mrp : product?.mrp ?? null;
  // custom MRP (made-to-order) is likewise owner-only.
  const customMrp = user.role === "ADMIN" ? input.customMrp ?? null : null;

  // Change 38 Part A: a draft carries no SI. nextSiNo scans every card for the max number
  // in the siNo string, so an empty one contributes nothing and the series stays gapless —
  // abandoning a draft costs no number.
  const siNo = opts.post ? input.siNo?.trim() || (await nextSiNo()) : "";
  const now = new Date();

  const job = await db.$transaction(async (tx) => {
    // Finalising a draft replaces its contents. Safe precisely because a draft posted
    // nothing: there is no ledger row keyed to these layers to orphan, and nothing to
    // reverse. Cells and colour rows go with their layer (onDelete: Cascade).
    if (opts.existingId != null) {
      await tx.cuttingLayer.deleteMany({ where: { jobCardId: opts.existingId } });
      await tx.jobBomLine.deleteMany({ where: { jobCardId: opts.existingId } });
      await tx.jobFabricLine.deleteMany({ where: { jobCardId: opts.existingId } });
      await tx.sizeBreakup.deleteMany({ where: { jobCardId: opts.existingId } });
    }
    const cardData = {
        siNo,
        orderDate: now,
        cutQty,
        dispatchedQty: 0,
        estAvg: defaultAvg,
        estFabric,
        avgConsumption: defaultAvg,
        fabricConsumed: estFabric,
        fabricIssueDate: now,
        cuttingIssuedOn: now,
        plannedEtd: input.plannedEtd ? new Date(input.plannedEtd) : null,
        status: opts.post ? "ACTIVE" : "DRAFT",
        stage: input.stage ?? "CUTTING",
        remark: input.remark ?? null,
        trimsPending,
        needsPrint: !!input.needsPrint,
        needsLaser: !!input.needsLaser,
        needsEmb: !!input.needsEmb,
        merchandiser: input.merchandiser ?? null,
        mrp,
        productId: product?.id ?? null,
        customItem: product ? null : customItem,
        customSku: product ? null : input.customSku?.trim() || null,
        customStyle: product ? null : input.customStyle?.trim() || null,
        customMrp: product ? null : customMrp,
        productionOrderId: input.productionOrderId ?? null, // Change 39 Part C
        signatoryName: input.signatoryName?.trim() || null, // Change 39 Part G1
        buyerId: input.buyerId ?? null, // Change 40 Part L2 — the card's firm
        vendorId: vendor.id,
        cuttingMasterId,
        // Layers are the source of truth for new cards; legacy grids still write SizeBreakup.
        ...(hasLayers
          ? {}
          : { sizeBreakup: { create: flatMatrix.map((m) => ({ size: m.size, color: m.color, qty: m.qty })) } }),
    };
    const created =
      opts.existingId != null
        ? await tx.jobCard.update({ where: { id: opts.existingId }, data: cardData as any })
        // Change 39 G2 — stamp the creator on INSERT only, so finalising a draft never
        // overwrites who first raised it.
        : await tx.jobCard.create({ data: { ...cardData, createdById: user.userId } as any });

    // Cutting layers + their colour×size cells (each layer may carry its own date/master/vendor).
    for (let li = 0; li < layers.length; li++) {
      const l = layers[li];
      const layerMasterId = l.cuttingMaster
        ? await resolveCuttingMaster(tx, l.cuttingMaster)
        : cuttingMasterId;
      const layerVendorId = (await resolveVendorId(tx, l.vendorName)) ?? vendor.id;
      // Change 37: when this lay carries per-colour fabric, its totals are the Σ of
      // those rows rather than a separately typed figure. Change 38 adds balance to the Σ,
      // so the layer strip can never disagree with the colour rows beneath it.
      const rows = layerColourRows[li] ?? new Map();
      const perColour = rows.size > 0;
      await tx.cuttingLayer.create({
        data: {
          jobCardId: created.id,
          layerNo: l.layerNo,
          label: l.label ?? null,
          cutDate: l.cutDate ? new Date(l.cutDate) : now,
          cuttingMasterId: layerMasterId,
          vendorId: layerVendorId,
          avgConsumption: l.avgConsumption ?? null,
          rolls: l.rolls ?? null,
          fabricMtr: perColour ? sumColourFabric(rows, "fabricUsed") : (l.fabricMtr ?? null),
          fabricBalance: perColour ? sumColourFabric(rows, "fabricBalance") : (l.fabricBalance ?? null),
          fabricIssued: perColour ? sumColourFabric(rows, "fabricIssued") : (l.fabricIssued ?? null),
          sizeRatio: l.sizeRatio ?? null,
          layerLength: l.layerLength ?? null, // Change 39 B
          cells: { create: l.cells.map((c) => ({ colour: c.colour, size: c.size, qty: c.qty })) },
          ...(perColour
            ? { colours: { create: [...rows.entries()].map(([colour, v]) => ({ colour, ...v })) } }
            : {}),
        } as any,
      });
    }

    // ── Everything below POSTS. A draft reaches none of it (Change 38 Part A): no
    // JobFabricLine snapshot, no cutting issue on the ledger, no frozen BOM plan and no
    // drafted trim challan. Saving the draft runs this block exactly once.
    if (opts.post) {
      // Per-colour fabric: snapshot a JobFabricLine, then issue through the shared ledger.
      for (const line of fabricPlan) {
        await tx.jobFabricLine.create({
          data: {
            color: line.key,
            fabricId: fabricId!,
            jobCardId: created.id,
            cutQty: line.cutQty,
            estAvg: line.estAvg,
            gsm: line.gsm,
            rollWidth: line.rollWidth,
            qtyIssued: line.qtyIssued,
            qtyUsed: line.qtyUsed,
            reqPcs: line.reqPcs,
            reqMtr: line.reqMtr,
            rolls: line.rolls,
            imageUrl: line.imageUrl,
          } as any,
        });
        // Change 37: a colour with an entered USED is driven to exactly that figure;
        // everything else keeps issuing the estimate as before.
        await postMaterialMovement(tx, {
          direction: "OUT",
          qty: line.qtyUsed ?? line.qtyIssued ?? 0,
          date: now,
          fabricId: fabricId!,
          colour: line.key,
          jobCardId: created.id,
          note: line.qtyUsed != null ? "Cutting issue · entered" : "Cutting issue",
        });
      }

      // Change 19 A.1: the frozen BOM snapshot is a PLAN, not a movement. Creating a card no
      // longer deducts trims — it used to post an OUT here, and staff ALSO raised a real
      // outward challan for the same trims, so every card double-counted. Trims now leave
      // stock in exactly one place: locking an OUTWARD challan (see the draft below).
      for (const line of bomPlan) {
        await tx.jobBomLine.create({
          data: {
            material: line.material,
            color: line.color,
            dimension: line.dimension as any,
            perPieceQty: line.perPieceQty,
            totalQty: line.requiredQty,
            requiredQty: line.requiredQty,
            issuedQty: 0,
            trimItemId: line.trimItemId,
            jobCardId: created.id,
          } as any,
        });
      }

      // Change 19 A.2: give the physical trim issue a home. The exploded BOM is drafted as an
      // OUTWARD challan against this card so staff don't re-type it — they adjust it to what
      // actually went out and lock it. THE LOCK IS THE DEDUCTION; this draft moves nothing.
      await draftTrimChallanLines(
        tx,
        created.id,
        vendor.id,
        siNo,
        bomPlan
          .filter((l) => l.trimItemId != null && l.requiredQty > 0)
          .map((l) => ({
            trimItemId: l.trimItemId!,
            qty: l.requiredQty,
            unit: trimById.get(l.trimItemId!)?.unit ?? null,
            note: [l.material, l.color].filter(Boolean).join(" · ") || null,
          }))
      );
    }

    // Change 16 Part F: card-level stitch assignments retired — vendor lives on the
    // cutting layer (Change 14 A) and the "received" record is the dispatch (Change 14 B).

    return created;
  });

  // Change 39 Part F — a posted card that issued fabric freezes immediately.
  if (opts.post) await syncJobLock(job.id);
  revalidatePath("/");
  revalidatePath("/job-cards");
  revalidatePath("/inventory");
  revalidatePath("/trims");
  revalidatePath("/challans");
  revalidatePath("/board");
  return { slug: String(job.id), siNo: job.siNo, status: job.status as string };
}

/** Raise a job card, posting everything. The behaviour this action has always had. */
export async function createJobCard(input: NewJobInput) {
  return writeJobCard(input, { post: true });
}

/**
 * Change 38 Part A — persist an in-progress job card without posting anything.
 *
 * Called on a debounce as soon as any field is filled, so a half-entered card survives
 * someone being called away. Pass the id it returned to keep updating the same draft rather
 * than littering one per keystroke.
 */
export async function upsertDraftJobCard(input: NewJobInput & { draftId?: number | null }) {
  if (input.draftId != null) {
    const existing = await db.jobCard.findUnique({ where: { id: input.draftId }, select: { status: true } });
    if (!existing) throw new Error("That draft no longer exists");
    // Refuse to rewrite a card that has already posted — an autosave arriving late must
    // never be able to blank a live card's layers.
    if (existing.status !== "DRAFT") throw new Error("That card has already been saved");
  }
  return writeJobCard(input, { post: false, existingId: input.draftId ?? undefined });
}

/**
 * Change 38 Part A — save a draft: run the normal posting once and make it ACTIVE.
 *
 * The card takes its SI number here, so the series only ever advances for work that is real.
 */
export async function finaliseDraftJobCard(input: NewJobInput & { draftId: number }) {
  const existing = await db.jobCard.findUnique({ where: { id: input.draftId }, select: { status: true } });
  if (!existing) throw new Error("That draft no longer exists");
  if (existing.status !== "DRAFT") throw new Error("That card has already been saved");
  return writeJobCard(input, { post: true, existingId: input.draftId });
}

/**
 * Change 38 Part A — discard a draft. A hard delete: it posted nothing, so there is nothing
 * to reverse. Guarded to drafts so this can never become a back door around deleteJobCard,
 * which has real reversal work to do.
 */
export async function discardDraftJobCard(input: { id: number }) {
  const user = await requireRole("ADMIN", "STAFF");
  const card = await db.jobCard.findUnique({ where: { id: input.id }, select: { status: true } });
  if (!card) return { ok: true };
  if (card.status !== "DRAFT") throw new Error("Only a draft can be discarded — use delete for a saved card");
  await db.$transaction(async (tx) => {
    await logAudit(tx, user, {
      action: "discardDraftJobCard",
      entity: "JobCard",
      entityId: input.id,
      entityLabel: `draft #${input.id}`,
      summary: "Discarded a draft job card",
    });
    await tx.jobCard.delete({ where: { id: input.id } });
  });
  revalidatePath("/job-cards");
  revalidatePath("/board");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Change 19 A.2/A.3 — write a DRAFT OUTWARD trim challan for a job card.
 *
 * Free-text BOM lines (no trimItemId) are skipped: there's nothing to deduct, though they
 * still live on the JobBomLine snapshot. An empty line set creates no challan at all — we
 * never leave a blank document lying around.
 */
async function draftTrimChallanLines(
  tx: Tx,
  jobCardId: number,
  vendorId: number,
  siNo: string,
  lines: { trimItemId: number; qty: number; unit: string | null; note: string | null }[]
): Promise<number | null> {
  if (lines.length === 0) return null;
  const ch = await tx.materialChallan.create({
    data: {
      direction: "OUTWARD",
      status: "DRAFT",
      kind: "TRIM",
      vendorId,
      jobCardId,
      note: `Trim issue — ${siNo}`,
    } as any,
  });
  for (const l of lines) {
    await tx.materialChallanLine.create({
      data: { challanId: ch.id, trimItemId: l.trimItemId, qty: l.qty, unit: l.unit, note: l.note },
    });
  }
  return ch.id;
}

/**
 * Change 19 A.3 — raise another outward trim challan for a card mid-job ("more trims needed").
 * With `fromRemainingBom`, each line is billed down by what locked challans already issued,
 * so a top-up challan only carries the shortfall.
 */
export async function draftTrimChallanForJob(input: { jobCardId: number; fromRemainingBom?: boolean }) {
  await requireRole("ADMIN", "STAFF");
  const job = await db.jobCard.findUnique({
    where: { id: input.jobCardId },
    select: { id: true, siNo: true, vendorId: true, jobLines: { select: { trimItemId: true, material: true, color: true, requiredQty: true, totalQty: true } } },
  });
  if (!job) throw new Error("Job card not found");
  if (!job.vendorId) throw new Error("This card has no vendor — an outward challan needs one");

  const issued = await getJobTrimIssues(job.id);
  const lines = job.jobLines
    .filter((l) => l.trimItemId != null)
    .map((l) => {
      const required = l.requiredQty ?? l.totalQty ?? 0;
      const already = input.fromRemainingBom ? issued.get(l.trimItemId!)?.locked ?? 0 : 0;
      return {
        trimItemId: l.trimItemId!,
        qty: Math.round((required - already) * 100) / 100,
        note: [l.material, l.color].filter(Boolean).join(" · ") || null,
      };
    })
    .filter((l) => l.qty > 0);
  if (lines.length === 0) throw new Error("Nothing left to issue on this card's BOM");

  const units = await db.trimItem.findMany({
    where: { id: { in: lines.map((l) => l.trimItemId) } },
    select: { id: true, unit: true },
  });
  const unitById = new Map(units.map((u) => [u.id, u.unit]));

  const id = await db.$transaction((tx) =>
    draftTrimChallanLines(
      tx,
      job.id,
      job.vendorId!,
      job.siNo,
      lines.map((l) => ({ ...l, unit: unitById.get(l.trimItemId) ?? null }))
    )
  );
  revalidatePath("/challans");
  revalidatePath(`/job-cards/${job.id}`);
  return { id: id! };
}

export type FabricActualsInput = {
  jobCardId: number;
  lines: {
    color: string;
    actualAvg?: number | null;
    qtyIssued: number;
    qtyUsed: number;
    gsm?: number | null;
    rollWidth?: number | null;
  }[];
  arrangedBy?: string | null;
  challan?: string | null;
  note?: string;
  /**
   * Change 36 Part 10 — accepted for symmetry with the other queued writes, but
   * deliberately NOT recorded: this action nets the ledger to USED, so replaying it with
   * the same figures computes delta 0 and posts nothing. It is idempotent by
   * construction and a record would only add a row that changes no behaviour.
   */
  idemKey?: string | null;
};

export async function recordFabricActuals(input: FabricActualsInput) {
  await requireRole("ADMIN", "STAFF");
  const job = await db.jobCard.findUnique({
    where: { id: input.jobCardId },
    include: { product: true, fabricLines: true },
  });
  if (!job) throw new Error("Job card not found");
  const fabricId = job.product?.fabricId ?? null;

  let totalReturned = 0;
  let totalIssued = 0;

  // One transaction: `postedSoFar` is a read-then-write, so two concurrent saves would
  // otherwise both read the same net and post the delta twice.
  await db.$transaction(async (tx) => {
    for (const l of input.lines) {
      const key = colorKey(l.color);
      const existing = job.fabricLines.find((f) => colorKey(f.color) === key);
      if (existing) {
        await tx.jobFabricLine.update({
          where: { id: existing.id },
          data: {
            actualAvg: l.actualAvg ?? null,
            qtyIssued: l.qtyIssued,
            qtyUsed: l.qtyUsed,
            gsm: l.gsm ?? existing.gsm,
            rollWidth: l.rollWidth ?? existing.rollWidth,
            arrangedBy: input.arrangedBy ?? existing.arrangedBy,
            challan: input.challan ?? existing.challan,
          } as any,
        });
      } else if (fabricId) {
        await tx.jobFabricLine.create({
          data: {
            color: key, fabricId, cutQty: 0,
            estAvg: l.actualAvg ?? null, actualAvg: l.actualAvg ?? null,
            gsm: l.gsm ?? null, rollWidth: l.rollWidth ?? null,
            qtyIssued: l.qtyIssued, qtyUsed: l.qtyUsed, jobCardId: job.id,
            arrangedBy: input.arrangedBy ?? null, challan: input.challan ?? null,
          } as any,
        });
      }
      if (!fabricId) continue;

      // Change 37: the netting that used to live inline here is now the shared helper,
      // so the layer path and this form drive the same number the same way.
      const delta = await reconcileJobFabricColour(tx, {
        fabricId,
        jobCardId: job.id,
        siNo: job.siNo,
        colour: key,
        used: l.qtyUsed ?? 0,
        reason: "Actuals true-up",
        buyerId: job.buyerId, // Change 40 L — the card's firm
      });
      if (delta > 0) totalIssued += delta;
      else if (delta < 0) {
        const ret = -delta;
        // The ledger half is done; the human-facing ReturnNote is this form's own record.
        await tx.returnNote.create({
          data: { qty: ret, fabricId, jobCardId: job.id, color: key, note: input.note ?? null } as any,
        });
        totalReturned += ret;
      }
    }

    // Roll up to the job-level legacy fields for back-compat displays.
    const sum = (k: "qtyIssued" | "qtyUsed") => input.lines.reduce((a, l) => a + (l[k] ?? 0), 0);
    const avgs = input.lines.map((l) => l.actualAvg).filter((v): v is number => v != null);
    await tx.jobCard.update({
      where: { id: job.id },
      data: {
        actualAvg: avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null,
        fabricDispatched: sum("qtyIssued"),
        fabricUsed: sum("qtyUsed"),
      },
    });
  });

  revalidatePath(`/job-cards/${String(job.id)}`);
  revalidatePath("/inventory");
  return { returnQty: totalReturned, extraIssued: totalIssued };
}

export async function setJobStage(input: {
  jobCardId: number;
  stage: "FABRIC_AWAITED" | "CUTTING" | "ON_MACHINE" | "FINISHING" | "DISPATCH";
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const before = await db.jobCard.findUnique({
    where: { id: input.jobCardId },
    select: { stage: true, siNo: true },
  });
  if (!before) throw new Error("Job card not found");

  const job = await db.$transaction(async (tx) => {
    const j = await tx.jobCard.update({
      where: { id: input.jobCardId },
      data: { stage: input.stage, updatedById: user.userId },
    });
    if (before.stage !== input.stage) {
      await logAudit(tx, user, {
        action: "setJobStage",
        entity: "JobCard",
        entityId: j.id,
        entityLabel: j.siNo,
        summary: `Moved ${j.siNo} from ${before.stage} to ${input.stage}`,
        changes: { stage: { old: before.stage, new: input.stage } },
      });
    }
    return j;
  });
  revalidatePath("/board");
  revalidatePath("/job-cards");
  revalidatePath(`/job-cards/${String(job.id)}`);
  return { stage: job.stage };
}

// Optional quality/quantity capture (Change 12, Part G). null clears a value.
export async function setJobQuality(input: {
  jobCardId: number;
  rejectQty?: number | null;
  alterQty?: number | null;
  extraQty?: number | null;
}) {
  await requireRole("ADMIN", "STAFF");
  const job = await db.jobCard.update({
    where: { id: input.jobCardId },
    data: {
      rejectQty: input.rejectQty ?? null,
      alterQty: input.alterQty ?? null,
      extraQty: input.extraQty ?? null,
    },
  });
  revalidatePath("/board");
  revalidatePath(`/job-cards/${String(job.id)}`);
  return { ok: true };
}

export type NewProductionOrderInput = {
  productId: number;
  targetQty: number;
  avgMonthlySale?: number;
  urgency?: string;
  force?: boolean; // override the duplicate guard
};

async function nextOrderNo(): Promise<string> {
  const orders = await db.productionOrder.findMany({ select: { orderNo: true } });
  let max = 0;
  for (const o of orders) {
    const m = o.orderNo.match(/(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `PO-${String(max + 1).padStart(2, "0")}`;
}

/**
 * Create a production order. Enforces the owner's hard rule: never raise a second
 * active order for the same article — unless explicitly overridden.
 */
export async function createProductionOrder(input: NewProductionOrderInput) {
  await requireRole("ADMIN", "STAFF");
  const existing = await db.productionOrder.findFirst({
    where: { productId: input.productId, status: { in: ["ORDER_GIVEN", "IN_PRODUCTION"] } },
  });
  if (existing && !input.force) {
    return { duplicate: true as const, existingOrderNo: existing.orderNo, existingStatus: existing.status };
  }

  const orderNo = await nextOrderNo();
  const order = await db.productionOrder.create({
    data: {
      orderNo,
      productId: input.productId,
      orderDate: new Date(),
      targetQty: input.targetQty,
      avgMonthlySale: input.avgMonthlySale ?? null,
      status: "ORDER_GIVEN",
      urgency: input.urgency ?? null,
    },
  });

  revalidatePath("/production-orders");
  revalidatePath("/catalog");
  return { duplicate: false as const, orderNo: order.orderNo };
}

// Change 14: layers + prior dispatch for a job, for the standalone dispatch form's grid.
export async function getJobDispatchData(jobCardId: number) {
  await requireRole("ADMIN", "STAFF");
  const job = await db.jobCard.findUnique({
    where: { id: jobCardId },
    include: {
      layers: { orderBy: { layerNo: "asc" }, include: { cells: true, vendor: true } },
      dispatches: { include: { layers: { select: { id: true } } } },
    },
  });
  if (!job) throw new Error("Job card not found");
  return {
    layers: job.layers.map((l) => ({
      id: l.id, layerNo: l.layerNo, label: l.label, vendor: l.vendor?.name ?? null,
      cells: l.cells.map((c) => ({ colour: c.colour, size: c.size, qty: c.qty })),
    })),
    prior: job.dispatches.map((e) => ({ id: e.id, qty: e.qty, layerIds: e.layers.map((x) => x.id) })),
    // Change 36 Part 3: /dispatch is the SECOND surface using LayerDispatch. Wiring the
    // gate only through the job-card page would leave this one un-gated — this is the
    // easy-to-miss data path.
    quality: await (async () => {
      const q = await getJobQuality(job.id);
      return { status: q.status, openRework: q.openRework };
    })(),
  };
}

export async function addDispatch(input: {
  jobCardId: number;
  qty?: number; // legacy single-total path; ignored when `lines` are given
  date?: string;
  challan?: string;
  note?: string;
  arrangedBy?: string | null;
  reason?: "ORDER" | "SALE" | "STOCK" | "OTHER"; // Change 40 Part J — STOCK = moved to warehouse
  // Change 14 Part B: size×colour line breakup + the layers dispatched against (same vendor).
  lines?: { colour?: string | null; size: string; qty: number }[];
  layerIds?: number[];
}) {
  await requireRole("ADMIN", "STAFF");
  const job = await db.jobCard.findUnique({ where: { id: input.jobCardId } });
  if (!job) throw new Error("Job card not found");

  // Effective lines: explicit size×colour cells, else synthesize one colour-less line
  // from the legacy `qty` so old callers keep working.
  const lines = (input.lines ?? []).filter((l) => l.qty !== 0);
  const qty = lines.length ? lines.reduce((a, l) => a + l.qty, 0) : input.qty ?? 0;
  if (!lines.length && qty === 0) throw new Error("Nothing to dispatch");

  // Running balance may go negative/over (Part H) — do NOT clamp to cutQty.
  const newDispatched = job.dispatchedQty + qty;
  const closed = newDispatched >= job.cutQty && job.cutQty > 0;

  // Change 17 Part I: each dispatch gets its own DC-YYYY-NNN challan series (finished
  // garments — a different document from the raw-material CH-IN/CH-OUT series). Allocate
  // and write the event inside one transaction so the number and the row stay in sync.
  const dispatchNo = await db.$transaction(async (tx) => {
    const year = new Date().getFullYear();
    const prefix = `DC-${year}-`;
    const existing = await tx.dispatchEvent.findMany({
      where: { dispatchNo: { startsWith: prefix } },
      select: { dispatchNo: true },
    });
    const maxN = existing.reduce(
      (m, e) => Math.max(m, parseInt((e.dispatchNo ?? "").slice(prefix.length), 10) || 0),
      0
    );
    const dcNo = `${prefix}${String(maxN + 1).padStart(3, "0")}`;

    await tx.jobCard.update({
      where: { id: job.id },
      data: {
        dispatchedQty: newDispatched,
        status: closed ? "CLOSED" : job.status,
        dispatches: {
          create: [
            {
              date: input.date ? new Date(input.date) : new Date(),
              qty,
              dispatchNo: dcNo,
              challan: input.challan ?? null,
              note: input.note ?? null,
              arrangedBy: input.arrangedBy ?? null,
              reason: input.reason ?? "ORDER",
              ...(lines.length
                ? { lines: { create: lines.map((l) => ({ colour: l.colour ?? null, size: l.size, qty: l.qty })) } }
                : {}),
              ...(input.layerIds?.length
                ? { layers: { connect: input.layerIds.map((id) => ({ id })) } }
                : {}),
            } as any,
          ],
        },
      },
    });
    return dcNo;
  });

  revalidatePath("/");
  revalidatePath("/dispatch");
  revalidatePath("/board");
  revalidatePath("/job-cards");
  revalidatePath(`/job-cards/${job.id}`);

  // Change 36 Part 2 — after the transaction. A dispatch is the moment the owner most
  // wants to know about, and the one most likely to happen while nobody is at a desk.
  for (const r of await ownerRecipients()) {
    notifyAfter({
      to: r.to, template: "dispatch.done", userId: r.userId,
      entity: "DispatchEvent", entityId: dispatchNo ?? `${job.id}-${newDispatched}`,
      body: `${job.siNo} — ${num(input.qty)} pcs dispatched${dispatchNo ? ` on ${dispatchNo}` : ""}${closed ? " · card closed" : ""}`,
    });
  }
  return { siNo: job.siNo, dispatched: newDispatched, closed, dispatchNo };
}

/**
 * Append a cutting layer to an existing card (Change 10) — e.g. a later lay on its own
 * date/master. Bumps the card's cut qty and issues that layer's fabric via the shared
 * ledger (fabric-mtr split by colour, else avg × qty). Trim re-explosion is out of scope.
 */
export async function addCuttingLayer(input: {
  jobCardId: number;
  label?: string | null;
  cutDate?: string | null;
  cuttingMaster?: string | null;
  vendorName?: string | null; // Change 14: this layer's stitching vendor
  avgConsumption?: number | null;
  rolls?: number | null;
  fabricMtr?: number | null; // Fabric USED
  fabricBalance?: number | null;
  fabricIssued?: number | null; // Change 17 A: Fabric ISSUED
  sizeRatio?: string | null; // Change 17 B: this lay's own size ratio JSON
  layerLength?: number | null; // Change 39 B: measured lay length (metres)
  cells: { colour: string; size: string; qty: number }[];
  // Change 37: fabric per colour on this lay. When present it REPLACES the proportional
  // split — the ledger is driven to the entered USED per colour instead of an estimate.
  // Change 38 B: issued + balance typed, USED derived. Change 39 B: also carries bundles.
  fabricByColour?: ColourFabricInput[] | null;
  // Change 36 Part 8: which fabric lot this lay was cut from.
  fabricLotNo?: string | null;
  // Change 36 Part 10: replay key for a lay recorded offline.
  idemKey?: string | null;
}) {
  const actor = await requireRole("ADMIN", "STAFF");
  // Change 26 E: sizes are hand-typed per lay now, so canonicalise them the way colours
  // already were — otherwise " xl" and "XL" become two columns on the card forever.
  // Deliberately NOT whitelisted against SIZE_ORDER: the client does invent sizes.
  const cells = input.cells
    .filter((c) => c.qty > 0 && sizeKey(c.size) !== "")
    .map((c) => ({ colour: colorKey(c.colour), size: sizeKey(c.size), qty: c.qty }));
  if (!cells.length) throw new Error("Layer needs at least one cell");

  const job = await db.jobCard.findUnique({
    where: { id: input.jobCardId },
    include: { product: true, layers: { select: { layerNo: true } }, fabricLines: true },
  });
  if (!job) throw new Error("Job card not found");

  const fabricId = job.product?.fabricId ?? null;
  const now = new Date();
  const layerNo = job.layers.reduce((m, l) => Math.max(m, l.layerNo), 0) + 1;
  const layerTotal = cells.reduce((a, c) => a + c.qty, 0);
  const avg = input.avgConsumption ?? job.estAvg ?? job.product?.avgConsumption ?? null;

  const byCol = new Map<string, number>();
  for (const c of cells) byCol.set(c.colour, (byCol.get(c.colour) ?? 0) + c.qty);

  // Change 37 — per-colour fabric, canonicalised and summed by colour. Empty rows post
  // nothing (back-compat: a colour with no figure typed behaves as if it were absent).
  // Change 38 Part B — issued + balance typed, USED derived.
  const byColFabric = colourFabricRows(input.fabricByColour);
  const perColour = byColFabric.size > 0;
  // The layer totals stay populated for every existing read site; when colour rows are
  // given they are the SUM of those rows rather than a separately typed number.
  const layerIssued = perColour ? sumColourFabric(byColFabric, "fabricIssued") : (input.fabricIssued ?? null);
  const layerUsed = perColour ? sumColourFabric(byColFabric, "fabricUsed") : (input.fabricMtr ?? null);
  const layerBalance = perColour ? sumColourFabric(byColFabric, "fabricBalance") : (input.fabricBalance ?? null);

  await db.$transaction(async (tx) =>
    withIdempotency(tx, actor, input.idemKey, "addCuttingLayer", async () => {
    const layerMasterId = input.cuttingMaster
      ? await resolveCuttingMaster(tx, input.cuttingMaster)
      : job.cuttingMasterId;
    const layerVendorId = (await resolveVendorId(tx, input.vendorName)) ?? job.vendorId;
    await tx.cuttingLayer.create({
      data: {
        jobCardId: job.id,
        layerNo,
        label: input.label ?? null,
        cutDate: input.cutDate ? new Date(input.cutDate) : now,
        cuttingMasterId: layerMasterId,
        vendorId: layerVendorId,
        avgConsumption: input.avgConsumption ?? null,
        rolls: input.rolls ?? null,
        fabricMtr: layerUsed,
        fabricBalance: layerBalance,
        fabricIssued: layerIssued,
        fabricLotNo: input.fabricLotNo?.trim() || null,
        sizeRatio: input.sizeRatio ?? null,
        layerLength: input.layerLength ?? null, // Change 39 B
        cells: { create: cells },
        ...(perColour
          ? { colours: { create: [...byColFabric.entries()].map(([colour, v]) => ({ colour, ...v })) } }
          : {}),
      } as any,
    });

    if (fabricId) {
      for (const [col, q] of byCol) {
        const entered = byColFabric.get(col);
        // Change 37: with colour rows the entered USED is the truth; without them the
        // lay's single figure is still split across colours by cut proportion (legacy).
        const issued = perColour
          ? (entered?.fabricIssued ?? entered?.fabricUsed ?? 0)
          : input.fabricMtr != null && layerTotal > 0
            ? Math.round(input.fabricMtr * (q / layerTotal) * 100) / 100
            : avg != null
              ? Math.round(q * avg * 100) / 100
              : 0;
        const existing = job.fabricLines.find((f) => colorKey(f.color) === col);
        const usedDelta = perColour ? (entered?.fabricUsed ?? 0) : 0;
        if (existing) {
          await tx.jobFabricLine.update({
            where: { id: existing.id },
            data: {
              cutQty: (existing.cutQty ?? 0) + q,
              qtyIssued: (existing.qtyIssued ?? 0) + issued,
              ...(perColour ? { qtyUsed: (existing.qtyUsed ?? 0) + usedDelta } : {}),
            } as any,
          });
        } else {
          await tx.jobFabricLine.create({
            data: {
              color: col, fabricId, jobCardId: job.id, cutQty: q, estAvg: avg, qtyIssued: issued,
              ...(perColour ? { qtyUsed: usedDelta } : {}),
            } as any,
          });
        }

        if (perColour) {
          // NET to the card's total entered USED for this colour — never append. Two
          // writers (this and the actuals form) on one net is only safe because both
          // converge on the same target; see reconcileJobFabricColour.
          const target = ((existing?.qtyUsed ?? 0) + usedDelta);
          await reconcileJobFabricColour(tx, {
            fabricId, jobCardId: job.id, siNo: job.siNo, colour: col,
            used: target, reason: `Layer ${layerNo}`,
            buyerId: job.buyerId, // Change 40 L — the card's firm
          });
        } else {
          await postMaterialMovement(tx, {
            direction: "OUT",
            qty: issued,
            date: now,
            fabricId,
            colour: col,
            jobCardId: job.id,
            buyerId: job.buyerId, // Change 40 L
            note: `Layer ${layerNo} issue`,
          });
        }
      }
    }

    await tx.jobCard.update({ where: { id: job.id }, data: { cutQty: { increment: layerTotal } } as any });
    return { ok: true, layerNo };
    })
  );

  // Change 39 Part F — a newly added lay may carry issued fabric; keep the lock synced.
  await syncJobLock(job.id);
  revalidatePath(`/job-cards/${job.id}`);
  revalidatePath("/inventory");
  return { ok: true, layerNo };
}

// Change 16 Part F: addStitchAssignment / addStitchReceipt / removeStitchAssignment retired.
// Vendor is set on the cutting layer (Change 14 A); "received" is the dispatch (Change 14 B).
// The StitchAssignment/StitchReceipt tables + legacy rows remain (read-only in the UI).

// ── Fabric master CRUD (admin/staff) — presets, suppliers, per-colour stock ──

export async function updateFabricMaster(input: {
  fabricId: number;
  gsm?: number | null;
  rollWidth?: number | null;
  form?: "OPEN" | "TUBE" | null;
  ratePerUnit?: number | null;
}) {
  await requireRole("ADMIN", "STAFF");
  await db.fabric.update({
    where: { id: input.fabricId },
    data: {
      gsm: input.gsm ?? null,
      rollWidth: input.rollWidth ?? null,
      form: (input.form ?? null) as any,
      ratePerUnit: input.ratePerUnit ?? null,
    },
  });
  revalidatePath(`/inventory/${input.fabricId}`);
  revalidatePath("/inventory");
  return { ok: true };
}

/**
 * Change 25 Part E — set (or clear) a fabric colour's reorder trigger. Mirrors the
 * trim master's reorderLevel; null clears it so the colour stops being alerted on.
 * Not a stock movement — this changes the threshold, never the balance.
 */
export async function setFabricReorderLevel(input: { fabricColorId: number; level: number | null }) {
  const user = await requireRole("ADMIN", "STAFF");
  const c = await db.fabricColor.findUnique({
    where: { id: input.fabricColorId },
    select: { id: true, color: true, reorderLevel: true, fabricId: true, fabric: { select: { name: true } } },
  });
  if (!c) throw new Error("Fabric colour not found");
  const level = input.level != null && input.level >= 0 ? input.level : null;
  if (level === c.reorderLevel) return { ok: true, unchanged: true as const };

  await db.$transaction(async (tx) => {
    await tx.fabricColor.update({
      where: { id: c.id },
      data: { reorderLevel: level, updatedById: user.userId },
    });
    await logAudit(tx, user, {
      action: "setFabricReorderLevel",
      entity: "FabricColor",
      entityId: c.id,
      entityLabel: `${c.fabric.name} · ${c.color}`,
      summary:
        level == null
          ? `Cleared the reorder level on ${c.fabric.name} ${c.color}`
          : `Set the reorder level on ${c.fabric.name} ${c.color} to ${num(level, 2)}`,
      changes: { reorderLevel: { old: c.reorderLevel, new: level } },
      meta: { fabricId: c.fabricId },
    });
  });

  revalidatePath(`/inventory/${c.fabricId}`);
  revalidatePath("/inventory");
  revalidatePath("/");
  return { ok: true };
}

export async function addFabricColor(input: { fabricId: number; color: string; openingStock?: number }) {
  await requireRole("ADMIN", "STAFF");
  const color = colorKey(input.color);
  if (!color) throw new Error("Colour is required");
  const opening = input.openingStock ?? 0;
  await db.fabricColor.upsert({
    where: { fabricId_color: { fabricId: input.fabricId, color } },
    create: { fabricId: input.fabricId, color, openingStock: opening, currentStock: opening },
    update: {},
  });
  revalidatePath(`/inventory/${input.fabricId}`);
  revalidatePath("/inventory");
  return { ok: true };
}

export async function setFabricColorStock(input: {
  fabricColorId: number;
  openingStock?: number;
  currentStock?: number;
}) {
  await requireRole("ADMIN", "STAFF");
  const fc = await db.fabricColor.update({
    where: { id: input.fabricColorId },
    data: {
      ...(input.openingStock != null ? { openingStock: input.openingStock } : {}),
      ...(input.currentStock != null ? { currentStock: input.currentStock } : {}),
    },
  });
  revalidatePath(`/inventory/${fc.fabricId}`);
  revalidatePath("/inventory");
  return { ok: true };
}

/**
 * Add (or update) a supplier we source this fabric from, with the rate they quoted.
 * Change 18 Part D: routed through the sourcing-rate upsert so the row is keyed to the
 * REAL Supplier master — one row per (fabric, supplier), no rival identity. A hand-typed
 * name that isn't in the master yet creates the supplier rather than a loose string.
 * This is a user-driven edit, so it overwrites the stored rate.
 */
export async function addFabricSupplier(input: { fabricId: number; supplierId?: number | null; name?: string; rate?: number | null }) {
  await requireRole("ADMIN", "STAFF");
  if (!input.supplierId && !input.name?.trim()) throw new Error("Pick a supplier (or type a new name)");
  await upsertFabricSourcingRate(
    input.fabricId,
    { id: input.supplierId, name: input.name },
    input.rate ?? null,
    undefined,
    true
  );
  revalidatePath(`/inventory/${input.fabricId}`);
  return { ok: true };
}

export async function removeFabricSupplier(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  const s = await db.fabricSupplier.delete({ where: { id: input.id } });
  revalidatePath(`/inventory/${s.fabricId}`);
  return { ok: true };
}

// ── Change 02 — trim sheet: incremental issue log + preset BOM CRUD ──

/**
 * Recompute a card's `trimsPending` flag LIVE against current trim stock (Change 39 E3).
 * A card is pending if any BOM line still needs more than the trim's current stock. Shared by
 * recordTrimIssue and lockChallan, so a locked inward challan that tops up stock clears the
 * flag on the card it was raised against — not just an explicit issue.
 */
async function recomputeTrimsPending(jobCardId: number): Promise<void> {
  const jobLines = await db.jobBomLine.findMany({
    where: { jobCardId },
    select: { trimItemId: true, requiredQty: true, totalQty: true, issuedQty: true },
  });
  const trimIds = [...new Set(jobLines.map((l) => l.trimItemId).filter((x): x is number => x != null))];
  const trims = trimIds.length
    ? await db.trimItem.findMany({ where: { id: { in: trimIds } }, select: { id: true, currentStock: true } })
    : [];
  const stock = new Map(trims.map((t) => [t.id, t.currentStock]));
  const pending = jobLines.some((l) => {
    const bal = (l.requiredQty ?? l.totalQty ?? 0) - (l.issuedQty ?? 0);
    return l.trimItemId != null && bal > 0 && (l.requiredQty ?? 0) > (stock.get(l.trimItemId) ?? 0);
  });
  await db.jobCard.update({ where: { id: jobCardId }, data: { trimsPending: pending } as any });
}

// ── Change 39 Part F — edit lock ──
// A finalised card with issued material freezes its core fields. Lock is DERIVED (status ≠
// DRAFT AND (a locked challan exists OR fabric was issued on any lay/colour)); `editLockedAt`
// is the enforced gate, kept in sync with that derived state on every material-affecting
// write, preserving the first-frozen timestamp. An ADMIN "unlock for correction" nulls it;
// the next save re-stamps. Reversing all posted material (voids/removals) lifts the lock via
// the same derived check on the next sync.

const JOB_LOCK_SELECT = {
  status: true,
  editLockedAt: true,
  layers: { select: { fabricIssued: true, colours: { select: { fabricIssued: true } } } },
  materialChallans: { where: { status: "LOCKED" as const, voidedAt: null }, select: { id: true } },
} as const;

function deriveJobLocked(job: {
  status: string;
  layers: { fabricIssued: number | null; colours: { fabricIssued: number | null }[] }[];
  materialChallans: { id: number }[];
}): boolean {
  if (job.status === "DRAFT") return false;
  const hasLockedChallan = job.materialChallans.length > 0;
  const hasIssuedFabric = job.layers.some(
    (l) => l.fabricIssued != null || l.colours.some((c) => c.fabricIssued != null)
  );
  return hasLockedChallan || hasIssuedFabric;
}

/** Keep editLockedAt in sync with the derived lock, preserving the first-frozen timestamp. */
async function syncJobLock(jobCardId: number): Promise<void> {
  const job = await db.jobCard.findUnique({ where: { id: jobCardId }, select: JOB_LOCK_SELECT });
  if (!job) return;
  const locked = deriveJobLocked(job);
  const next = locked ? (job.editLockedAt ?? new Date()) : null;
  const changed = (next?.getTime() ?? null) !== (job.editLockedAt?.getTime() ?? null);
  if (changed) await db.jobCard.update({ where: { id: jobCardId }, data: { editLockedAt: next } as any });
}

/** Throw if the card is currently frozen. An ADMIN unlock clears it for one correction save. */
async function assertJobEditable(jobCardId: number): Promise<void> {
  const job = await db.jobCard.findUnique({ where: { id: jobCardId }, select: { editLockedAt: true } });
  if (job?.editLockedAt) {
    throw new Error("This job card is locked — material has been issued against it. An admin must unlock it for correction.");
  }
}

/** Change 39 Part F — ADMIN-only, audited "unlock for correction". Clears the freeze until re-save. */
export async function unlockJobCardForCorrection(input: { jobCardId: number; reason?: string | null }) {
  const user = await requireRole("ADMIN");
  const job = await db.jobCard.findUnique({ where: { id: input.jobCardId }, select: { siNo: true, editLockedAt: true } });
  if (!job) throw new Error("Job card not found");
  if (!job.editLockedAt) return { ok: true }; // already editable
  await db.$transaction(async (tx) => {
    await tx.jobCard.update({ where: { id: input.jobCardId }, data: { editLockedAt: null } as any });
    await logAudit(tx, user, {
      action: "unlockJobCard",
      entity: "JobCard",
      entityId: input.jobCardId,
      entityLabel: job.siNo,
      summary: `Unlocked job card ${job.siNo} for correction${input.reason ? ` — ${input.reason}` : ""}`,
      changes: { editLockedAt: { old: job.editLockedAt, new: null } },
      meta: { reason: input.reason ?? null },
    });
  });
  revalidatePath(`/job-cards/${input.jobCardId}`);
  return { ok: true };
}

/** Log trims physically handed over against a job's BOM line (workbook Issue-Qty/Balance). */
export async function recordTrimIssue(input: {
  jobBomLineId: number;
  issuedQty: number;
  arrangedBy?: string | null;
  issueDate?: string | null;
  challan?: string | null;
}) {
  await requireRole("ADMIN", "STAFF");
  const line = await db.jobBomLine.update({
    where: { id: input.jobBomLineId },
    data: {
      issuedQty: input.issuedQty,
      arrangedBy: input.arrangedBy ?? null,
      issueDate: input.issueDate ? new Date(input.issueDate) : new Date(),
      challan: input.challan ?? null,
    } as any,
    select: { jobCardId: true },
  });
  await recomputeTrimsPending(line.jobCardId);
  revalidatePath(`/job-cards/${line.jobCardId}`);
  revalidatePath("/pending-trims");
  return { ok: true };
}

/** Preset BOM CRUD (admin/staff) — edit a product's reusable trim template. */
export async function upsertBomLine(input: {
  id?: number;
  productId: number;
  trimItemId: number | null;
  material: string;
  color?: string | null;
  dimension: "COLOR" | "SIZE" | "FLAT";
  perPieceQty: number;
}) {
  await requireRole("ADMIN", "STAFF");
  // ensure the product has a Bom row to hang lines on
  let bom = await db.bom.findFirst({ where: { productId: input.productId } });
  if (!bom) {
    const product = await db.product.findUnique({ where: { id: input.productId } });
    bom = await db.bom.create({
      data: { code: product?.bomCode ?? product?.styleNo ?? `P${input.productId}`, styleName: product?.name ?? "", productId: input.productId },
    });
  }
  const data = {
    material: input.material,
    color: input.color ?? null,
    dimension: input.dimension as any,
    perPieceQty: input.perPieceQty,
    qty: input.perPieceQty,
    trimItemId: input.trimItemId,
  };
  if (input.id) {
    await db.bomLine.update({ where: { id: input.id }, data: data as any });
  } else {
    await db.bomLine.create({ data: { ...data, bomId: bom.id } as any });
  }
  revalidatePath("/catalog");
  revalidatePath(`/catalog/${input.productId}`);
  return { ok: true };
}

export async function removeBomLine(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  await db.bomLine.delete({ where: { id: input.id } });
  revalidatePath("/catalog");
  return { ok: true };
}

// ── Change 05 — masters & procurement ──

/**
 * Change 25 Part G.0 — a named person at a supplier or a buyer firm.
 * Blank names are dropped rather than rejected: the form always carries a trailing
 * empty row, and an empty row is not an error.
 */
export type ContactInput = {
  name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
};

const cleanContacts = (rows: ContactInput[] | undefined) =>
  (rows ?? [])
    .filter((c) => c.name?.trim())
    .map((c, i) => ({
      name: c.name.trim(),
      role: c.role?.trim() || null,
      phone: c.phone?.trim() || null,
      email: c.email?.trim() || null,
      sortOrder: i,
    }));

export async function createSupplier(input: { name: string; type?: string | null; city?: string | null; phone?: string | null; address?: string | null; email?: string | null; gstNo?: string | null; remarks?: string | null; contacts?: ContactInput[] }) {
  const user = await requireRole("ADMIN", "STAFF");
  if (!input.name.trim()) throw new Error("Name required");
  const contacts = cleanContacts(input.contacts);
  const s = await db.$transaction(async (tx) => {
    const row = await tx.supplier.create({
      data: {
        name: input.name.trim(), type: (input.type ?? null) as any, city: input.city ?? null,
        phone: input.phone ?? null, address: input.address ?? null, email: input.email ?? null,
        gstNo: input.gstNo?.trim() || null, remarks: input.remarks ?? null,
        ...(contacts.length ? { contacts: { create: contacts } } : {}),
      } as any,
    });
    await logAudit(tx, user, {
      action: "createSupplier",
      entity: "Supplier",
      entityId: row.id,
      entityLabel: row.name,
      summary: `Added supplier ${row.name}`,
      meta: { gstNo: input.gstNo ?? null, city: input.city ?? null, contacts: contacts.length },
    });
    return row;
  });
  revalidatePath("/suppliers");
  return { id: s.id };
}

export async function updateSupplier(input: { id: number; name?: string; type?: string | null; city?: string | null; phone?: string | null; address?: string | null; email?: string | null; gstNo?: string | null; remarks?: string | null; active?: boolean; contacts?: ContactInput[] }) {
  const user = await requireRole("ADMIN", "STAFF");
  const before = await db.supplier.findUnique({
    where: { id: input.id },
    select: { name: true, type: true, city: true, phone: true, address: true, email: true, gstNo: true, remarks: true, active: true },
  });
  if (!before) throw new Error("Supplier not found");

  const patch = {
      ...(input.name != null ? { name: input.name.trim() } : {}),
      ...(input.type !== undefined ? { type: (input.type ?? null) as any } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.gstNo !== undefined ? { gstNo: input.gstNo?.trim() || null } : {}),
      ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
  } as Record<string, unknown>;

  await db.$transaction(async (tx) => {
    await tx.supplier.update({ where: { id: input.id }, data: patch as any });
    // Contacts are replaced wholesale when the form sends them: the repeatable rows
    // ARE the list, so a removed row must disappear. `undefined` leaves them alone,
    // which is what the row-level active toggle sends.
    if (input.contacts !== undefined) {
      await tx.contact.deleteMany({ where: { supplierId: input.id } });
      const rows = cleanContacts(input.contacts);
      for (const c of rows) await tx.contact.create({ data: { ...c, supplierId: input.id } });
    }
    const changes = computeChanges(before as unknown as Record<string, unknown>, patch);
    await logAudit(tx, user, {
      action: "updateSupplier",
      entity: "Supplier",
      entityId: input.id,
      entityLabel: input.name?.trim() || before.name,
      summary: changes
        ? `Edited ${Object.keys(changes).join(", ")} on supplier ${before.name}`
        : `Updated contacts on supplier ${before.name}`,
      changes,
    });
  });
  revalidatePath("/suppliers");
  return { ok: true };
}

/* ── Change 25 Part G.2 — the buyer (issuing firm) master ──
 *
 * A purchase order has two parties. The supplier side was already modelled; this is
 * the other one — which of the owner's own firms the PO goes out under, with that
 * firm's GST, registered and billing addresses, and its set of delivery addresses.
 */

export async function createBuyer(input: {
  name: string;
  gstNo?: string | null;
  city?: string | null;
  buyerAddress?: string | null;
  billingAddress?: string | null;
  contacts?: ContactInput[];
  deliveryAddrs?: { label?: string | null; address: string }[];
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const name = input.name?.trim();
  if (!name) throw new Error("Name required");
  const contacts = cleanContacts(input.contacts);
  const addrs = (input.deliveryAddrs ?? [])
    .filter((a) => a.address?.trim())
    .map((a) => ({ label: a.label?.trim() || null, address: a.address.trim() }));

  const b = await db.$transaction(async (tx) => {
    const row = await tx.buyer.create({
      data: {
        name,
        gstNo: input.gstNo?.trim() || null,
        city: input.city?.trim() || null,
        buyerAddress: input.buyerAddress?.trim() || null,
        billingAddress: input.billingAddress?.trim() || null,
        ...(contacts.length ? { contacts: { create: contacts } } : {}),
        ...(addrs.length ? { deliveryAddrs: { create: addrs } } : {}),
      },
    });
    await logAudit(tx, user, {
      action: "createBuyer",
      entity: "Buyer",
      entityId: row.id,
      entityLabel: row.name,
      summary: `Added firm ${row.name}`,
      meta: { gstNo: input.gstNo ?? null, contacts: contacts.length, deliveryAddresses: addrs.length },
    });
    return row;
  });
  revalidatePath("/buyers");
  return { id: b.id };
}

export async function updateBuyer(input: {
  id: number;
  name?: string;
  gstNo?: string | null;
  city?: string | null;
  buyerAddress?: string | null;
  billingAddress?: string | null;
  active?: boolean;
  contacts?: ContactInput[];
  deliveryAddrs?: { id?: number; label?: string | null; address: string; active?: boolean }[];
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const before = await db.buyer.findUnique({
    where: { id: input.id },
    select: { name: true, gstNo: true, city: true, buyerAddress: true, billingAddress: true, active: true },
  });
  if (!before) throw new Error("Firm not found");

  const patch = {
    ...(input.name != null ? { name: input.name.trim() } : {}),
    ...(input.gstNo !== undefined ? { gstNo: input.gstNo?.trim() || null } : {}),
    ...(input.city !== undefined ? { city: input.city?.trim() || null } : {}),
    ...(input.buyerAddress !== undefined ? { buyerAddress: input.buyerAddress?.trim() || null } : {}),
    ...(input.billingAddress !== undefined ? { billingAddress: input.billingAddress?.trim() || null } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  } as Record<string, unknown>;

  await db.$transaction(async (tx) => {
    await tx.buyer.update({ where: { id: input.id }, data: patch as any });
    if (input.contacts !== undefined) {
      await tx.contact.deleteMany({ where: { buyerId: input.id } });
      for (const c of cleanContacts(input.contacts)) await tx.contact.create({ data: { ...c, buyerId: input.id } });
    }
    if (input.deliveryAddrs !== undefined) {
      // Addresses are NOT deleted: a PO points at one by FK, and destroying it would
      // blank the ship-to on an already-issued document. Dropped rows deactivate.
      const keep = new Set(input.deliveryAddrs.filter((a) => a.id).map((a) => a.id!));
      await tx.buyerDeliveryAddress.updateMany({
        where: { buyerId: input.id, id: { notIn: [...keep] } },
        data: { active: false },
      });
      for (const a of input.deliveryAddrs) {
        if (!a.address?.trim()) continue;
        const data = { label: a.label?.trim() || null, address: a.address.trim(), active: a.active ?? true };
        if (a.id) await tx.buyerDeliveryAddress.update({ where: { id: a.id }, data });
        else await tx.buyerDeliveryAddress.create({ data: { ...data, buyerId: input.id } });
      }
    }
    const changes = computeChanges(before as unknown as Record<string, unknown>, patch);
    await logAudit(tx, user, {
      action: "updateBuyer",
      entity: "Buyer",
      entityId: input.id,
      entityLabel: input.name?.trim() || before.name,
      summary: changes
        ? `Edited ${Object.keys(changes).join(", ")} on firm ${before.name}`
        : `Updated contacts or addresses on firm ${before.name}`,
      changes,
    });
  });
  revalidatePath("/buyers");
  revalidatePath("/fabric-orders");
  revalidatePath("/trim-orders");
  return { ok: true };
}

export async function addBuyerDeliveryAddress(input: { buyerId: number; label?: string | null; address: string }) {
  await requireRole("ADMIN", "STAFF");
  if (!input.address?.trim()) throw new Error("Address required");
  const a = await db.buyerDeliveryAddress.create({
    data: { buyerId: input.buyerId, label: input.label?.trim() || null, address: input.address.trim() },
  });
  revalidatePath("/buyers");
  return { id: a.id };
}

export async function deactivateBuyer(input: { id: number; active?: boolean }) {
  const user = await requireRole("ADMIN", "STAFF");
  const next = input.active ?? false;
  await db.$transaction(async (tx) => {
    const b = await tx.buyer.update({ where: { id: input.id }, data: { active: next }, select: { name: true } });
    await logAudit(tx, user, {
      action: "deactivateBuyer",
      entity: "Buyer",
      entityId: input.id,
      entityLabel: b.name,
      summary: `${next ? "Reactivated" : "Deactivated"} firm ${b.name}`,
      changes: { active: { old: !next, new: next } },
    });
  });
  revalidatePath("/buyers");
  return { ok: true };
}

// ── Change 20 — user administration ──
//
// These are the only actions in this file guarded by requireRole("ADMIN") alone rather
// than ("ADMIN", "STAFF"). A server action is reachable by direct POST no matter what
// the sidebar renders or the proxy allows, so this guard — not the nav — is the boundary.

type UserRole = "ADMIN" | "STAFF" | "VENDOR" | "TRIMS";

/** A VENDOR login must soft-link to a real Vendor by name; every other role must not. */
async function resolveVendorName(role: UserRole, vendorName?: string | null) {
  if (role !== "VENDOR") return null;
  const name = vendorName?.trim();
  if (!name) throw new Error("A vendor login needs a vendor");
  const v = await db.vendor.findUnique({ where: { name }, select: { name: true } });
  if (!v) throw new Error(`No vendor named "${name}" in the vendor master`);
  return v.name; // store verbatim — the link resolves on the name, not an id
}

/**
 * The system may never reach zero active admins. Paired with a self-check at each call
 * site: on its own, this lets you demote yourself while a dormant admin exists; a
 * self-check on its own lets admin A delete admin B while B deletes A.
 */
async function assertNotLastAdmin(id: number) {
  const t = await db.user.findUnique({ where: { id }, select: { role: true, active: true } });
  if (!t) throw new Error("User not found");
  if (t.role !== "ADMIN" || !t.active) return; // not an admin seat — nothing to protect
  const admins = await db.user.count({ where: { role: "ADMIN", active: true } });
  if (admins <= 1) throw new Error("This is the last active admin — promote another admin first");
}

export async function createUser(input: {
  username: string; displayName: string; password: string;
  role: UserRole; vendorName?: string | null;
}) {
  await requireRole("ADMIN");
  const username = input.username.trim();
  const displayName = input.displayName.trim();
  if (username.length < 3 || /\s/.test(username)) throw new Error("Username must be 3+ characters, no spaces");
  if (!displayName) throw new Error("Display name required");
  if (input.password.length < 6) throw new Error("Password must be at least 6 characters");
  const vendorName = await resolveVendorName(input.role, input.vendorName);
  if (await db.user.findUnique({ where: { username }, select: { id: true } }))
    throw new Error("That username is taken");
  const u = await db.user.create({
    data: {
      username, displayName, role: input.role as any, vendorName,
      passwordHash: hashPassword(input.password),
    } as any,
    select: { id: true },
  });
  revalidatePath("/users");
  return { id: u.id };
}

export async function updateUser(input: {
  id: number; displayName?: string; role?: UserRole; vendorName?: string | null;
}) {
  const me = await requireRole("ADMIN");
  const current = await db.user.findUnique({
    where: { id: input.id }, select: { role: true, vendorName: true },
  });
  if (!current) throw new Error("User not found");
  const role = (input.role ?? current.role) as UserRole;
  if (input.role && input.role !== "ADMIN") {
    if (input.id === me.userId) throw new Error("You cannot change your own role");
    await assertNotLastAdmin(input.id);
  }
  const vendorName =
    input.role !== undefined || input.vendorName !== undefined
      ? await resolveVendorName(role, input.vendorName ?? current.vendorName)
      : undefined;
  await db.user.update({
    where: { id: input.id },
    data: {
      ...(input.displayName != null ? { displayName: input.displayName.trim() } : {}),
      ...(input.role ? { role: input.role as any } : {}),
      ...(vendorName !== undefined ? { vendorName } : {}),
    } as any,
  });
  revalidatePath("/users");
  return { ok: true };
}

export async function resetUserPassword(input: { id: number; password: string }) {
  await requireRole("ADMIN");
  if (input.password.length < 6) throw new Error("Password must be at least 6 characters");
  await db.user.update({
    where: { id: input.id },
    data: { passwordHash: hashPassword(input.password) },
  });
  revalidatePath("/users");
  return { ok: true };
}

export async function setUserActive(input: { id: number; active: boolean }) {
  const me = await requireRole("ADMIN");
  if (!input.active) {
    if (input.id === me.userId) throw new Error("You cannot deactivate your own account");
    await assertNotLastAdmin(input.id);
  }
  await db.user.update({ where: { id: input.id }, data: { active: input.active } as any });
  revalidatePath("/users");
  return { ok: true };
}

/**
 * Change 25 Part I — store a staff member's signature image, printed above their name
 * in the PO's authorised-signatory block. The file goes through the existing
 * uploadImage() provider client-side; this only records the URL. Passing null clears it.
 */
export async function setUserSignature(input: { id: number; url: string | null }) {
  const me = await requireRole("ADMIN");
  await db.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: input.id },
      data: { signatureUrl: input.url },
      select: { displayName: true },
    });
    await logAudit(tx, me, {
      action: "setUserSignature",
      entity: "User",
      entityId: input.id,
      entityLabel: u.displayName,
      summary: input.url
        ? `Loaded a signature for ${u.displayName}`
        : `Removed the signature for ${u.displayName}`,
    });
  });
  revalidatePath("/users");
  return { ok: true };
}

export async function deleteUser(input: { id: number }) {
  const me = await requireRole("ADMIN");
  if (input.id === me.userId) throw new Error("You cannot delete your own account");
  await assertNotLastAdmin(input.id);
  await db.user.delete({ where: { id: input.id } });
  revalidatePath("/users");
  return { ok: true };
}

// ── Change 08: Colour master + fabric quick-add ──
export async function createColour(input: { name: string; hex?: string | null }) {
  await requireRole("ADMIN", "STAFF");
  const name = colorKey(input.name);
  if (!name) throw new Error("Colour required");
  const c = await db.colour.upsert({
    where: { name },
    create: { name, hex: input.hex ?? null },
    update: {},
  });
  revalidatePath("/fabric-orders");
  revalidatePath("/masters");
  return { id: c.id, name: c.name };
}

export async function deactivateColour(input: { id: number; active?: boolean }) {
  await requireRole("ADMIN", "STAFF");
  await db.colour.update({ where: { id: input.id }, data: { active: input.active ?? false } });
  revalidatePath("/masters");
  return { ok: true };
}

/**
 * Change 18 Part D/E — record what we sourced a fabric at, per REAL supplier.
 *
 * This replaces the old upsert-by-free-text-name: `FabricSupplier` is no longer a rival
 * supplier identity, it's a sourcing-rate record hanging off the shared `Supplier` master.
 * Legacy rows (supplierId null, name only) are ADOPTED on first match rather than
 * duplicated. Provenance (which PO quoted this rate, when) is only stamped when the rate
 * itself is written, so the two can never drift apart.
 *
 * The master's `Fabric.ratePerUnit` is an ESTIMATE and is never touched from here.
 */
async function upsertFabricSourcingRate(
  fabricId: number,
  supplier: { id?: number | null; name?: string | null },
  rate?: number | null,
  provenance?: { poNumber?: string | null; sourcedAt?: Date | null },
  overwrite = false
) {
  // Resolve the real Supplier: prefer the id, else find-or-create by unique name.
  let s: { id: number; name: string } | null = null;
  if (supplier.id) {
    s = await db.supplier.findUnique({ where: { id: supplier.id }, select: { id: true, name: true } });
  }
  if (!s) {
    const n = supplier.name?.trim();
    if (!n) return; // nothing to key on — no-op, same as before
    s = await db.supplier.upsert({
      where: { name: n },
      create: { name: n },
      update: {},
      select: { id: true, name: true },
    });
  }

  // Match on the real supplier first; fall back to adopting a legacy name-only row.
  const existing = await db.fabricSupplier.findFirst({
    where: { fabricId, OR: [{ supplierId: s.id }, { supplierId: null, name: s.name }] },
    orderBy: { id: "asc" },
  });
  const writeRate = rate != null && (overwrite || existing?.rate == null);
  const prov = writeRate && provenance
    ? { poNumber: provenance.poNumber ?? null, sourcedAt: provenance.sourcedAt ?? new Date() }
    : {};

  if (existing) {
    await db.fabricSupplier.update({
      where: { id: existing.id },
      data: { supplierId: s.id, name: s.name, ...(writeRate ? { rate } : {}), ...prov } as any,
    });
  } else {
    await db.fabricSupplier.create({
      data: { fabricId, supplierId: s.id, name: s.name, rate: rate ?? null, ...prov } as any,
    });
  }
}

/**
 * Quick-create a fabric while ordering (Change 08) — now carries supplier + unit + rate up
 * to the new master and auto-adds the supplier to its list (Change 17 Part G).
 */
export async function createFabricQuick(input: {
  name: string;
  unit?: "KG" | "MTR";
  supplierId?: number | null;
  supplierName?: string | null;
  rate?: number | null;
}) {
  await requireRole("ADMIN", "STAFF");
  const name = input.name.trim();
  if (!name) throw new Error("Fabric name required");
  const existing = await db.fabric.findUnique({ where: { name } });
  const f =
    existing ??
    (await db.fabric.create({
      data: { name, unit: (input.unit ?? "MTR") as any, ratePerUnit: input.rate ?? null } as any,
    }));
  // Change 18 Part E: the rate entered here seeds the ESTIMATE on a brand-new master only.
  // An EXISTING master's estimate is never touched by an order — edit the master to change it.
  await upsertFabricSourcingRate(f.id, { id: input.supplierId, name: input.supplierName }, input.rate ?? null);
  revalidatePath("/fabric-orders");
  revalidatePath("/inventory");
  return { id: f.id, name: f.name };
}

/**
 * Change 38 Part G — quick-create a trim while ordering, the mirror of createFabricQuick.
 *
 * Deliberately NOT a call to createTrim: TrimItem.name is @unique and createTrim has no
 * duplicate guard, so ordering a trim whose name already exists threw a raw Prisma P2002
 * that the calling form swallowed. Upsert-by-name is the behaviour the fabric flow has
 * always had, and it is what "add this trim to the order" actually means — if it exists,
 * use it. Supplier, unit and rate ride up to the master exactly as they do for fabric.
 */
export async function createTrimQuick(input: {
  name: string;
  unit?: string | null;
  supplierId?: number | null;
  rate?: number | null;
}) {
  await requireRole("ADMIN", "STAFF");
  const name = input.name.trim();
  if (!name) throw new Error("Trim name required");
  const existing = await db.trimItem.findUnique({ where: { name } });
  const t =
    existing ??
    (await db.trimItem.create({
      data: {
        name,
        // must match createTrim's derivation or the two paths disagree on the same name
        normName: name.toUpperCase().replace(/[^A-Z0-9]/g, ""),
        unit: input.unit?.trim() || "pcs",
        supplierId: input.supplierId ?? null,
        ratePerUnit: input.rate ?? null,
      } as any,
    }));
  revalidatePath("/trim-orders");
  revalidatePath("/trims");
  return { id: t.id, name: t.name, unit: t.unit };
}

/** First-class create of a fabric master (Change 17 Part F "Add Fabric"). */
export async function createFabric(input: {
  name: string;
  unit?: "KG" | "MTR";
  gsm?: number | null;
  rollWidth?: number | null;
  form?: "OPEN" | "TUBE" | null;
  ratePerUnit?: number | null;
}) {
  await requireRole("ADMIN", "STAFF");
  const name = input.name.trim();
  if (!name) throw new Error("Fabric name required");
  if (await db.fabric.findUnique({ where: { name } })) throw new Error("A fabric with that name already exists");
  const f = await db.fabric.create({
    data: {
      name,
      unit: (input.unit ?? "MTR") as any,
      gsm: input.gsm ?? null,
      rollWidth: input.rollWidth ?? null,
      form: (input.form ?? null) as any,
      ratePerUnit: input.ratePerUnit ?? null,
    } as any,
  });
  revalidatePath("/inventory");
  return { id: f.id };
}

// ── Change 08: multi-colour fabric orders + PO ──
export async function createFabricOrder(input: {
  fabricId: number; supplierId?: number | null; expectedDate?: string | null; rate?: number | null;
  gsm?: number | null; status?: string; remarks?: string | null; unit?: "KG" | "MTR";
  lines: { colour: string; qty: number }[];
  /** Change 38 Part A — hold this as a DRAFT: no master update, no sourcing rate. */
  draft?: boolean;
  /** The draft to write into (autosave) or finalise (save). */
  draftId?: number | null;
}) {
  await requireRole("ADMIN", "STAFF");
  const post = input.draft !== true;
  const lines = (input.lines ?? [])
    .map((l) => ({ colour: colorKey(l.colour), qty: l.qty }))
    .filter((l) => l.colour && l.qty > 0);
  // A draft is allowed to be incomplete — that is the point of it. A real order is not.
  if (post && lines.length === 0) throw new Error("Add at least one colour with a quantity");
  const total = lines.reduce((a, l) => a + l.qty, 0);
  // Change 17 Part E/G: the unit comes from the master by default (override per order).
  const fabric = await db.fabric.findUnique({ where: { id: input.fabricId }, select: { unit: true } });
  const unit = (input.unit ?? fabric?.unit ?? "MTR") as any;
  const data = {
      fabricId: input.fabricId, supplierId: input.supplierId ?? null,
      qty: total, rate: input.rate ?? null, gsm: input.gsm ?? null, unit,
      status: (post ? input.status ?? "ORDER_PLACED" : "DRAFT") as any, orderDate: new Date(),
      expectedDate: input.expectedDate ? new Date(input.expectedDate) : null, remarks: input.remarks ?? null,
  };
  // Change 38 Part H: capture the created row. This used to discard it and return
  // { ok: true }, so the form had no way to know which order it had just made — and
  // therefore no entity id to attach a shade card to.
  // Change 38 Part A: `draftId` finalises an existing draft in place rather than creating a
  // second row. A draft touched neither the master nor the sourcing rate, so replacing its
  // lines wholesale is safe.
  let order;
  if (input.draftId != null) {
    const existing = await db.fabricOrder.findUnique({ where: { id: input.draftId }, select: { status: true } });
    if (!existing) throw new Error("That draft no longer exists");
    if (existing.status !== "DRAFT") throw new Error("That order has already been placed");
    await db.fabricOrderLine.deleteMany({ where: { fabricOrderId: input.draftId } });
    order = await db.fabricOrder.update({
      where: { id: input.draftId },
      data: { ...data, lines: { create: lines } } as any,
    });
  } else {
    order = await db.fabricOrder.create({ data: { ...data, lines: { create: lines } } as any });
  }
  // Change 38 Part A: a DRAFT posts nothing outward — it must not push its unit onto the
  // fabric master or record a sourcing rate against a supplier it may never be sent to.
  if (post) {
    // Change 18 Part E: the order's unit still lands on the master, but its RATE no longer
    // does — `Fabric.ratePerUnit` is the estimate and only a master edit may change it.
    // The order's price is recorded as a sourcing rate against the real supplier instead.
    await db.fabric.update({ where: { id: input.fabricId }, data: { unit } as any });
    await upsertFabricSourcingRate(
      input.fabricId,
      { id: input.supplierId },
      input.rate ?? null,
      { sourcedAt: new Date() }
    );
  }
  revalidatePath("/fabric-orders");
  revalidatePath("/inventory");
  return { id: order.id };
}

// ── Change 40 Part C — a PO is editable at EVERY stage by ADMIN or its creator ──────────
// Owner: "We can change it after we have generated the PO because we can resend it on
// WhatsApp… A PO is not that corporate of a thing." The old hard blocks (locked once a PO
// number existed, and once received) are replaced by this one check. The line-rewrite fear
// the old receivedDate guard protected against is moot under Change 18/40: an order NEVER
// moves stock — only the inward challan does — so editing the order document is safe. The PO
// number is never regenerated on edit, and every post-PO edit is audit-logged by the caller.
function canEditOrder(user: SessionPayload, order: { placedById: number | null }): boolean {
  return user.role === "ADMIN" || (order.placedById != null && user.userId === order.placedById);
}
async function orderEditorName(placedById: number | null): Promise<string> {
  if (placedById == null) return "its creator";
  const u = await db.user.findUnique({ where: { id: placedById }, select: { displayName: true } });
  return u?.displayName ?? "its creator";
}

export async function updateFabricOrder(input: {
  id: number; supplierId?: number | null; expectedDate?: string | null; rate?: number | null;
  gsm?: number | null; unit?: "KG" | "MTR"; lines?: { colour: string; qty: number }[];
  // Change 25 Part J: createFabricOrder always accepted remarks; the edit path did not,
  // so a remark could be set on creation and then never corrected.
  remarks?: string | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const o = await db.fabricOrder.findUnique({ where: { id: input.id }, select: { poNumber: true, placedById: true } });
  if (!o) throw new Error("Order not found");
  if (!canEditOrder(user, o)) throw new Error(`Only ${await orderEditorName(o.placedById)} or an admin can edit this order.`);
  await db.$transaction(async (tx) => {
    if (input.lines) {
      const lines = input.lines.map((l) => ({ colour: colorKey(l.colour), qty: l.qty })).filter((l) => l.colour && l.qty > 0);
      await tx.fabricOrderLine.deleteMany({ where: { fabricOrderId: input.id } });
      await tx.fabricOrderLine.createMany({ data: lines.map((l) => ({ ...l, fabricOrderId: input.id })) });
      await tx.fabricOrder.update({ where: { id: input.id }, data: { qty: lines.reduce((a, l) => a + l.qty, 0) } });
    }
    await tx.fabricOrder.update({
      where: { id: input.id },
      data: {
        ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
        ...(input.rate !== undefined ? { rate: input.rate } : {}),
        ...(input.gsm !== undefined ? { gsm: input.gsm } : {}),
        ...(input.unit !== undefined ? { unit: input.unit as any } : {}),
        ...(input.expectedDate !== undefined ? { expectedDate: input.expectedDate ? new Date(input.expectedDate) : null } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
      },
    });
    // Change 40 Part C — the freedom is fine; the silence is not. Log every edit made after
    // the PO number exists (old→new lives in `meta`), using the Change 25 audit pattern.
    if (o.poNumber) {
      await logAudit(tx, user, {
        action: "editFabricOrder", entity: "FabricOrder", entityId: String(input.id),
        entityLabel: o.poNumber, summary: `Edited ${o.poNumber} after PO generation`,
        meta: { input },
      });
    }
  });
  revalidatePath("/fabric-orders");
  return { ok: true };
}

export async function deleteFabricOrder(input: { id: number }) {
  const user = await requireRole("ADMIN", "STAFF");
  const o = await db.fabricOrder.findUnique({
    where: { id: input.id },
    select: { poNumber: true, placedById: true },
  });
  if (!o) throw new Error("Order not found");
  if (!canEditOrder(user, o)) throw new Error(`Only ${await orderEditorName(o.placedById)} or an admin can delete this order.`);
  // Change 40 Part C — a generated PO is retained and VOIDED, never deleted (house rule).
  if (o.poNumber) throw new Error("A generated PO can't be deleted — void it instead");
  // MaterialChallan.fabricOrderId is onDelete: SetNull, so deleting an order that has a
  // challan against it succeeds silently and strips the receipt of its "For PO-…"
  // provenance. Refuse instead — the challan must be voided first.
  const challans = await db.materialChallan.count({
    where: { fabricOrderId: input.id, voidedAt: null },
  });
  if (challans > 0) throw new Error("Challans are logged against this order — void them first");
  await db.fabricOrder.delete({ where: { id: input.id } });
  revalidatePath("/fabric-orders");
  return { ok: true };
}

/**
 * Change 40 Part C3 — cancel a wrong PO. The row is retained (struck-through in the list,
 * out of every roll-up); blocked if a locked inward challan already points at it (the goods
 * physically arrived → raise a purchase return instead). Mirrors MaterialChallan.voidedAt.
 */
export async function voidFabricOrder(input: { id: number; reason?: string | null }) {
  const user = await requireRole("ADMIN", "STAFF");
  const o = await db.fabricOrder.findUnique({ where: { id: input.id }, select: { poNumber: true, placedById: true, voidedAt: true } });
  if (!o) throw new Error("Order not found");
  if (!canEditOrder(user, o)) throw new Error(`Only ${await orderEditorName(o.placedById)} or an admin can void this order.`);
  if (o.voidedAt) return { ok: true }; // idempotent
  const locked = await db.materialChallan.count({ where: { fabricOrderId: input.id, status: "LOCKED", voidedAt: null } });
  if (locked > 0) throw new Error("Goods were received against this PO — raise a purchase return instead of voiding it");
  await db.$transaction(async (tx) => {
    await tx.fabricOrder.update({ where: { id: input.id }, data: { voidedAt: new Date(), voidReason: input.reason ?? null } });
    await logAudit(tx, user, {
      action: "voidFabricOrder", entity: "FabricOrder", entityId: String(input.id),
      entityLabel: o.poNumber ?? `#${input.id}`,
      summary: `Voided ${o.poNumber ?? `fabric order #${input.id}`}${input.reason ? ` — ${input.reason}` : ""}`,
    });
  });
  revalidatePath("/fabric-orders");
  return { ok: true };
}

export async function updateFabricOrderStatus(input: { id: number; status: string }) {
  await requireRole("ADMIN", "STAFF");
  // Change 18 Part A: setting RECEIVED no longer auto-receives stock. Goods enter stock
  // only by locking the inward challan raised against the order (draftChallanFromFabricOrder).
  await db.fabricOrder.update({ where: { id: input.id }, data: { status: input.status as any } });
  revalidatePath("/fabric-orders");
  return { ok: true };
}

/**
 * Receive a fabric order in one shot: land EVERY line's qty into that colour's stock once
 * (guard via receivedDate).
 *
 * Change 18 Part A — LEGACY DOOR, no UI caller. Kept so orders already received this way
 * keep their stock and history; going forward stock enters only via lockChallan.
 * Do not delete and do not re-wire to a button.
 */
export async function receiveFabricOrder(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  const o = await db.fabricOrder.findUnique({ where: { id: input.id }, include: { lines: true } });
  if (!o) throw new Error("Order not found");
  if (o.receivedDate) return { ok: true, already: true as const }; // double-receive guard
  const now = new Date();
  // New multi-colour orders use lines[]; legacy rows fall back to the single color/qty.
  const rows =
    o.lines.length > 0
      ? o.lines.map((l) => ({ colour: colorKey(l.colour), qty: l.qty }))
      : o.color
        ? [{ colour: colorKey(o.color), qty: o.qty }]
        : [];
  await db.$transaction(async (tx) => {
    await tx.fabricOrder.update({ where: { id: o.id }, data: { status: "RECEIVED", receivedDate: now } });
    if (rows.length === 0) {
      await tx.fabric.update({ where: { id: o.fabricId }, data: { openingStock: { increment: o.qty } } });
      return;
    }
    for (const r of rows) {
      if (r.qty <= 0) continue;
      await tx.stockMovement.create({ data: { type: "RECEIPT", qty: r.qty, date: now, fabricId: o.fabricId, color: r.colour, note: "Fabric order received" } as any });
      await tx.fabricColor.upsert({
        where: { fabricId_color: { fabricId: o.fabricId, color: r.colour } },
        create: { fabricId: o.fabricId, color: r.colour, openingStock: r.qty, currentStock: r.qty },
        update: { currentStock: { increment: r.qty } },
      });
    }
  });
  revalidatePath("/fabric-orders");
  revalidatePath("/inventory");
  return { ok: true };
}

/**
 * Change 25 — what a PO carries beyond its number. Every field is optional, so the
 * bare `generatePO({ id })` call still behaves exactly as it did.
 *   buyerId / deliveryAddressId — which of our firms issues it, shipping where (G.3)
 *   gstRate                     — the tax %, stored so a reprint is identical (K.2)
 *   placedById                  — the authorised signatory; defaults to the caller,
 *                                 overridable by an owner generating on someone
 *                                 else's behalf (I.2)
 */
export type PoIssueInput = {
  buyerId?: number | null;
  deliveryAddressId?: number | null;
  gstRate?: number | null;
  placedById?: number | null;
  /**
   * Change 38 Part F — the authorised signatory: a contact of the issuing firm, by NAME.
   *
   * Snapshotted rather than referenced because updateBuyer deletes and recreates a buyer's
   * contacts on every save, so contact ids are not stable. placedById is still recorded
   * alongside it as the audit of who generated the document.
   */
  signatoryName?: string | null;
};

/** Trim to a printable signatory name, or null when nothing usable was chosen. */
const cleanSignatory = (s?: string | null) => {
  const n = s?.trim();
  return n ? n.slice(0, 120) : null;
};

/** Resolve the signatory: an owner may name someone else, anyone else signs their own. */
async function resolveSignatory(user: SessionPayload, placedById?: number | null) {
  if (placedById == null || placedById === user.userId) return user.userId;
  // Only an owner can sign on someone else's behalf; a staff PO always carries its
  // own author, so the block can never be used to misattribute authorisation.
  if (!canSeeCostFor(user)) return user.userId;
  const staff = await db.user.findUnique({ where: { id: placedById }, select: { id: true, active: true } });
  return staff?.active ? staff.id : user.userId;
}

/** Assign PO-YYYY-NNN (yearly sequence), lock the order. Idempotent. */
export async function generatePO(input: { id: number } & PoIssueInput) {
  const user = await requireRole("ADMIN", "STAFF");
  const o = await db.fabricOrder.findUnique({
    where: { id: input.id },
    select: { poNumber: true, fabricId: true, supplierId: true, rate: true, unit: true },
  });
  if (!o) throw new Error("Order not found");
  if (o.poNumber) return { poNumber: o.poNumber }; // idempotent
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const existing = await db.fabricOrder.findMany({ where: { poNumber: { startsWith: prefix } }, select: { poNumber: true } });
  const maxN = existing.reduce((m, e) => Math.max(m, parseInt(e.poNumber!.slice(prefix.length), 10) || 0), 0);
  const poNumber = `${prefix}${String(maxN + 1).padStart(3, "0")}`;
  const placedById = await resolveSignatory(user, input.placedById);

  await db.$transaction(async (tx) => {
    await tx.fabricOrder.update({
      where: { id: input.id },
      data: {
        poNumber,
        poGeneratedAt: new Date(),
        placedById,
        signatoryName: cleanSignatory(input.signatoryName),
        ...(input.buyerId !== undefined ? { buyerId: input.buyerId } : {}),
        ...(input.deliveryAddressId !== undefined ? { deliveryAddressId: input.deliveryAddressId } : {}),
        ...(input.gstRate !== undefined ? { gstRate: input.gstRate } : {}),
        updatedById: user.userId,
      },
    });
    await logAudit(tx, user, {
      action: "generatePO",
      entity: "FabricOrder",
      entityId: input.id,
      entityLabel: poNumber,
      summary: `Generated ${poNumber}`,
      changes: { poNumber: { old: null, new: poNumber } },
      meta: {
        buyerId: input.buyerId ?? null,
        deliveryAddressId: input.deliveryAddressId ?? null,
        gstRate: input.gstRate ?? null,
        placedById,
        signatoryName: cleanSignatory(input.signatoryName),
      },
    });
  });
  // Change 18 Part E: a PO carries the TRUE price for that order — it does NOT overwrite
  // the master's estimate. The confirmed price is appended to the fabric's sourcing history
  // with its provenance (which PO, when) so the master shows "who quoted what".
  await db.fabric.update({ where: { id: o.fabricId }, data: { unit: o.unit as any } });
  await upsertFabricSourcingRate(
    o.fabricId,
    { id: o.supplierId },
    o.rate ?? null,
    { poNumber, sourcedAt: new Date() },
    true
  );
  revalidatePath("/fabric-orders");
  revalidatePath("/inventory");
  return { poNumber };
}

export async function markPOSent(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  await db.fabricOrder.update({ where: { id: input.id }, data: { sentAt: new Date() } });
  revalidatePath("/fabric-orders");
  return { ok: true };
}

// ── Change 18 Part B — Trim orders + the POT-YYYY-NNN series ──
//
// Trims are bought exactly the way fabric is: raise an order, generate a PO, then log an
// inward challan against it (draftChallanFromTrimOrder). A plain qty order is valid; the
// optional lines[] split is for trims ordered colour- or size-wise.

// Change 40 Part G — a trim PO line may now name its own trim SKU + rate (a trim PO can hold
// many different trims). Legacy colour/size split lines simply carry trimItemId = null.
type TrimOrderLineInput = { colour?: string | null; size?: string | null; qty: number; trimItemId?: number | null; rate?: number | null };

const cleanTrimLines = (lines?: TrimOrderLineInput[] | null) =>
  (lines ?? [])
    .map((l) => ({ colour: l.colour?.trim() || null, size: l.size?.trim() || null, qty: l.qty, trimItemId: l.trimItemId ?? null, rate: l.rate ?? null }))
    .filter((l) => l.qty > 0);

/** Change 40 G — the order's primary/legacy item is the first line's trim, or the passed one. */
const firstLineTrimItem = (lines: { trimItemId: number | null }[], fallback: number) =>
  lines.find((l) => l.trimItemId != null)?.trimItemId ?? fallback;

export async function createTrimOrder(input: {
  trimItemId: number;
  supplierId?: number | null;
  qty?: number | null;
  unit?: string | null;
  rate?: number | null;
  expectedDate?: string | null;
  remarks?: string | null;
  status?: string;
  lines?: TrimOrderLineInput[];
  /** Change 38 Part A — hold this as a DRAFT rather than placing it. */
  draft?: boolean;
  /** The draft to write into (autosave) or finalise (save). */
  draftId?: number | null;
}) {
  await requireRole("ADMIN", "STAFF");
  const post = input.draft !== true;
  const lines = cleanTrimLines(input.lines);
  // A split order's total is the sum of its lines; otherwise the flat qty stands.
  const total = lines.length > 0 ? lines.reduce((a, l) => a + l.qty, 0) : input.qty ?? 0;
  // A draft may be incomplete; a placed order may not.
  if (post && total <= 0) throw new Error("Enter a quantity (or at least one split line)");
  const trim = await db.trimItem.findUnique({ where: { id: input.trimItemId }, select: { unit: true } });
  if (!trim) throw new Error("Trim not found");
  const data = {
      // Change 40 G — the order's legacy/primary item becomes the first line's trim on a
      // multi-trim PO (keeps every existing read that joins TrimOrder.trimItem working).
      trimItemId: firstLineTrimItem(lines, input.trimItemId),
      supplierId: input.supplierId ?? null,
      qty: total,
      unit: input.unit ?? trim.unit ?? null,
      rate: input.rate ?? null,
      status: (post ? input.status ?? "ORDER_PLACED" : "DRAFT") as any,
      orderDate: new Date(),
      expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
      remarks: input.remarks ?? null,
  };
  // Change 38 Part A: finalise an existing draft in place rather than creating a second row.
  let o;
  if (input.draftId != null) {
    const existing = await db.trimOrder.findUnique({ where: { id: input.draftId }, select: { status: true } });
    if (!existing) throw new Error("That draft no longer exists");
    if (existing.status !== "DRAFT") throw new Error("That order has already been placed");
    await db.trimOrderLine.deleteMany({ where: { trimOrderId: input.draftId } });
    o = await db.trimOrder.update({
      where: { id: input.draftId },
      data: { ...data, ...(lines.length > 0 ? { lines: { create: lines } } : {}) } as any,
    });
  } else {
    o = await db.trimOrder.create({
      data: { ...data, ...(lines.length > 0 ? { lines: { create: lines } } : {}) } as any,
    });
  }
  // Change 18 Part E: no write-back to TrimItem.ratePerUnit — the master rate is an estimate.
  revalidatePath("/trim-orders");
  return { id: o.id };
}

export async function updateTrimOrder(input: {
  id: number;
  supplierId?: number | null;
  qty?: number | null;
  unit?: string | null;
  rate?: number | null;
  expectedDate?: string | null;
  remarks?: string | null;
  lines?: TrimOrderLineInput[];
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const o = await db.trimOrder.findUnique({ where: { id: input.id }, select: { poNumber: true, placedById: true } });
  if (!o) throw new Error("Order not found");
  if (!canEditOrder(user, o)) throw new Error(`Only ${await orderEditorName(o.placedById)} or an admin can edit this order.`);
  await db.$transaction(async (tx) => {
    if (input.lines) {
      const lines = cleanTrimLines(input.lines);
      await tx.trimOrderLine.deleteMany({ where: { trimOrderId: input.id } });
      if (lines.length > 0) {
        await tx.trimOrderLine.createMany({ data: lines.map((l) => ({ ...l, trimOrderId: input.id })) });
        await tx.trimOrder.update({
          where: { id: input.id },
          // Change 40 G — keep the total AND the primary item in sync with the lines.
          data: { qty: lines.reduce((a, l) => a + l.qty, 0), trimItemId: lines.find((l) => l.trimItemId != null)?.trimItemId ?? undefined },
        });
      }
    }
    await tx.trimOrder.update({
      where: { id: input.id },
      data: {
        ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
        ...(input.qty != null && !input.lines?.length ? { qty: input.qty } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.rate !== undefined ? { rate: input.rate } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
        ...(input.expectedDate !== undefined
          ? { expectedDate: input.expectedDate ? new Date(input.expectedDate) : null }
          : {}),
      },
    });
    if (o.poNumber) {
      await logAudit(tx, user, {
        action: "editTrimOrder", entity: "TrimOrder", entityId: String(input.id),
        entityLabel: o.poNumber, summary: `Edited ${o.poNumber} after PO generation`,
        meta: { input },
      });
    }
  });
  revalidatePath("/trim-orders");
  return { ok: true };
}

export async function deleteTrimOrder(input: { id: number }) {
  const user = await requireRole("ADMIN", "STAFF");
  const o = await db.trimOrder.findUnique({
    where: { id: input.id },
    select: { poNumber: true, placedById: true },
  });
  if (!o) throw new Error("Order not found");
  if (!canEditOrder(user, o)) throw new Error(`Only ${await orderEditorName(o.placedById)} or an admin can delete this order.`);
  if (o.poNumber) throw new Error("A generated PO can't be deleted — void it instead");
  // Mirrors deleteFabricOrder: MaterialChallan.trimOrderId is onDelete: SetNull.
  const challans = await db.materialChallan.count({
    where: { trimOrderId: input.id, voidedAt: null },
  });
  if (challans > 0) throw new Error("Challans are logged against this order — void them first");
  await db.trimOrder.delete({ where: { id: input.id } });
  revalidatePath("/trim-orders");
  return { ok: true };
}

/** Change 40 Part C3 — cancel a wrong trim PO. Mirror of voidFabricOrder. */
export async function voidTrimOrder(input: { id: number; reason?: string | null }) {
  const user = await requireRole("ADMIN", "STAFF");
  const o = await db.trimOrder.findUnique({ where: { id: input.id }, select: { poNumber: true, placedById: true, voidedAt: true } });
  if (!o) throw new Error("Order not found");
  if (!canEditOrder(user, o)) throw new Error(`Only ${await orderEditorName(o.placedById)} or an admin can void this order.`);
  if (o.voidedAt) return { ok: true };
  const locked = await db.materialChallan.count({ where: { trimOrderId: input.id, status: "LOCKED", voidedAt: null } });
  if (locked > 0) throw new Error("Goods were received against this PO — raise a purchase return instead of voiding it");
  await db.$transaction(async (tx) => {
    await tx.trimOrder.update({ where: { id: input.id }, data: { voidedAt: new Date(), voidReason: input.reason ?? null } });
    await logAudit(tx, user, {
      action: "voidTrimOrder", entity: "TrimOrder", entityId: String(input.id),
      entityLabel: o.poNumber ?? `#${input.id}`,
      summary: `Voided ${o.poNumber ?? `trim order #${input.id}`}${input.reason ? ` — ${input.reason}` : ""}`,
    });
  });
  revalidatePath("/trim-orders");
  return { ok: true };
}

/**
 * Assign POT-YYYY-NNN (yearly sequence), lock the order. Idempotent.
 * Trims get their own series so trim and fabric PO numbers never collide.
 */
export async function generateTrimPO(input: { id: number } & PoIssueInput) {
  const user = await requireRole("ADMIN", "STAFF");
  const o = await db.trimOrder.findUnique({
    where: { id: input.id },
    select: { poNumber: true, trimItemId: true, supplierId: true, rate: true, lines: { select: { trimItemId: true, rate: true } } },
  });
  if (!o) throw new Error("Order not found");
  if (o.poNumber) return { poNumber: o.poNumber }; // idempotent
  const year = new Date().getFullYear();
  const prefix = `POT-${year}-`;
  const existing = await db.trimOrder.findMany({
    where: { poNumber: { startsWith: prefix } },
    select: { poNumber: true },
  });
  const maxN = existing.reduce((m, e) => Math.max(m, parseInt(e.poNumber!.slice(prefix.length), 10) || 0), 0);
  const poNumber = `${prefix}${String(maxN + 1).padStart(3, "0")}`;
  const placedById = await resolveSignatory(user, input.placedById);

  await db.$transaction(async (tx) => {
    await tx.trimOrder.update({
      where: { id: input.id },
      data: {
        poNumber,
        poGeneratedAt: new Date(),
        placedById,
        signatoryName: cleanSignatory(input.signatoryName),
        ...(input.buyerId !== undefined ? { buyerId: input.buyerId } : {}),
        ...(input.deliveryAddressId !== undefined ? { deliveryAddressId: input.deliveryAddressId } : {}),
        ...(input.gstRate !== undefined ? { gstRate: input.gstRate } : {}),
        updatedById: user.userId,
      },
    });
    // Change 40 Part F2 — stamp the rate into the trim's sourcing history with this PO's
    // provenance (mirrors what fabric already does), so a rate becomes a traceable "last paid".
    // Per trim item on the PO (Part G-ready: one row per distinct SKU + its resolved rate).
    const byItem = new Map<number, number | null>();
    for (const l of o.lines) if (l.trimItemId != null) byItem.set(l.trimItemId, l.rate ?? o.rate ?? null);
    if (byItem.size === 0) byItem.set(o.trimItemId, o.rate ?? null);
    for (const [trimItemId, rate] of byItem) {
      await tx.trimItemSupplier.create({
        data: { trimItemId, supplierId: o.supplierId ?? null, rate, poNumber, sourcedAt: new Date() },
      });
    }
    await logAudit(tx, user, {
      action: "generateTrimPO",
      entity: "TrimOrder",
      entityId: input.id,
      entityLabel: poNumber,
      summary: `Generated ${poNumber}`,
      changes: { poNumber: { old: null, new: poNumber } },
      meta: {
        buyerId: input.buyerId ?? null,
        deliveryAddressId: input.deliveryAddressId ?? null,
        gstRate: input.gstRate ?? null,
        placedById,
        signatoryName: cleanSignatory(input.signatoryName),
      },
    });
  });
  // Change 18 Part E: the PO carries the true price; the trim master's estimate is untouched.
  revalidatePath("/trim-orders");
  return { poNumber };
}

export async function markTrimPOSent(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  await db.trimOrder.update({ where: { id: input.id }, data: { sentAt: new Date() } });
  revalidatePath("/trim-orders");
  return { ok: true };
}

export async function createTrim(input: {
  name: string; category?: string | null; supplierId?: number | null; ratePerUnit?: number | null; unit?: string | null;
  openingStock?: number; size?: string | null; material?: string | null; weight?: string | null; shape?: string | null; color?: string | null; remarks?: string | null;
  // Change 17: master single-source fields (Part D) + reorder trigger (Part H).
  dimension?: string | null; perPieceAvg?: number | null; reorderLevel?: number | null;
}) {
  await requireRole("ADMIN", "STAFF");
  if (!input.name.trim()) throw new Error("Name required");
  const opening = input.openingStock ?? 0;
  const norm = input.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const t = await db.trimItem.create({
    data: {
      name: input.name.trim(), normName: norm, openingStock: opening, currentStock: opening,
      category: (input.category ?? null) as any, supplierId: input.supplierId ?? null,
      ratePerUnit: input.ratePerUnit ?? null, unit: input.unit ?? "pcs",
      size: input.size ?? null, material: input.material ?? null, weight: input.weight ?? null,
      shape: input.shape ?? null, color: input.color ?? null, remarks: input.remarks ?? null,
      dimension: (input.dimension ?? null) as any, perPieceAvg: input.perPieceAvg ?? null,
      reorderLevel: input.reorderLevel ?? null,
    } as any,
  });
  revalidatePath("/trims");
  return { id: t.id };
}

export async function updateTrim(input: {
  id: number; name?: string; category?: string | null; supplierId?: number | null; ratePerUnit?: number | null;
  unit?: string | null; status?: string; size?: string | null; material?: string | null; weight?: string | null;
  shape?: string | null; color?: string | null; remarks?: string | null;
  // Change 17: master single-source fields (Part D) + reorder trigger (Part H).
  dimension?: string | null; perPieceAvg?: number | null; reorderLevel?: number | null;
}) {
  await requireRole("ADMIN", "STAFF");
  const { id, ...rest } = input;
  await db.trimItem.update({ where: { id }, data: rest as any });
  revalidatePath("/trims");
  revalidatePath(`/trims/${id}`);
  return { ok: true };
}

/**
 * Stock grows via receipts (writes a movement rather than overwriting).
 *
 * Change 18 Part B — LEGACY DOOR, no UI caller. Trims now enter stock the same way fabric
 * does: a trim PO, then an inward challan locked against it. Kept for back-compat only.
 */
export async function recordTrimReceipt(input: { trimItemId: number; qty: number; rate?: number | null; invoice?: string | null; supplierId?: number | null }) {
  await requireRole("ADMIN", "STAFF");
  await db.$transaction(async (tx) => {
    await tx.trimMovement.create({ data: { type: "RECEIPT", qty: input.qty, date: new Date(), rate: input.rate ?? null, invoice: input.invoice ?? null, trimItemId: input.trimItemId } });
    await tx.trimItem.update({ where: { id: input.trimItemId }, data: { currentStock: { increment: input.qty } } });
  });
  revalidatePath("/trims");
  revalidatePath(`/trims/${input.trimItemId}`);
  return { ok: true };
}

export async function upsertVendor(input: { id?: number; name: string; kind?: "EXTERNAL" | "INHOUSE"; active?: boolean }) {
  await requireRole("ADMIN", "STAFF");
  if (!input.name.trim()) throw new Error("Name required");
  if (input.id) {
    await db.vendor.update({ where: { id: input.id }, data: { name: input.name.trim(), ...(input.kind ? { kind: input.kind as any } : {}), ...(input.active !== undefined ? { active: input.active } : {}) } as any });
  } else {
    await db.vendor.create({ data: { name: input.name.trim(), kind: (input.kind ?? "EXTERNAL") as any } });
  }
  revalidatePath("/vendors");
  return { ok: true };
}

export async function upsertCuttingMaster(input: { id?: number; name: string; active?: boolean }) {
  await requireRole("ADMIN", "STAFF");
  if (!input.name.trim()) throw new Error("Name required");
  if (input.id) {
    await db.cuttingMaster.update({ where: { id: input.id }, data: { name: input.name.trim(), ...(input.active !== undefined ? { active: input.active } : {}) } as any });
  } else {
    await db.cuttingMaster.create({ data: { name: input.name.trim() } });
  }
  revalidatePath("/vendors");
  return { ok: true };
}

// ── Change 06 — images ──

// Change 25 Part H: two more attach points — a trim order's sample photo and the
// paper challan snapped against an inward receipt. One nullable FK each on
// ImageAsset, which is what keeps the gallery queryable per entity.
type ImgEntity = "trim" | "fabric" | "fabricOrder" | "product" | "trimOrder" | "challan";
const IMG_FK: Record<ImgEntity, "trimItemId" | "fabricId" | "fabricOrderId" | "productId" | "trimOrderId" | "materialChallanId"> = {
  trim: "trimItemId", fabric: "fabricId", fabricOrder: "fabricOrderId", product: "productId",
  trimOrder: "trimOrderId", challan: "materialChallanId",
};

export async function attachImages(input: { entity: ImgEntity; entityId: number; kind?: string | null; items: { url: string; thumbUrl?: string | null }[] }) {
  await requireRole("ADMIN", "STAFF");
  const fk = IMG_FK[input.entity];
  const existing = await db.imageAsset.count({ where: { [fk]: input.entityId } as any });
  await db.imageAsset.createMany({
    data: input.items.map((it, i) => ({ url: it.url, thumbUrl: it.thumbUrl ?? it.url, kind: input.kind ?? input.entity, sortOrder: existing + i, [fk]: input.entityId } as any)),
  });
  // product primary thumbnail: set imageUrl if empty
  if (input.entity === "product" && input.items[0]) {
    const p = await db.product.findUnique({ where: { id: input.entityId }, select: { imageUrl: true } });
    if (!p?.imageUrl) await db.product.update({ where: { id: input.entityId }, data: { imageUrl: input.items[0].url } });
    revalidatePath(`/catalog/${input.entityId}`);
    revalidatePath("/catalog");
  }
  if (input.entity === "fabric" || input.entity === "fabricOrder") revalidatePath("/inventory");
  if (input.entity === "trim") revalidatePath("/trims");
  if (input.entity === "fabricOrder") revalidatePath("/fabric-orders");
  // Change 38 Part H — trimOrder and challan were missing from this list, so an attach
  // there relied entirely on the uploader's own router.refresh().
  if (input.entity === "trimOrder") revalidatePath("/trim-orders");
  if (input.entity === "challan") revalidatePath("/challans");
  return { ok: true };
}

export async function removeImage(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  await db.imageAsset.delete({ where: { id: input.id } });
  return { ok: true };
}

export async function reorderImages(input: { ids: number[] }) {
  await requireRole("ADMIN", "STAFF");
  await db.$transaction(input.ids.map((id, i) => db.imageAsset.update({ where: { id }, data: { sortOrder: i } })));
  return { ok: true };
}

// ── Change 07 — product master ──

export async function updateProduct(input: {
  id: number; name?: string; headCategory?: string | null; status?: string;
  productionLot?: string | null; fabricRemarks?: string | null; otherRemarks?: string | null;
  fabricId?: number | null; // Change 15: link to the Fabric master
  mrp?: number | null; customWsRate?: number | null; avgConsumption?: number | null;
}) {
  await requireRole("ADMIN", "STAFF");
  const { id, ...rest } = input;
  await db.product.update({
    where: { id },
    data: {
      ...(rest.name !== undefined ? { name: rest.name } : {}),
      ...(rest.headCategory !== undefined ? { headCategory: rest.headCategory } : {}),
      ...(rest.status !== undefined ? { status: rest.status as any } : {}),
      ...(rest.productionLot !== undefined ? { productionLot: (rest.productionLot || null) as any } : {}),
      ...(rest.fabricId !== undefined ? { fabricId: rest.fabricId } : {}),
      ...(rest.fabricRemarks !== undefined ? { fabricRemarks: rest.fabricRemarks } : {}),
      ...(rest.otherRemarks !== undefined ? { otherRemarks: rest.otherRemarks } : {}),
      ...(rest.mrp !== undefined ? { mrp: rest.mrp } : {}),
      ...(rest.customWsRate !== undefined ? { customWsRate: rest.customWsRate } : {}),
      ...(rest.avgConsumption !== undefined ? { avgConsumption: rest.avgConsumption } : {}),
    } as any,
  });
  revalidatePath("/catalog");
  revalidatePath(`/catalog/${id}`);
  return { ok: true };
}

// Next PRD-#### code (Change 13). Mirrors nextSiNo: scan existing extIds, take max, pad to 4.
async function nextExtId(): Promise<string> {
  const products = await db.product.findMany({ select: { extId: true } });
  let max = 1000; // fresh DB starts at PRD-1001
  for (const p of products) {
    const m = p.extId.match(/(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `PRD-${String(max + 1).padStart(4, "0")}`;
}

// Create a new product (Change 13). Reuses the edit form in "create mode"; owner-only cost fields.
export async function createProduct(input: {
  name: string;
  skuCode?: string | null;
  styleNo?: string | null;
  itemDesc?: string | null;
  headCategory?: string | null;
  status?: string;
  productionLot?: string | null;
  avgConsumption?: number | null;
  unit?: string;
  fabricId?: number | null; // Change 15: link to the Fabric master
  mrp?: number | null;
  customWsRate?: number | null;
  fabricRemarks?: string | null;
  otherRemarks?: string | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const name = input.name.trim();
  if (!name) throw new Error("Product name is required");

  const sku = (input.skuCode ?? "").trim();
  const canSeeCost = canSeeCostFor(user);

  // Retry on the unlikely extId unique collision (concurrent creates).
  for (let attempt = 0; attempt < 3; attempt++) {
    const extId = await nextExtId();
    // normSku keeps search/dedupe working; fall back to extId when no skuCode (TBC).
    const normSku = (sku || extId).toUpperCase().replace(/[^A-Z0-9]/g, "");
    try {
      const created = await db.product.create({
        data: {
          extId,
          skuCode: sku,
          normSku,
          name,
          styleNo: input.styleNo?.trim() || null,
          itemDesc: input.itemDesc?.trim() || null,
          headCategory: input.headCategory || null,
          status: (input.status ?? "ACTIVE") as any,
          unit: (input.unit ?? "MTR") as any,
          fabricId: input.fabricId ?? null,
          productionLot: (input.productionLot || null) as any,
          avgConsumption: input.avgConsumption ?? null,
          mrp: canSeeCost ? input.mrp ?? null : null,
          customWsRate: canSeeCost ? input.customWsRate ?? null : null,
          fabricRemarks: input.fabricRemarks || null,
          otherRemarks: input.otherRemarks || null,
        } as any,
      });
      revalidatePath("/catalog");
      return { ok: true as const, id: created.id, extId: created.extId };
    } catch (e: any) {
      if (e?.code === "P2002" && attempt < 2) continue; // extId race — regenerate
      throw e;
    }
  }
  throw new Error("Could not assign a product code — please retry");
}

export async function addProductColor(input: { productId: number; name: string; hex?: string | null }) {
  await requireRole("ADMIN", "STAFF");
  const name = input.name.trim();
  if (!name) throw new Error("Colour required");
  await db.productColor.upsert({
    where: { productId_name: { productId: input.productId, name } },
    create: { productId: input.productId, name, hex: input.hex ?? null },
    update: { hex: input.hex ?? null },
  });
  revalidatePath(`/catalog/${input.productId}`);
  return { ok: true };
}

export async function removeProductColor(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  await db.productColor.delete({ where: { id: input.id } });
  return { ok: true };
}

// ── Change 09: Lookup master (generic dropdown lists) ──
const lookupSlug = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");

export async function createLookup(input: { kind: string; label: string; parentId?: number | null; hex?: string | null }) {
  await requireRole("ADMIN", "STAFF");
  const label = input.label.trim();
  if (!label) throw new Error("Label required");
  const code = lookupSlug(label);
  if (!code) throw new Error("Invalid label");
  const existing = await db.lookup.findUnique({ where: { kind_code: { kind: input.kind as any, code } } });
  if (existing) return { id: existing.id, label: existing.label };
  const max = await db.lookup.aggregate({ where: { kind: input.kind as any }, _max: { sortOrder: true } });
  const c = await db.lookup.create({
    data: { kind: input.kind as any, code, label, parentId: input.parentId ?? null, hex: input.hex ?? null, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  revalidatePath("/masters");
  return { id: c.id, label: c.label };
}

export async function updateLookup(input: { id: number; label?: string; parentId?: number | null; hex?: string | null; active?: boolean }) {
  await requireRole("ADMIN", "STAFF");
  if (input.parentId === input.id) throw new Error("A list value cannot be its own parent");
  await db.lookup.update({
    where: { id: input.id }, // NOTE: code is intentionally never updated (stable key)
    data: {
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.hex !== undefined ? { hex: input.hex } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
  revalidatePath("/masters");
  return { ok: true };
}

export async function deactivateLookup(input: { id: number; active?: boolean }) {
  await requireRole("ADMIN", "STAFF");
  await db.lookup.update({ where: { id: input.id }, data: { active: input.active ?? false } });
  revalidatePath("/masters");
  return { ok: true };
}

export async function reorderLookup(input: { ids: number[] }) {
  await requireRole("ADMIN", "STAFF");
  await db.$transaction(input.ids.map((id, i) => db.lookup.update({ where: { id }, data: { sortOrder: i } })));
  revalidatePath("/masters");
  return { ok: true };
}

// ── Change 11 — Materials Challans (inward/outward, shared inventory ledger) ──

/** Derive a challan's kind from its lines (Change 17 Part C). Null when it has no lines. */
function deriveChallanKind(
  lines: { fabricId?: number | null; trimItemId?: number | null }[]
): "FABRIC" | "TRIM" | "COMBINED" | null {
  const hasFabric = lines.some((l) => l.fabricId != null);
  const hasTrim = lines.some((l) => l.trimItemId != null);
  if (hasFabric && hasTrim) return "COMBINED";
  if (hasFabric) return "FABRIC";
  if (hasTrim) return "TRIM";
  return null;
}

/** Recompute + store a draft challan's kind after its lines change. */
async function recomputeChallanKind(challanId: number) {
  const lines = await db.materialChallanLine.findMany({ where: { challanId }, select: { fabricId: true, trimItemId: true } });
  await db.materialChallan.update({ where: { id: challanId }, data: { kind: deriveChallanKind(lines) as any } });
}

// ── Change 40 Part I — 3-letter document type codes ──────────────────────────
// The code sits between the direction and the year (CH-OUT-SUB-2026-014) so the direction
// still reads at a glance, while the COUNTER stays keyed on the direction (CH-IN-/CH-OUT-/
// CH-RET-) — one unbroken series per direction spanning every type. workType is explicit and
// wins; otherwise the code derives from the lines (kind, or CUT for a cut-goods handover).
const WORKTYPE_CODE: Record<string, string> = {
  PRINT: "PRI", EMBROIDERY: "EMB", WASH: "WSH", SUBLIMATION: "SUB", LASER: "LAS", OTHER: "OTH",
};

function challanTypeCode(c: {
  returnOfChallanId?: number | null;
  workType?: string | null;
  lines: { fabricId?: number | null; trimItemId?: number | null; cuttingLayerId?: number | null }[];
}): string {
  if (c.returnOfChallanId) return "RET";
  if (c.workType) return WORKTYPE_CODE[c.workType] ?? "OTH";
  const kind = deriveChallanKind(c.lines);
  if (kind === "FABRIC") return "FAB";
  if (kind === "TRIM") return "TRI";
  if (kind === "COMBINED") return "MIX";
  // no material lines but cut-goods present → a cutting handover (Change 39 D2)
  if (c.lines.some((l) => l.cuttingLayerId != null)) return "CUT";
  return "OTH";
}

/**
 * Change 40 Part I4 — next number in a direction's series. The type code now sits INSIDE the
 * number but OUTSIDE the counting key, so the old `slice(prefix.length)` parsed garbage from
 * the middle and would silently reissue duplicates. Parse the TRAILING digits instead. Kept
 * as a shared helper so lockChallan and createFinishingJob (I7) draw from the same outward
 * counter — the FinishingJob docNos are scanned too, or the two models would collide.
 */
async function nextChallanSeq(
  tx: Tx,
  counterPrefix: string,
  alsoScanFinishing: boolean
): Promise<number> {
  const trailing = /-(\d+)$/;
  const mc = await tx.materialChallan.findMany({ where: { challanNo: { startsWith: counterPrefix } }, select: { challanNo: true } });
  let max = mc.reduce((m, e) => { const h = trailing.exec(e.challanNo ?? ""); return Math.max(m, h ? parseInt(h[1], 10) : 0); }, 0);
  if (alsoScanFinishing) {
    const fj = await tx.finishingJob.findMany({ where: { docNo: { startsWith: counterPrefix } }, select: { docNo: true } });
    max = fj.reduce((m, e) => { const h = trailing.exec(e.docNo ?? ""); return Math.max(m, h ? parseInt(h[1], 10) : 0); }, max);
  }
  return max + 1;
}

export async function createChallan(input: {
  direction: "INWARD" | "OUTWARD";
  supplierId?: number | null;
  vendorId?: number | null;
  jobCardId?: number | null; // Change 17 Part C: the "master head" this challan is raised against
  date?: string;
  note?: string | null;
  // Change 40 Part H — an inward challan may arrive already knowing its PO (path B), or with
  // none yet (path C → poPending, link later via linkChallanToOrder).
  fabricOrderId?: number | null;
  trimOrderId?: number | null;
  poPending?: boolean;
  workType?: string | null; // Change 40 I6 — explicit job-work type for the number code
}) {
  const user = await requireRole("ADMIN", "STAFF");
  if (input.direction === "INWARD" && !input.supplierId) throw new Error("Inward challan needs a supplier");
  if (input.direction === "OUTWARD" && !input.vendorId) throw new Error("Outward challan needs a vendor");
  // Change 40 H6 — a linked PO's supplier must match the challan's supplier.
  if (input.direction === "INWARD" && input.fabricOrderId) {
    const o = await db.fabricOrder.findUnique({ where: { id: input.fabricOrderId }, select: { supplierId: true } });
    if (o && o.supplierId != null && o.supplierId !== input.supplierId) throw new Error("This PO belongs to a different supplier");
  }
  if (input.direction === "INWARD" && input.trimOrderId) {
    const o = await db.trimOrder.findUnique({ where: { id: input.trimOrderId }, select: { supplierId: true } });
    if (o && o.supplierId != null && o.supplierId !== input.supplierId) throw new Error("This PO belongs to a different supplier");
  }
  // Job-card requirement by kind is a UI warning only (spec Part C) — never blocked here.
  const c = await db.materialChallan.create({
    data: {
      direction: input.direction as any,
      supplierId: input.direction === "INWARD" ? input.supplierId ?? null : null,
      vendorId: input.direction === "OUTWARD" ? input.vendorId ?? null : null,
      jobCardId: input.jobCardId ?? null,
      fabricOrderId: input.direction === "INWARD" ? input.fabricOrderId ?? null : null,
      trimOrderId: input.direction === "INWARD" ? input.trimOrderId ?? null : null,
      poPending: input.direction === "INWARD" ? !!input.poPending && !input.fabricOrderId && !input.trimOrderId : false,
      workType: (input.workType as any) ?? null,
      date: input.date ? new Date(input.date) : new Date(),
      note: input.note ?? null,
      createdById: user.userId, // Change 39 G2 — prepared-by
    } as any,
  });
  revalidatePath("/challans");
  return { id: c.id };
}

/**
 * Change 40 Part H6 — attach a PO to an EXISTING challan (path B: goods arrived before the
 * paperwork was linked). There was no action that could do this: start from the challan and
 * the link could never be made, not even later. In one transaction it sets the FK, clears
 * poPending, fires the shared received-marking rule if the challan is already LOCKED, rejects a
 * supplier mismatch, and audit-logs. Quantity mismatch is shown by the UI, never blocked here
 * (H6.2 — "the system should just show the difference").
 */
export async function linkChallanToOrder(input: {
  challanId: number;
  fabricOrderId?: number | null;
  trimOrderId?: number | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const c = await db.materialChallan.findUnique({
    where: { id: input.challanId },
    select: { id: true, direction: true, status: true, supplierId: true, challanNo: true },
  });
  if (!c) throw new Error("Challan not found");
  if (c.direction !== "INWARD") throw new Error("Only an inward challan can be linked to a purchase order");
  if (!input.fabricOrderId && !input.trimOrderId) throw new Error("Pick a purchase order to link");

  let poLabel = "";
  if (input.fabricOrderId) {
    const o = await db.fabricOrder.findUnique({ where: { id: input.fabricOrderId }, select: { supplierId: true, poNumber: true } });
    if (!o) throw new Error("Order not found");
    if (o.supplierId != null && o.supplierId !== c.supplierId) throw new Error("This PO belongs to a different supplier");
    poLabel = o.poNumber ?? `fabric order #${input.fabricOrderId}`;
  }
  if (input.trimOrderId) {
    const o = await db.trimOrder.findUnique({ where: { id: input.trimOrderId }, select: { supplierId: true, poNumber: true } });
    if (!o) throw new Error("Order not found");
    if (o.supplierId != null && o.supplierId !== c.supplierId) throw new Error("This PO belongs to a different supplier");
    poLabel = o.poNumber ?? `trim order #${input.trimOrderId}`;
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.materialChallan.update({
      where: { id: c.id },
      data: { fabricOrderId: input.fabricOrderId ?? null, trimOrderId: input.trimOrderId ?? null, poPending: false, updatedById: user.userId },
    });
    // If the challan already posted its stock (LOCKED), linking must fire the same received
    // rule the lock path fires — otherwise the PO would never be marked received.
    if (c.status === "LOCKED") {
      await markOrdersReceived(tx, { fabricOrderId: input.fabricOrderId, trimOrderId: input.trimOrderId, now });
    }
    await logAudit(tx, user, {
      action: "linkChallanToOrder", entity: "MaterialChallan", entityId: String(c.id),
      entityLabel: c.challanNo ?? `#${c.id}`, summary: `Linked ${c.challanNo ?? `challan #${c.id}`} to ${poLabel}`,
    });
  });
  revalidatePath("/challans");
  revalidatePath(`/challan-doc/${c.id}`);
  return { ok: true };
}

/** Change 40 H3 — client-callable wrapper so the challan screen loads a supplier's open POs. */
export async function openOrdersForSupplier(supplierId: number, kind: "fabric" | "trim" | "both" = "both") {
  await requireRole("ADMIN", "STAFF");
  if (!supplierId) return [];
  return getOpenOrdersForSupplier(supplierId, kind);
}

/**
 * Change 40 H3.2 — the STRUCTURE of a PO's lines for "Fill lines from PO": fabric/trim, colour,
 * unit and rate — the things the PO genuinely knows. `orderedQty` rides along as a target only;
 * the store types the RECEIVED qty (H2.1/H4). Rolls and width are never filled here.
 */
export async function orderLinesForFill(kind: "fabric" | "trim", orderId: number) {
  await requireRole("ADMIN", "STAFF");
  if (kind === "fabric") {
    const o = await db.fabricOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
    if (!o) return [];
    const rows = o.lines.length
      ? o.lines.map((l) => ({ colour: colorKey(l.colour), orderedQty: l.qty }))
      : o.color ? [{ colour: colorKey(o.color), orderedQty: o.qty }] : [];
    return rows.filter((r) => r.orderedQty > 0).map((r) => ({
      kind: "fabric" as const, refId: o.fabricId, colour: r.colour, unit: String(o.unit), rate: o.rate ?? null, orderedQty: r.orderedQty,
    }));
  }
  const o = await db.trimOrder.findUnique({ where: { id: orderId }, include: { lines: true, trimItem: { select: { unit: true } } } });
  if (!o) return [];
  const unit = o.unit ?? o.trimItem.unit ?? "";
  // Change 40 G — a multi-trim PO fills one line per distinct trim SKU; a legacy single-item
  // order falls back to its own trimItem.
  const byItem = new Map<number, { qty: number; rate: number | null }>();
  for (const l of o.lines) {
    const id = l.trimItemId ?? o.trimItemId;
    const cur = byItem.get(id) ?? { qty: 0, rate: l.rate ?? o.rate ?? null };
    byItem.set(id, { qty: cur.qty + l.qty, rate: cur.rate });
  }
  if (byItem.size === 0) byItem.set(o.trimItemId, { qty: o.qty, rate: o.rate ?? null });
  return [...byItem.entries()].map(([refId, v]) => ({
    kind: "trim" as const, refId, colour: "", unit, rate: v.rate, orderedQty: v.qty,
  }));
}

/**
 * Change 40 Part L8 — a firm → firm transfer. One TRANSFER challan; on post it moves stock as a
 * linked pair through postMaterialMovement — an OUT at the source firm and an IN at the
 * destination for every line, in one transaction (atomic: both or neither). The all-firms total
 * (legacy currentStock) nets to zero across the pair; only the two firm balances change. Its
 * number comes from the outward counter with the material code (Part I).
 */
export async function createTransferChallan(input: {
  fromBuyerId: number; toBuyerId: number; date?: string; note?: string | null;
  lines: { kind: "fabric" | "trim"; refId: number; colour?: string | null; qty: number; unit?: string | null; rate?: number | null }[];
}) {
  const user = await requireRole("ADMIN", "STAFF");
  if (!input.fromBuyerId || !input.toBuyerId) throw new Error("Pick both the source and destination firm");
  if (input.fromBuyerId === input.toBuyerId) throw new Error("Source and destination firm must differ");
  const lines = input.lines.filter((l) => l.refId && l.qty > 0);
  if (!lines.length) throw new Error("Add at least one line to transfer");
  const now = input.date ? new Date(input.date) : new Date();
  const codeLines = lines.map((l) => ({ fabricId: l.kind === "fabric" ? l.refId : null, trimItemId: l.kind === "trim" ? l.refId : null }));
  const code = challanTypeCode({ lines: codeLines });

  const challanNo = await db.$transaction(async (tx) => {
    const seq = String(await nextChallanSeq(tx, "CH-OUT-", true)).padStart(3, "0");
    const no = `CH-OUT-${code}-${now.getFullYear()}-${seq}`;
    const c = await tx.materialChallan.create({
      data: {
        direction: "TRANSFER", status: "LOCKED", challanNo: no, date: now, lockedAt: now,
        fromBuyerId: input.fromBuyerId, toBuyerId: input.toBuyerId, note: input.note ?? null, createdById: user.userId,
        kind: deriveChallanKind(codeLines) as any,
        lines: {
          create: lines.map((l) => ({
            fabricId: l.kind === "fabric" ? l.refId : null,
            colour: l.kind === "fabric" && l.colour ? colorKey(l.colour) : null,
            trimItemId: l.kind === "trim" ? l.refId : null,
            qty: l.qty, unit: l.unit ?? null, rate: l.rate ?? null,
          })),
        },
      } as any,
    });
    for (const l of lines) {
      const base = { qty: l.qty, date: now, fabricId: l.kind === "fabric" ? l.refId : null, colour: l.colour ?? null, trimItemId: l.kind === "trim" ? l.refId : null, note: `Transfer ${no}` };
      await postMaterialMovement(tx, { ...base, direction: "OUT", buyerId: input.fromBuyerId });
      await postMaterialMovement(tx, { ...base, direction: "IN", buyerId: input.toBuyerId });
    }
    await logAudit(tx, user, { action: "createTransferChallan", entity: "MaterialChallan", entityId: String(c.id), entityLabel: no, summary: `Transferred ${lines.length} line(s) between firms — ${no}` });
    return no;
  });
  revalidatePath("/challans");
  return { challanNo };
}

// ── Change 40 Part K — press challan (in-house pressing, moves NO stock) ──────
//
// A press challan is a tracking document only: it never touches FabricColor.currentStock,
// TrimItem.currentStock or JobCard.dispatchedQty. PR-OUT and PR-IN count on separate series and
// are NOT part of the CH- series. Built standalone (owner ruling K12 — not on FinishingJob).

async function nextPressSeq(tx: Tx, direction: "OUT" | "IN"): Promise<number> {
  const prefix = direction === "OUT" ? "PR-OUT-" : "PR-IN-";
  const trailing = /-(\d+)$/;
  const rows = await tx.pressChallan.findMany({ where: { docNo: { startsWith: prefix } }, select: { docNo: true } });
  return rows.reduce((m, e) => { const h = trailing.exec(e.docNo ?? ""); return Math.max(m, h ? parseInt(h[1], 10) : 0); }, 0) + 1;
}

/**
 * Log garments for pressing (K6/K7). Picks a vendor's layers on this card, freezes their pooled
 * size×colour grid into PressChallanLine (K5 — a derived document is not a document), and mints a
 * PR-OUT number. A layer may sit on only ONE live outward per (card, vendor); a supplementary
 * top-up (K8) is the one sanctioned exception and must pass supplementaryOfId explicitly.
 */
export async function createPressOutward(input: {
  jobCardId: number; vendorId: number; layerIds: number[]; qty: number; note?: string | null; supplementaryOfId?: number | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  if (!input.layerIds.length) throw new Error("Pick at least one layer");
  if (!input.qty || input.qty <= 0) throw new Error("Enter the quantity being sent to press");
  const layers = await db.cuttingLayer.findMany({
    where: { id: { in: input.layerIds }, jobCardId: input.jobCardId, vendorId: input.vendorId },
    include: { cells: true },
  });
  if (layers.length !== input.layerIds.length) throw new Error("Some layers don't belong to this vendor on this card");
  // K7 exclusivity — unless this is a supplementary, none of these layers may already sit on a
  // live (non-void) press outward for this card+vendor. Voiding an outward frees its layers
  // automatically because that query filters voidedAt: null.
  if (!input.supplementaryOfId) {
    const clash = await db.pressChallan.findFirst({
      where: { direction: "OUT", voidedAt: null, jobCardId: input.jobCardId, vendorId: input.vendorId, layers: { some: { id: { in: input.layerIds } } } },
      select: { docNo: true },
    });
    if (clash) throw new Error(`Some of these layers are already on ${clash.docNo ?? "a live press outward"} — void it or raise a supplementary`);
  }
  // K5 — freeze the pooled grid at creation.
  const cellMap = new Map<string, number>();
  for (const l of layers) for (const c of l.cells) if (c.qty > 0) { const k = `${c.colour}|||${c.size}`; cellMap.set(k, (cellMap.get(k) ?? 0) + c.qty); }
  const now = new Date();
  const docNo = await db.$transaction(async (tx) => {
    const seq = String(await nextPressSeq(tx, "OUT")).padStart(3, "0");
    const no = `PR-OUT-${now.getFullYear()}-${seq}`;
    await tx.pressChallan.create({
      data: {
        docNo: no, direction: "OUT", date: now, jobCardId: input.jobCardId, vendorId: input.vendorId,
        qty: input.qty, note: input.note ?? null, createdById: user.userId, supplementaryOfId: input.supplementaryOfId ?? null,
        layers: { connect: input.layerIds.map((id) => ({ id })) },
        lines: { create: [...cellMap.entries()].map(([k, qty]) => { const [colour, size] = k.split("|||"); return { colour, size, qty }; }) },
      },
    });
    return no;
  });
  revalidatePath(`/job-cards/${input.jobCardId}`);
  return { docNo };
}

/** Log a return from pressing (K9) — one typed total answering an outward; no size entry. */
export async function createPressInward(input: { pressOutId: number; qty: number; note?: string | null }) {
  const user = await requireRole("ADMIN", "STAFF");
  const out = await db.pressChallan.findUnique({ where: { id: input.pressOutId }, select: { id: true, direction: true, jobCardId: true, vendorId: true, voidedAt: true } });
  if (!out || out.direction !== "OUT") throw new Error("Pick a valid press outward to answer");
  if (out.voidedAt) throw new Error("That outward was voided");
  if (!input.qty || input.qty <= 0) throw new Error("Enter the quantity received back");
  const now = new Date();
  const docNo = await db.$transaction(async (tx) => {
    const seq = String(await nextPressSeq(tx, "IN")).padStart(3, "0");
    const no = `PR-IN-${now.getFullYear()}-${seq}`;
    await tx.pressChallan.create({
      data: { docNo: no, direction: "IN", date: now, jobCardId: out.jobCardId, vendorId: out.vendorId, qty: input.qty, note: input.note ?? null, pressOutId: out.id, createdById: user.userId },
    });
    return no;
  });
  revalidatePath(`/job-cards/${out.jobCardId}`);
  return { docNo };
}

/** Void a press document (K7 — voiding an outward releases its layers back to selectable). */
export async function voidPressChallan(input: { id: number; reason?: string | null }) {
  await requireRole("ADMIN", "STAFF");
  const c = await db.pressChallan.findUnique({ where: { id: input.id }, select: { id: true, jobCardId: true, voidedAt: true } });
  if (!c) throw new Error("Press document not found");
  if (c.voidedAt) return { ok: true };
  await db.pressChallan.update({ where: { id: input.id }, data: { voidedAt: new Date(), voidReason: input.reason ?? null } });
  revalidatePath(`/job-cards/${c.jobCardId}`);
  return { ok: true };
}

/**
 * Change 39 Part D2 — raise a "cutting challan" from one lay: an OUTWARD draft challan whose
 * lines are the lay's colour × size cut goods (pieces), derived — never re-typed. Cut-goods
 * lines carry a cuttingLayerId + size and NO fabricId/trimItemId, so locking them through the
 * shared lockChallan path posts NO store-stock movement (postMaterialMovement no-ops on a
 * line with neither id). The challan still gets a number, prints, and locks like any other.
 */
export async function createCuttingChallan(input: { jobCardId: number; layerId: number; vendorId?: number | null }) {
  const user = await requireRole("ADMIN", "STAFF");
  const layer = await db.cuttingLayer.findUnique({
    where: { id: input.layerId },
    include: { cells: true, jobCard: { select: { id: true, vendorId: true } } },
  });
  if (!layer) throw new Error("Layer not found");
  if (layer.jobCardId !== input.jobCardId) throw new Error("Layer does not belong to this job card");
  const cells = layer.cells.filter((c) => c.qty > 0);
  if (!cells.length) throw new Error("This layer has no cut goods to issue");
  const vendorId = input.vendorId ?? layer.vendorId ?? layer.jobCard.vendorId;
  const c = await db.materialChallan.create({
    data: {
      direction: "OUTWARD",
      vendorId,
      jobCardId: input.jobCardId,
      note: `Cut goods · Layer ${layer.layerNo}${layer.label ? ` · ${layer.label}` : ""}`,
      createdById: user.userId, // Change 39 G2 — prepared-by
      lines: {
        create: cells.map((cell) => ({
          cuttingLayerId: layer.id,
          colour: cell.colour || null,
          size: cell.size,
          qty: cell.qty,
          unit: "PCS",
        })),
      },
    } as any,
  });
  revalidatePath("/challans");
  revalidatePath(`/job-cards/${input.jobCardId}`);
  return { id: c.id };
}

/**
 * Change 39 G3 — append a person to our firm (the first active buyer) without disturbing the
 * others, so a signatory can be added inline when none exist yet. Returns the created name.
 */
export async function createFirmContactQuick(input: { name: string }) {
  await requireRole("ADMIN", "STAFF");
  const name = input.name.trim();
  if (!name) throw new Error("Name required");
  const buyer = await db.buyer.findFirst({ where: { active: true }, orderBy: { id: "asc" }, select: { id: true } });
  if (!buyer) throw new Error("Add a firm under Masters first");
  const max = await db.contact.aggregate({ where: { buyerId: buyer.id }, _max: { sortOrder: true } });
  await db.contact.create({ data: { name, buyerId: buyer.id, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  revalidatePath("/masters");
  return { name };
}

/** Change 39 G1 — set the authorised signatory on a draft challan (firm contact name only). */
export async function setChallanSignatory(input: { id: number; signatoryName: string | null }) {
  await requireRole("ADMIN", "STAFF");
  await assertDraft(input.id);
  await db.materialChallan.update({
    where: { id: input.id },
    data: { signatoryName: input.signatoryName?.trim() || null } as any,
  });
  revalidatePath(`/challan-doc/${input.id}`);
  return { ok: true };
}

async function assertDraft(challanId: number) {
  const c = await db.materialChallan.findUnique({ where: { id: challanId }, select: { status: true } });
  if (!c) throw new Error("Challan not found");
  if (c.status !== "DRAFT") throw new Error("Challan is locked — no further line edits");
}

export async function addChallanLine(
  challanId: number,
  input: { fabricId?: number | null; colour?: string | null; trimItemId?: number | null; qty: number; unit?: string | null; rate?: number | null; note?: string | null; lotNo?: string | null; shadeRef?: string | null; rolls?: number | null; widthInch?: number | null; }
) {
  await requireRole("ADMIN", "STAFF");
  await assertDraft(challanId);
  if (!input.fabricId && !input.trimItemId) throw new Error("Line must set a fabric or a trim/accessory");
  if (input.fabricId && input.trimItemId) throw new Error("Line cannot be both fabric and trim");
  if (!input.qty || input.qty <= 0) throw new Error("Qty must be positive");
  await db.materialChallanLine.create({
    data: {
      challanId,
      fabricId: input.fabricId ?? null,
      colour: input.fabricId && input.colour ? colorKey(input.colour) : null,
      trimItemId: input.trimItemId ?? null,
      qty: input.qty,
      unit: input.unit ?? null,
      rate: input.rate ?? null,
      note: input.note ?? null,
      // Change 36 Part 8 — the supplier's lot and shade, captured where the goods
      // actually enter the system.
      lotNo: input.lotNo?.trim() || null,
      shadeRef: input.shadeRef?.trim() || null,
      // Change 40 H2 — two independent physical counts, FABRIC ONLY (never derived).
      rolls: input.fabricId ? (input.rolls ?? null) : null,
      widthInch: input.fabricId ? (input.widthInch ?? null) : null,
    },
  });
  await recomputeChallanKind(challanId);
  revalidatePath(`/challans/${challanId}`);
  revalidatePath("/challans");
  return { ok: true };
}

export async function updateChallanLine(
  id: number,
  input: { qty?: number; unit?: string | null; rate?: number | null; note?: string | null; colour?: string | null }
) {
  await requireRole("ADMIN", "STAFF");
  const line = await db.materialChallanLine.findUnique({ where: { id }, select: { challanId: true, fabricId: true } });
  if (!line) throw new Error("Line not found");
  await assertDraft(line.challanId);
  if (input.qty != null && input.qty <= 0) throw new Error("Qty must be positive");
  await db.materialChallanLine.update({
    where: { id },
    data: {
      ...(input.qty != null ? { qty: input.qty } : {}),
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
      ...(input.rate !== undefined ? { rate: input.rate } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.colour !== undefined ? { colour: line.fabricId && input.colour ? colorKey(input.colour) : null } : {}),
    },
  });
  revalidatePath(`/challans/${line.challanId}`);
  return { ok: true };
}

export async function removeChallanLine(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  const line = await db.materialChallanLine.findUnique({ where: { id: input.id }, select: { challanId: true } });
  if (!line) return { ok: true };
  await assertDraft(line.challanId);
  await db.materialChallanLine.delete({ where: { id: input.id } });
  await recomputeChallanKind(line.challanId);
  revalidatePath(`/challans/${line.challanId}`);
  return { ok: true };
}

/**
 * Change 40 H6.1 — mark the purchase order(s) a challan points at as RECEIVED. This rule
 * decides whether a PO counts as received, so it lives in ONE place and is called from both
 * lockChallan and linkChallanToOrder (a challan can be locked first, then linked). receivedDate
 * is preserved once set, so a multi-delivery PO keeps its first date. Voiding still reverts the
 * PO to ORDER_PLACED in voidChallan — that half is unchanged.
 */
async function markOrdersReceived(
  tx: Tx,
  a: { fabricOrderId?: number | null; trimOrderId?: number | null; now: Date }
): Promise<void> {
  if (a.fabricOrderId) {
    const o = await tx.fabricOrder.findUnique({ where: { id: a.fabricOrderId }, select: { receivedDate: true } });
    if (o) await tx.fabricOrder.update({ where: { id: a.fabricOrderId }, data: { status: "RECEIVED", receivedDate: o.receivedDate ?? a.now } });
  }
  if (a.trimOrderId) {
    const o = await tx.trimOrder.findUnique({ where: { id: a.trimOrderId }, select: { receivedDate: true } });
    if (o) await tx.trimOrder.update({ where: { id: a.trimOrderId }, data: { status: "RECEIVED", receivedDate: o.receivedDate ?? a.now } });
  }
}

/** Lock a challan: assign CH-IN/CH-OUT-YYYY-NNN and post every line to the shared ledger. Idempotent. */
export async function lockChallan(input: { id: number }) {
  const user = await requireRole("ADMIN", "STAFF");
  const c = await db.materialChallan.findUnique({
    where: { id: input.id },
    include: { lines: true, supplier: { select: { name: true } }, vendor: { select: { name: true } } },
  });
  if (!c) throw new Error("Challan not found");
  if (c.status === "LOCKED") return { challanNo: c.challanNo }; // idempotent
  if (c.lines.length === 0) throw new Error("Add at least one line before locking");

  const year = new Date().getFullYear();
  // Change 25 Part D: a purchase return keeps its own CH-RET- series so a debit note is never
  // mistaken for an ordinary issue. Change 40 Part I: IN/OUT gain a 3-letter type code between
  // the direction and the year (CH-OUT-SUB-2026-014); the counter still keys on the DIRECTION
  // prefix, so one unbroken series spans every type. RET stays plain (RET is the distinction).
  const isReturn = c.returnOfChallanId != null;
  const dir = c.direction === "INWARD" ? "IN" : "OUT";
  const counterPrefix = isReturn ? `CH-RET-` : dir === "IN" ? `CH-IN-` : `CH-OUT-`;
  const code = challanTypeCode(c);
  const now = new Date();
  let challanNo = "";

  await db.$transaction(async (tx) => {
    // Change 40 I4 — allocate inside the tx; trailing-digit parse; the outward counter also
    // spans FinishingJob docNos (I7) so the two never collide. @unique on challanNo is the
    // last-resort guard against a concurrent race.
    const seq = String(await nextChallanSeq(tx, counterPrefix, counterPrefix === "CH-OUT-")).padStart(3, "0");
    challanNo = isReturn ? `CH-RET-${year}-${seq}` : `CH-${dir}-${code}-${year}-${seq}`;
    await tx.materialChallan.update({
      where: { id: c.id },
      data: {
        status: "LOCKED",
        challanNo,
        lockedAt: now,
        kind: deriveChallanKind(c.lines) as any,
        updatedById: user.userId,
      },
    });
    for (const l of c.lines) {
      await postMaterialMovement(tx, {
        direction: dir,
        qty: l.qty,
        date: now,
        note: `Challan ${challanNo}`,
        fabricId: l.fabricId ?? null,
        colour: l.colour ?? null,
        // ⚠️ jobCardId is DELIBERATELY omitted, even when this challan is raised against a
        // job card. Change 19 Part B reconciles a card's fabric ledger to the manually
        // entered USED by netting StockMovement rows keyed on (fabricId, jobCardId, colour);
        // stamping jobCardId here would fold challan traffic into that net and silently
        // corrupt the true-up. Do not "fix" this. See recordFabricActuals.
        trimItemId: l.trimItemId ?? null,
      });
    }
    // Change 18 Part C / Change 40 H6.1: locking the challan is what marks its PO received.
    // Extracted so linkChallanToOrder fires the exact same rule (see markOrdersReceived).
    await markOrdersReceived(tx, { fabricOrderId: c.fabricOrderId, trimOrderId: c.trimOrderId, now });
    const counterparty = c.supplier?.name ?? c.vendor?.name ?? "—";
    await logAudit(tx, user, {
      action: "lockChallan",
      entity: "MaterialChallan",
      entityId: c.id,
      entityLabel: challanNo,
      summary: `Locked ${challanNo} — ${c.lines.length} line(s) ${
        c.direction === "INWARD" ? "in from" : "out to"
      } ${counterparty}, posted to stock`,
      changes: { status: { old: "DRAFT", new: "LOCKED" }, challanNo: { old: null, new: challanNo } },
      meta: {
        direction: c.direction,
        counterparty,
        fabricOrderId: c.fabricOrderId,
        trimOrderId: c.trimOrderId,
        lines: c.lines.map((l) => ({ fabricId: l.fabricId, trimItemId: l.trimItemId, colour: l.colour, qty: l.qty })),
      },
    });
  });
  revalidatePath("/challans");
  revalidatePath(`/challans/${c.id}`);
  revalidatePath("/inventory");
  revalidatePath("/trims");
  revalidatePath("/fabric-orders");
  revalidatePath("/trim-orders");

  // Change 39 E3 — locking a challan can change what a card is waiting on (an inward top-up
  // clears a shortage; an outward issue depletes stock). Recompute the linked card's flag
  // live from current stock so "ready cards" stays honest without a manual re-save.
  if (c.jobCardId) {
    await recomputeTrimsPending(c.jobCardId);
    // Change 39 Part F — a locked challan against a card is one of the freeze triggers.
    await syncJobLock(c.jobCardId);
    revalidatePath(`/job-cards/${c.jobCardId}`);
  }
  revalidatePath("/pending-trims");
  revalidatePath("/");

  // Change 36 Part 2 — AFTER the transaction, never inside it. This function's tx also
  // writes the stock ledger through postMaterialMovement; awaiting a transport hiccup in
  // there would roll back a real stock posting. notifyAfter never throws.
  if (c.direction === "INWARD") {
    for (const r of await ownerRecipients()) {
      notifyAfter({
        to: r.to, template: "challan.inward", userId: r.userId,
        entity: "MaterialChallan", entityId: c.id,
        body: `Received ${challanNo} — ${c.lines.length} line${c.lines.length === 1 ? "" : "s"} into stock`,
      });
    }
    // Low stock is computed, not stored, so this is the natural moment to check it:
    // stock has just moved. notify() dedupes on (template, entityId) within a day, so a
    // trim that stays below its level does not re-notify every time anything is received.
    for (const a of await getLowStockAlerts()) {
      for (const r of await ownerRecipients()) {
        notifyAfter({
          to: r.to, template: "stock.low", userId: r.userId,
          entity: a.kind, entityId: `${a.kind}-${a.id}`,
          body: `${a.name}${a.colour ? ` · ${a.colour}` : ""} is at ${num(a.currentStock)} ${a.unit} — reorder level ${num(a.reorderLevel)}`,
        });
      }
    }
  }
  return { challanNo };
}

/** Void a LOCKED challan: reverse every posted movement. */
export async function voidChallan(input: { id: number }) {
  const user = await requireRole("ADMIN", "STAFF");
  const c = await db.materialChallan.findUnique({
    where: { id: input.id },
    include: { lines: true, supplier: { select: { name: true } }, vendor: { select: { name: true } } },
  });
  if (!c) throw new Error("Challan not found");
  if (c.status !== "LOCKED" || c.voidedAt) return { ok: true, already: true as const };
  const reverse = c.direction === "INWARD" ? "OUT" : "IN"; // reverse of the original post
  const now = new Date();
  await db.$transaction(async (tx) => {
    for (const l of c.lines) {
      await postMaterialMovement(tx, {
        direction: reverse,
        qty: l.qty,
        date: now,
        note: `Void ${c.challanNo}`,
        fabricId: l.fabricId ?? null,
        colour: l.colour ?? null,
        trimItemId: l.trimItemId ?? null,
      });
    }
    // Change 18 Part C: if this was the only locked challan holding the order open as
    // "received", the order goes back to ORDER_PLACED — a voided receipt is not a receipt.
    // `id: { not: c.id }` matters: this challan's voidedAt is stamped below, in the same tx.
    if (c.fabricOrderId) {
      const others = await tx.materialChallan.count({
        where: { fabricOrderId: c.fabricOrderId, status: "LOCKED", voidedAt: null, id: { not: c.id } },
      });
      if (others === 0) {
        await tx.fabricOrder.update({
          where: { id: c.fabricOrderId },
          data: { status: "ORDER_PLACED", receivedDate: null },
        });
      }
    }
    if (c.trimOrderId) {
      const others = await tx.materialChallan.count({
        where: { trimOrderId: c.trimOrderId, status: "LOCKED", voidedAt: null, id: { not: c.id } },
      });
      if (others === 0) {
        await tx.trimOrder.update({
          where: { id: c.trimOrderId },
          data: { status: "ORDER_PLACED", receivedDate: null },
        });
      }
    }
    await tx.materialChallan.update({ where: { id: c.id }, data: { voidedAt: now, updatedById: user.userId } });
    await logAudit(tx, user, {
      action: "voidChallan",
      entity: "MaterialChallan",
      entityId: c.id,
      entityLabel: c.challanNo,
      summary: `Voided ${c.challanNo ?? `challan #${c.id}`} — reversed ${c.lines.length} posting(s) ${
        c.direction === "INWARD" ? "out of" : "back into"
      } stock`,
      changes: { voidedAt: { old: null, new: now } },
      meta: {
        direction: c.direction,
        counterparty: c.supplier?.name ?? c.vendor?.name ?? null,
        lines: c.lines.map((l) => ({ fabricId: l.fabricId, trimItemId: l.trimItemId, colour: l.colour, qty: l.qty })),
      },
    });
  });
  revalidatePath("/challans");
  revalidatePath(`/challans/${c.id}`);
  revalidatePath("/inventory");
  revalidatePath("/trims");
  revalidatePath("/fabric-orders");
  revalidatePath("/trim-orders");
  return { ok: true };
}

// ── Change 18 Parts A/B/C — PO → Inward Challan → Stock ──
//
// There is exactly ONE way goods enter stock: locking an inward challan. A purchase order
// is received by drafting a challan from it, editing the lines to what physically arrived,
// and locking that. The old one-shot "Receive" button is gone from the UI.

/** Shared head+lines writer for a PO-derived draft. Kind is derived, never hand-set. */
async function createDraftInwardChallan(
  tx: Tx,
  head: {
    supplierId: number;
    fabricOrderId?: number | null;
    trimOrderId?: number | null;
    note?: string | null;
  },
  lines: {
    fabricId?: number | null;
    colour?: string | null;
    trimItemId?: number | null;
    qty: number;
    unit?: string | null;
    rate?: number | null;
    note?: string | null; // Change 40 H4 — carries the `ordered N` target for the blank qty
  }[]
): Promise<number> {
  const c = await tx.materialChallan.create({
    data: {
      direction: "INWARD",
      status: "DRAFT",
      kind: deriveChallanKind(lines) as any,
      supplierId: head.supplierId,
      fabricOrderId: head.fabricOrderId ?? null,
      trimOrderId: head.trimOrderId ?? null,
      jobCardId: null, // a purchase is not raised against a job card
      note: head.note ?? null,
    } as any,
  });
  for (const l of lines) {
    await tx.materialChallanLine.create({
      data: {
        challanId: c.id,
        fabricId: l.fabricId ?? null,
        colour: l.fabricId && l.colour ? colorKey(l.colour) : null,
        trimItemId: l.trimItemId ?? null,
        qty: l.qty,
        unit: l.unit ?? null,
        rate: l.rate ?? null,
        note: l.note ?? null,
      },
    });
  }
  return c.id;
}

/**
 * Draft an inward challan pre-filled from a fabric PO (Change 18 Part A). The user lands on
 * the draft, corrects quantities/rates to the real delivery, and locks it — the lock is what
 * puts fabric into stock. Re-clicking returns the SAME open draft rather than spawning twins.
 */
export async function draftChallanFromFabricOrder(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  const o = await db.fabricOrder.findUnique({ where: { id: input.id }, include: { lines: true } });
  if (!o) throw new Error("Order not found");
  if (!o.supplierId) throw new Error("Add a supplier to this order before logging an inward challan");

  const open = await db.materialChallan.findFirst({
    where: { fabricOrderId: o.id, status: "DRAFT", voidedAt: null },
    select: { id: true },
  });
  if (open) return { id: open.id, already: true as const };

  // New multi-colour orders use lines[]; legacy rows fall back to the single color/qty.
  const rows =
    o.lines.length > 0
      ? o.lines.map((l) => ({ colour: colorKey(l.colour), qty: l.qty }))
      : o.color
        ? [{ colour: colorKey(o.color), qty: o.qty }]
        : [];
  // Change 40 H4 — ⚠️ live-bug fix. This used to set the received qty to r.qty (the ORDERED
  // quantity). A box already holding the right-looking number is the box nobody edits, so a
  // short delivery locked unedited credited stock with what was ORDERED, not what ARRIVED —
  // a made-up number entering the ledger through the front door. Now the PO fills only the
  // structure it genuinely knows (fabric/colour/unit/rate); qty starts BLANK (0) and the
  // ordered figure rides along as a target in the note (`ordered 1,700 MTR`). Rolls and width
  // are new nullable line fields and stay null (blank) here too.
  const lines = rows
    .filter((r) => r.qty > 0) // ordered-qty gate: one line per ordered colour…
    .map((r) => ({
      fabricId: o.fabricId,
      colour: r.colour,
      qty: 0, // …but the RECEIVED qty the store must type, not the ordered one
      unit: String(o.unit),
      rate: o.rate,
      note: `ordered ${num(r.qty)}${o.unit ? ` ${o.unit}` : ""}`,
    }));
  if (lines.length === 0) throw new Error("This order has no colour lines to receive");

  const id = await db.$transaction((tx) =>
    createDraftInwardChallan(
      tx,
      { supplierId: o.supplierId!, fabricOrderId: o.id, note: `Against ${o.poNumber ?? `order #${o.id}`}` },
      lines
    )
  );
  revalidatePath("/fabric-orders");
  revalidatePath("/challans");
  return { id };
}

/* ── Change 25 Part D — purchase returns (CH-RET-YYYY-NNN) ──
 *
 * Inward challans could be VOIDED, which says "this receipt never happened": it
 * reverses the postings and rolls the PO back to ORDER_PLACED. There was no way to
 * record the different, common event — the goods were received and accepted, and a
 * week later a defective lot went back to the supplier.
 *
 * A return is not a rewrite of history, it is a new outward movement against the
 * supplier. So: a fresh OUTWARD challan on its own CH-RET- series, linked to the
 * inward challan it came from, and the PO is left RECEIVED because the goods really
 * were received. Locking it posts OUT through the shared ledger like anything else,
 * and it can itself be voided if the return was keyed in error.
 */

export type ReturnReason = "DEFECT" | "WRONG_ITEM" | "EXCESS" | "OTHER";
const RETURN_REASONS: ReturnReason[] = ["DEFECT", "WRONG_ITEM", "EXCESS", "OTHER"];

/**
 * Draft a return against a locked inward challan. Lines default to what was received
 * and may be reduced (a partial return) but never exceed it — you cannot send back
 * more than arrived on that document.
 */
export async function createPurchaseReturn(input: {
  inwardChallanId: number;
  lines: { lineId: number; qty: number }[];
  reason: ReturnReason;
  note?: string | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  if (!RETURN_REASONS.includes(input.reason)) throw new Error("Pick a return reason");

  const src = await db.materialChallan.findUnique({
    where: { id: input.inwardChallanId },
    include: { lines: true, supplier: { select: { id: true, name: true } } },
  });
  if (!src) throw new Error("Challan not found");
  if (src.direction !== "INWARD") throw new Error("Only an inward challan can be returned to a supplier");
  if (src.status !== "LOCKED" || src.voidedAt)
    throw new Error("Only a locked, live inward challan can be returned — void the draft instead");
  if (!src.supplierId) throw new Error("This challan has no supplier to return the goods to");

  const byId = new Map(src.lines.map((l) => [l.id, l]));
  const lines: {
    fabricId: number | null;
    colour: string | null;
    trimItemId: number | null;
    qty: number;
    unit: string | null;
    rate: number | null;
  }[] = [];
  for (const r of input.lines) {
    if (!r.qty || r.qty <= 0) continue;
    const orig = byId.get(r.lineId);
    if (!orig) throw new Error("That line is not on this challan");
    if (r.qty > orig.qty + 1e-9)
      throw new Error(`Cannot return ${num(r.qty, 2)} of a line that received ${num(orig.qty, 2)}`);
    lines.push({
      fabricId: orig.fabricId,
      colour: orig.colour,
      trimItemId: orig.trimItemId,
      qty: r.qty,
      unit: orig.unit,
      rate: orig.rate,
    });
  }
  if (lines.length === 0) throw new Error("Enter a quantity on at least one line");

  const id = await db.$transaction(async (tx) => {
    const c = await tx.materialChallan.create({
      data: {
        direction: "OUTWARD",
        status: "DRAFT",
        kind: deriveChallanKind(lines) as any,
        supplierId: src.supplierId,
        vendorId: null,
        jobCardId: null,
        // Deliberately NOT carrying fabricOrderId/trimOrderId across: the PO was
        // received and stays received. Linking the return to the order would make
        // lockChallan re-stamp its status, which is exactly what must not happen.
        returnOfChallanId: src.id,
        returnReason: input.reason,
        note: input.note ?? `Return against ${src.challanNo ?? `challan #${src.id}`}`,
        createdById: user.userId,
      } as any,
    });
    for (const l of lines) {
      await tx.materialChallanLine.create({ data: { challanId: c.id, ...l } });
    }
    await logAudit(tx, user, {
      action: "createPurchaseReturn",
      entity: "MaterialChallan",
      entityId: c.id,
      entityLabel: `return of ${src.challanNo ?? `#${src.id}`}`,
      summary: `Drafted a return to ${src.supplier?.name ?? "supplier"} against ${src.challanNo ?? `challan #${src.id}`} — ${lines.length} line(s), ${input.reason}`,
      meta: {
        returnOfChallanId: src.id,
        returnOfChallanNo: src.challanNo,
        reason: input.reason,
        lines: lines.map((l) => ({ fabricId: l.fabricId, trimItemId: l.trimItemId, colour: l.colour, qty: l.qty })),
      },
    });
    return c.id;
  });

  revalidatePath("/challans");
  revalidatePath(`/challan-doc/${src.id}`);
  return { id };
}

/** Draft an inward challan pre-filled from a trim PO (Change 18 Part B). Mirror of the fabric one. */
export async function draftChallanFromTrimOrder(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  const o = await db.trimOrder.findUnique({
    where: { id: input.id },
    include: { lines: true, trimItem: { select: { unit: true } } },
  });
  if (!o) throw new Error("Order not found");
  if (!o.supplierId) throw new Error("Add a supplier to this order before logging an inward challan");

  const open = await db.materialChallan.findFirst({
    where: { trimOrderId: o.id, status: "DRAFT", voidedAt: null },
    select: { id: true },
  });
  if (open) return { id: open.id, already: true as const };

  const unit = o.unit ?? o.trimItem.unit ?? null;
  // Change 40 G — ONE challan line per trim ITEM (not per colour), so a multi-trim PO drafts
  // correctly. H4 — received qty starts BLANK (0); the ordered total is a target in the note.
  const byItem = new Map<number, { qty: number; rate: number | null }>();
  for (const l of o.lines) {
    const id = l.trimItemId ?? o.trimItemId;
    const cur = byItem.get(id) ?? { qty: 0, rate: l.rate ?? o.rate ?? null };
    byItem.set(id, { qty: cur.qty + l.qty, rate: cur.rate });
  }
  if (byItem.size === 0) byItem.set(o.trimItemId, { qty: o.qty, rate: o.rate ?? null });
  const lines = [...byItem.entries()]
    .filter(([, v]) => v.qty > 0)
    .map(([trimItemId, v]) => ({ trimItemId, qty: 0, unit, rate: v.rate, note: `ordered ${num(v.qty)}${unit ? ` ${unit}` : ""}` }));
  if (lines.length === 0) throw new Error("This order has nothing to receive");

  const id = await db.$transaction((tx) =>
    createDraftInwardChallan(
      tx,
      { supplierId: o.supplierId!, trimOrderId: o.id, note: `Against ${o.poNumber ?? `order #${o.id}`}` },
      lines
    )
  );
  revalidatePath("/trim-orders");
  revalidatePath("/challans");
  return { id };
}

/**
 * Edit a LOCKED challan (Change 17 Part C). Reverses every old line's ledger posting,
 * replaces the whole line set, and re-posts — all in one transaction — so the master stock
 * stays exact (void + reissue under the hood). Keeps the number; over-issue may go negative.
 * DRAFT challans use the add/update/remove line actions instead.
 * The challan stays LOCKED throughout, so a linked purchase order stays RECEIVED (Change 18 C).
 */
export async function editLockedChallan(input: {
  id: number;
  // Change 36 Part 8: lot/shade MUST be here. This action deletes and recreates every
  // line, so a field missing from this type is silently wiped on every edit.
  lines: { fabricId?: number | null; colour?: string | null; trimItemId?: number | null; qty: number; unit?: string | null; rate?: number | null; note?: string | null; lotNo?: string | null; shadeRef?: string | null; }[];
  note?: string | null;
  jobCardId?: number | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const c = await db.materialChallan.findUnique({ where: { id: input.id }, include: { lines: true } });
  if (!c) throw new Error("Challan not found");
  if (c.status !== "LOCKED") throw new Error("Only a locked challan is edited this way — use the draft editor");
  if (c.voidedAt) throw new Error("Challan is voided — raise a fresh challan");

  // Validate the incoming line set (same rules as addChallanLine).
  const newLines = input.lines.filter((l) => l.qty !== 0);
  for (const l of newLines) {
    if (!l.fabricId && !l.trimItemId) throw new Error("Line must set a fabric or a trim/accessory");
    if (l.fabricId && l.trimItemId) throw new Error("Line cannot be both fabric and trim");
    if (!l.qty || l.qty <= 0) throw new Error("Qty must be positive");
  }
  if (newLines.length === 0) throw new Error("A locked challan must keep at least one line");

  const reverse = c.direction === "INWARD" ? "OUT" : "IN"; // undo the original post
  const dir = c.direction === "INWARD" ? "IN" : "OUT"; // re-post the new set
  const now = new Date();

  await db.$transaction(async (tx) => {
    // 1) reverse every OLD posting
    for (const l of c.lines) {
      await postMaterialMovement(tx, {
        direction: reverse, qty: l.qty, date: now, note: `Edit reverse ${c.challanNo}`,
        fabricId: l.fabricId ?? null, colour: l.colour ?? null, trimItemId: l.trimItemId ?? null,
      });
    }
    // 2) swap the line set
    await tx.materialChallanLine.deleteMany({ where: { challanId: c.id } });
    for (const l of newLines) {
      await tx.materialChallanLine.create({
        data: {
          challanId: c.id,
          fabricId: l.fabricId ?? null,
          colour: l.fabricId && l.colour ? colorKey(l.colour) : null,
          trimItemId: l.trimItemId ?? null,
          qty: l.qty, unit: l.unit ?? null, rate: l.rate ?? null, note: l.note ?? null,
          // Change 36 Part 8 — carried through the delete/recreate, or the lot is lost.
          lotNo: l.lotNo?.trim() || null,
          shadeRef: l.shadeRef?.trim() || null,
        },
      });
    }
    // 3) re-post every NEW line
    for (const l of newLines) {
      await postMaterialMovement(tx, {
        direction: dir, qty: l.qty, date: now, note: `Challan ${c.challanNo}`,
        fabricId: l.fabricId ?? null, colour: l.fabricId ? l.colour ?? null : null, trimItemId: l.trimItemId ?? null,
      });
    }
    // 4) refresh derived kind + head fields; keep challanNo + LOCKED, voidedAt stays null
    await tx.materialChallan.update({
      where: { id: c.id },
      data: {
        kind: deriveChallanKind(newLines) as any,
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.jobCardId !== undefined ? { jobCardId: input.jobCardId } : {}),
        updatedById: user.userId,
      } as any,
    });
    const lineTotal = (ls: { qty: number }[]) => Math.round(ls.reduce((a, l) => a + l.qty, 0) * 100) / 100;
    await logAudit(tx, user, {
      action: "editLockedChallan",
      entity: "MaterialChallan",
      entityId: c.id,
      entityLabel: c.challanNo,
      summary: `Edited locked ${c.challanNo ?? `challan #${c.id}`} — ${c.lines.length} → ${newLines.length} line(s), ${num(lineTotal(c.lines), 2)} → ${num(lineTotal(newLines), 2)} total`,
      changes: {
        lineCount: { old: c.lines.length, new: newLines.length },
        total: { old: lineTotal(c.lines), new: lineTotal(newLines) },
        ...(input.note !== undefined && input.note !== c.note ? { note: { old: c.note, new: input.note } } : {}),
        ...(input.jobCardId !== undefined && input.jobCardId !== c.jobCardId
          ? { jobCardId: { old: c.jobCardId, new: input.jobCardId } }
          : {}),
      },
      meta: {
        before_snapshot: {
          lines: c.lines.map((l) => ({ fabricId: l.fabricId, trimItemId: l.trimItemId, colour: l.colour, qty: l.qty })),
        },
        after_preview: {
          lines: newLines.map((l) => ({ fabricId: l.fabricId ?? null, trimItemId: l.trimItemId ?? null, colour: l.colour ?? null, qty: l.qty })),
        },
      },
    });
  });

  revalidatePath("/challans");
  revalidatePath(`/challans/${c.id}`);
  revalidatePath(`/challan-doc/${c.id}`);
  revalidatePath("/inventory");
  revalidatePath("/trims");
  return { ok: true, challanNo: c.challanNo };
}

// ─────────────────────────────────────────────────────────────────────────────
// Change 22 — "Undo everywhere": reversals, edits & stock corrections
//
// House rules, applied throughout this block:
//   · never hard-delete a posted ledger row — post the inverse movement;
//   · balances MAY go negative (real over-issue / over-cut) — never clamp;
//   · every reversal is idempotent where it can be;
//   · every stock-changing action writes a movement, so the ledger and the
//     balance can never silently disagree.
// The materials-challan void/edit pair (voidChallan / editLockedChallan) is the
// model everything below copies.
// ─────────────────────────────────────────────────────────────────────────────

/** Change 22 Part E: why a hand stock adjustment happened. */
export type AdjustReason = "COUNT" | "DAMAGE" | "WASTAGE" | "OPENING" | "OTHER";

function revalidateDispatch(jobCardId: number) {
  revalidatePath("/");
  revalidatePath("/dispatch");
  revalidatePath("/board");
  revalidatePath("/job-cards");
  revalidatePath(`/job-cards/${jobCardId}`);
  revalidatePath(`/dispatch-doc/${jobCardId}`);
}

/**
 * Change 22 B.1 — void a dispatch. The pieces go back onto the card and a card that
 * closed *because of* this dispatch reopens.
 *
 * Deliberately posts NO material movement: dispatch never touched the fabric/trim
 * ledger (finished goods live in the ERP, Change 21), so its reversal must not either.
 * The DC- number and the document survive as a voided record.
 */
export async function voidDispatch(input: { id: number }) {
  const user = await requireRole("ADMIN", "STAFF");
  const e = await db.dispatchEvent.findUnique({
    where: { id: input.id },
    include: { jobCard: { select: { id: true, cutQty: true, dispatchedQty: true, status: true, siNo: true } } },
  });
  if (!e) throw new Error("Dispatch not found");
  if (e.voidedAt) return { ok: true, already: true as const }; // idempotent

  const job = e.jobCard;
  const newDispatched = job.dispatchedQty - e.qty;
  // Reopen only when this dispatch is what closed it — i.e. the card no longer meets its
  // own cut quantity. A card closed by hand stays closed.
  const reopen = job.status === "CLOSED" && newDispatched < job.cutQty;

  await db.$transaction(async (tx) => {
    await tx.dispatchEvent.update({
      where: { id: e.id },
      data: { voidedAt: new Date(), updatedById: user.userId },
    });
    await tx.jobCard.update({
      where: { id: job.id },
      data: {
        dispatchedQty: newDispatched,
        ...(reopen ? { status: "ACTIVE" as const } : {}),
        updatedById: user.userId,
      },
    });
    await logAudit(tx, user, {
      action: "voidDispatch",
      entity: "DispatchEvent",
      entityId: e.id,
      entityLabel: e.dispatchNo,
      summary: `Voided ${e.dispatchNo ?? `dispatch #${e.id}`}, ${num(e.qty)} pcs back to ${job.siNo}${reopen ? " (card reopened)" : ""}`,
      changes: {
        // The DC keeps its qty and its document — voidedAt is what actually changed.
        voidedAt: { old: null, new: new Date() },
        "jobCard.dispatchedQty": { old: job.dispatchedQty, new: newDispatched },
        ...(reopen ? { "jobCard.status": { old: "CLOSED", new: "ACTIVE" } } : {}),
      },
      meta: { siNo: job.siNo, jobCardId: job.id, reason: e.reason, date: e.date },
    });
  });

  revalidateDispatch(job.id);
  revalidatePath(`/dispatch-doc/${e.id}`);
  return { ok: true, dispatchNo: e.dispatchNo, dispatched: newDispatched, reopened: reopen };
}

/**
 * Change 22 B.2 — correct a dispatch WITHOUT losing its DC- number (the void-and-reissue
 * discipline of editLockedChallan, applied to the card counters instead of the ledger).
 */
export async function editDispatch(input: {
  id: number;
  lines?: { colour?: string | null; size: string; qty: number }[];
  qty?: number;
  date?: string;
  reason?: "ORDER" | "SALE" | "OTHER";
  note?: string | null;
  challan?: string | null;
  arrangedBy?: string | null;
  layerIds?: number[];
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const e = await db.dispatchEvent.findUnique({
    where: { id: input.id },
    include: { jobCard: { select: { id: true, cutQty: true, dispatchedQty: true, status: true, siNo: true } } },
  });
  if (!e) throw new Error("Dispatch not found");
  if (e.voidedAt) throw new Error("This dispatch is voided — log a fresh one instead");

  const lines = (input.lines ?? []).filter((l) => l.qty !== 0);
  const newQty = lines.length ? lines.reduce((a, l) => a + l.qty, 0) : input.qty ?? e.qty;
  if (!lines.length && newQty === 0) throw new Error("A dispatch must keep a quantity");

  const job = e.jobCard;
  // old total − this event's old qty + its new qty
  const newDispatched = job.dispatchedQty - e.qty + newQty;
  const closed = newDispatched >= job.cutQty && job.cutQty > 0;

  await db.$transaction(async (tx) => {
    if (input.lines) {
      await tx.dispatchLine.deleteMany({ where: { eventId: e.id } });
      for (const l of lines) {
        await tx.dispatchLine.create({
          data: { eventId: e.id, colour: l.colour ?? null, size: l.size, qty: l.qty },
        });
      }
    }
    await tx.dispatchEvent.update({
      where: { id: e.id },
      data: {
        qty: newQty,
        ...(input.date ? { date: new Date(input.date) } : {}),
        ...(input.reason ? { reason: input.reason as any } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.challan !== undefined ? { challan: input.challan } : {}),
        ...(input.arrangedBy !== undefined ? { arrangedBy: input.arrangedBy } : {}),
        // `set` (not `connect`) so removing a layer from the event actually removes it.
        ...(input.layerIds ? { layers: { set: input.layerIds.map((id) => ({ id })) } } : {}),
        updatedById: user.userId,
      } as any,
    });
    await tx.jobCard.update({
      where: { id: job.id },
      data: { dispatchedQty: newDispatched, status: closed ? "CLOSED" : "ACTIVE", updatedById: user.userId },
    });
    await logAudit(tx, user, {
      action: "editDispatch",
      entity: "DispatchEvent",
      entityId: e.id,
      entityLabel: e.dispatchNo,
      summary: `Edited ${e.dispatchNo ?? `dispatch #${e.id}`} on ${job.siNo} — ${num(e.qty)} → ${num(newQty)} pcs`,
      changes: computeChanges(
        { qty: e.qty, date: e.date, reason: e.reason, note: e.note, challan: e.challan, arrangedBy: e.arrangedBy },
        {
          qty: newQty,
          ...(input.date ? { date: new Date(input.date) } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.challan !== undefined ? { challan: input.challan } : {}),
          ...(input.arrangedBy !== undefined ? { arrangedBy: input.arrangedBy } : {}),
        } as Record<string, unknown>,
      ),
      meta: { siNo: job.siNo, jobCardId: job.id, dispatchedQty: { old: job.dispatchedQty, new: newDispatched } },
    });
  });

  revalidateDispatch(job.id);
  revalidatePath(`/dispatch-doc/${e.id}`);
  return { ok: true, dispatchNo: e.dispatchNo, dispatched: newDispatched, closed };
}

/**
 * Change 22 B.3 — explicit reopen/close for a job card, for the case a card closed on
 * over-dispatch but work remains (or the reverse).
 */
export async function setJobCardOpen(input: { id: number; open: boolean }) {
  const user = await requireRole("ADMIN", "STAFF");
  const before = await db.jobCard.findUnique({
    where: { id: input.id },
    select: { status: true, siNo: true },
  });
  if (!before) throw new Error("Job card not found");
  const next = input.open ? ("ACTIVE" as const) : ("CLOSED" as const);

  const job = await db.$transaction(async (tx) => {
    const j = await tx.jobCard.update({
      where: { id: input.id },
      data: { status: next, updatedById: user.userId },
      select: { id: true, siNo: true, status: true },
    });
    await logAudit(tx, user, {
      action: "setJobCardOpen",
      entity: "JobCard",
      entityId: j.id,
      entityLabel: j.siNo,
      summary: `${input.open ? "Reopened" : "Closed"} job card ${j.siNo}`,
      changes: { status: { old: before.status, new: next } },
    });
    return j;
  });

  revalidatePath("/");
  revalidatePath("/board");
  revalidatePath("/job-cards");
  revalidatePath(`/job-cards/${job.id}`);
  return { ok: true, status: job.status };
}

/**
 * The fabric a single cutting layer was issued, per colour — recomputed with the SAME
 * formula that issued it (createJobCard's per-colour split and addCuttingLayer ~:917
 * agree): a lay's `fabricMtr` split across its colours by cut proportion, else avg × qty.
 * Used to reverse a layer exactly, whether it was created with the card or appended later.
 */
function layerFabricByColour(
  layer: { fabricMtr: number | null; avgConsumption: number | null; cells: { colour: string; qty: number }[] },
  cardAvg: number | null
): Map<string, number> {
  const out = new Map<string, number>();
  const total = layer.cells.reduce((a, c) => a + c.qty, 0);
  if (total <= 0) return out;
  const byCol = new Map<string, number>();
  for (const c of layer.cells) byCol.set(colorKey(c.colour), (byCol.get(colorKey(c.colour)) ?? 0) + c.qty);
  const avg = layer.avgConsumption ?? cardAvg;
  for (const [col, q] of byCol) {
    const issued =
      layer.fabricMtr != null
        ? Math.round(layer.fabricMtr * (q / total) * 100) / 100
        : avg != null
          ? Math.round(q * avg * 100) / 100
          : 0;
    if (issued > 0) out.set(col, issued);
  }
  return out;
}

/**
 * Change 22 C.1 — delete a job card created by mistake, reversing every stock movement
 * it posted so master stock returns to where it was.
 *
 * Guarded like deleteTrimOrder: a card that has already moved goods can't just vanish.
 * The card's own ledger rows are NOT deleted — they are detached (jobCardId → null) and
 * an inverse movement is posted, so the ledger keeps a truthful history of both.
 */
export async function deleteJobCard(input: { id: number }) {
  const user = await requireRole("ADMIN", "STAFF");
  const job = await db.jobCard.findUnique({
    where: { id: input.id },
    select: { id: true, siNo: true, cutQty: true, dispatchedQty: true, stage: true, status: true, productId: true },
  });
  if (!job) throw new Error("Job card not found");

  const liveDispatches = await db.dispatchEvent.count({ where: { jobCardId: job.id, voidedAt: null } });
  if (liveDispatches > 0)
    throw new Error(
      `${liveDispatches} dispatch${liveDispatches === 1 ? "" : "es"} logged against ${job.siNo} — void them first, then delete the card`
    );
  const lockedChallans = await db.materialChallan.count({
    where: { jobCardId: job.id, status: "LOCKED", voidedAt: null },
  });
  if (lockedChallans > 0)
    throw new Error(
      `${lockedChallans} locked challan${lockedChallans === 1 ? "" : "s"} raised against ${job.siNo} — void them first, then delete the card`
    );

  // Net this card's OWN postings per (fabric, colour). Challan traffic is never stamped
  // with a jobCardId (see the comment in lockChallan), so these rows are exactly the
  // card's cutting issues and any fabric returned against it.
  const movements = await db.stockMovement.findMany({
    where: { jobCardId: job.id },
    select: { id: true, type: true, qty: true, fabricId: true, color: true },
  });
  const net = new Map<string, { fabricId: number; colour: string | null; qty: number }>();
  for (const m of movements) {
    const key = `${m.fabricId}::${m.color ?? ""}`;
    const row = net.get(key) ?? { fabricId: m.fabricId, colour: m.color, qty: 0 };
    row.qty += m.type === "RECEIPT" ? m.qty : -m.qty;
    net.set(key, row);
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    // 1) post the inverse of the card's net effect on each fabric colour
    for (const r of net.values()) {
      if (Math.abs(r.qty) < 0.005) continue;
      await postMaterialMovement(tx, {
        // net negative ⇒ the card took stock out ⇒ put it back IN
        direction: r.qty < 0 ? "IN" : "OUT",
        qty: Math.abs(Math.round(r.qty * 100) / 100),
        date: now,
        fabricId: r.fabricId,
        colour: r.colour,
        jobCardId: null, // the card is about to go; the reversal stands on its own
        note: `Reverse ${job.siNo} (job card deleted)`,
      });
    }
    // 2) detach — never destroy — the card's historical ledger rows
    await tx.stockMovement.updateMany({ where: { jobCardId: job.id }, data: { jobCardId: null } });
    // 3) drop the card's own children. Layers/cells, fabric lines and stitch assignments
    //    cascade; these four do not.
    await tx.dispatchLine.deleteMany({ where: { event: { jobCardId: job.id } } });
    await tx.dispatchEvent.deleteMany({ where: { jobCardId: job.id } }); // voided only, per the guard
    await tx.jobBomLine.deleteMany({ where: { jobCardId: job.id } });
    await tx.returnNote.deleteMany({ where: { jobCardId: job.id } });
    await tx.sizeBreakup.deleteMany({ where: { jobCardId: job.id } });
    // 4) the auto-drafted trim challan (Change 19 A.2) dies with the card; a voided one
    //    is history and merely loses its card link.
    await tx.materialChallanLine.deleteMany({ where: { challan: { jobCardId: job.id, status: "DRAFT" } } });
    await tx.materialChallan.deleteMany({ where: { jobCardId: job.id, status: "DRAFT" } });
    await tx.materialChallan.updateMany({ where: { jobCardId: job.id }, data: { jobCardId: null } });
    await tx.jobCard.delete({ where: { id: job.id } });
    // The row is gone but the log keeps the snapshot — AuditLog holds no FK to it.
    await logAudit(tx, user, {
      action: "deleteJobCard",
      entity: "JobCard",
      entityId: job.id,
      entityLabel: job.siNo,
      summary: `Deleted job card ${job.siNo} (${num(job.cutQty)} pcs cut), reversing ${
        [...net.values()].filter((r) => Math.abs(r.qty) >= 0.005).length
      } fabric posting(s)`,
      meta: {
        before_snapshot: { row: job },
        reversed: [...net.values()]
          .filter((r) => Math.abs(r.qty) >= 0.005)
          .map((r) => ({ fabricId: r.fabricId, colour: r.colour, qty: Math.round(r.qty * 100) / 100 })),
      },
    });
  });

  revalidatePath("/");
  revalidatePath("/job-cards");
  revalidatePath("/board");
  revalidatePath("/inventory");
  revalidatePath("/trims");
  revalidatePath("/challans");
  revalidatePath("/dispatch");
  return { ok: true, siNo: job.siNo, reversed: [...net.values()].filter((r) => Math.abs(r.qty) >= 0.005).length };
}

/**
 * Change 22 C.2 — edit a job card's light header metadata. Deliberately does NOT touch
 * the cut matrix, the product, or any stock: quantity changes stay on the existing
 * "Add split / re-cut" flow, and a metadata edit must never silently re-post fabric.
 * MRP stays owner-only, exactly as in createJobCard.
 */
export async function updateJobCard(input: {
  id: number;
  siNo?: string;
  plannedEtd?: string | null;
  merchandiser?: string | null;
  remark?: string | null;
  needsPrint?: boolean;
  needsLaser?: boolean;
  needsEmb?: boolean;
  customItem?: string | null;
  customSku?: string | null;
  customStyle?: string | null;
  mrp?: number | null;
  customMrp?: number | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const job = await db.jobCard.findUnique({
    where: { id: input.id },
    select: {
      id: true, productId: true, siNo: true, plannedEtd: true, merchandiser: true, remark: true,
      needsPrint: true, needsLaser: true, needsEmb: true, customItem: true, customSku: true,
      customStyle: true, mrp: true, customMrp: true,
    },
  });
  if (!job) throw new Error("Job card not found");

  const siNo = input.siNo?.trim();
  if (input.siNo !== undefined && !siNo) throw new Error("SI cannot be blank");
  const owner = canSeeCostFor(user);

  const patch = {
      ...(siNo ? { siNo } : {}),
      ...(input.plannedEtd !== undefined ? { plannedEtd: input.plannedEtd ? new Date(input.plannedEtd) : null } : {}),
      ...(input.merchandiser !== undefined ? { merchandiser: input.merchandiser } : {}),
      ...(input.remark !== undefined ? { remark: input.remark } : {}),
      ...(input.needsPrint !== undefined ? { needsPrint: input.needsPrint } : {}),
      ...(input.needsLaser !== undefined ? { needsLaser: input.needsLaser } : {}),
      ...(input.needsEmb !== undefined ? { needsEmb: input.needsEmb } : {}),
      // custom item/style/sku only mean anything on a made-to-order card
      ...(!job.productId && input.customItem !== undefined ? { customItem: input.customItem } : {}),
      ...(!job.productId && input.customSku !== undefined ? { customSku: input.customSku } : {}),
      ...(!job.productId && input.customStyle !== undefined ? { customStyle: input.customStyle } : {}),
      ...(owner && input.mrp !== undefined ? { mrp: input.mrp } : {}),
      ...(owner && !job.productId && input.customMrp !== undefined ? { customMrp: input.customMrp } : {}),
  } as Record<string, unknown>;

  const changes = computeChanges(job as unknown as Record<string, unknown>, patch);

  await db.$transaction(async (tx) => {
    await tx.jobCard.update({
      where: { id: job.id },
      data: { ...patch, updatedById: user.userId } as any,
    });
    await logAudit(tx, user, {
      action: "updateJobCard",
      entity: "JobCard",
      entityId: job.id,
      entityLabel: siNo || job.siNo,
      summary: changes
        ? `Edited ${Object.keys(changes).join(", ")} on job card ${job.siNo}`
        : `Saved job card ${job.siNo} with no changes`,
      changes,
    });
  });

  revalidatePath("/job-cards");
  revalidatePath(`/job-cards/${job.id}`);
  revalidatePath("/board");
  return { ok: true };
}

/**
 * Change 22 Part D — edit a cutting layer. Cell edits move the card's cut quantity by the
 * delta.
 *
 * Change 37 revises the old rule here. It used to read: "they do NOT re-post fabric.
 * Fabric is trued up in exactly one place (recordFabricActuals) and posting here too
 * would double-count the lay." That was true while addCuttingLayer APPENDED movements —
 * a second appender would stack on the same net. Now every writer goes through
 * reconcileJobFabricColour, which NETS to a target, so a second writer converges instead
 * of stacking and the double-count is no longer possible.
 *
 * The constraint it protected still holds and is now enforced by the helper, not by
 * abstinence: editing per-colour USED re-drives the ledger to the card's total entered
 * USED for that colour. Layers with no colour rows still post nothing from here.
 */
export async function updateCuttingLayer(input: {
  id: number;
  vendorName?: string | null;
  cuttingMaster?: string | null;
  cutDate?: string | null;
  label?: string | null;
  rolls?: number | null;
  fabricMtr?: number | null;
  fabricIssued?: number | null;
  fabricBalance?: number | null;
  avgConsumption?: number | null;
  sizeRatio?: string | null;
  cells?: { colour: string; size: string; qty: number }[];
  // Change 37 — per-colour fabric for this lay. Undefined leaves the rows alone.
  // Change 38 Part B — issued + balance typed, USED derived.
  fabricByColour?: ColourFabricInput[] | null;
  // Change 36 Part 8 — the lot this lay was cut from.
  fabricLotNo?: string | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const layer = await db.cuttingLayer.findUnique({
    where: { id: input.id },
    include: { cells: true, colours: true, jobCard: { select: { id: true, siNo: true, buyerId: true, product: { select: { fabricId: true } } } } },
  });
  if (!layer) throw new Error("Cutting layer not found");
  // Change 39 Part F — a card frozen after material issued cannot have its cells/ratio/fabric
  // edited until an admin unlocks it for correction.
  await assertJobEditable(layer.jobCardId);

  const oldTotal = layer.cells.reduce((a, c) => a + c.qty, 0);
  const cells = input.cells
    ?.filter((c) => c.qty > 0 && sizeKey(c.size) !== "") // Change 26 E
    .map((c) => ({ colour: colorKey(c.colour), size: sizeKey(c.size), qty: c.qty }));
  if (cells && cells.length === 0) throw new Error("A layer needs at least one cell — remove the layer instead");
  const newTotal = cells ? cells.reduce((a, c) => a + c.qty, 0) : oldTotal;

  // Change 37 — canonicalise the incoming colour rows and derive the layer totals from
  // them, so fabricMtr/fabricIssued stay the sum of the colour rows for every read site.
  // Change 38 Part B — issued + balance typed, USED derived (colourFabricRows).
  const colourRows = input.fabricByColour === undefined ? undefined : colourFabricRows(input.fabricByColour);
  const hasRows = colourRows != null && colourRows.size > 0;

  const patch = {
        ...(input.cutDate !== undefined ? { cutDate: input.cutDate ? new Date(input.cutDate) : null } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.rolls !== undefined ? { rolls: input.rolls } : {}),
        ...(hasRows
          ? {
              fabricMtr: sumColourFabric(colourRows!, "fabricUsed"),
              fabricIssued: sumColourFabric(colourRows!, "fabricIssued"),
              fabricBalance: sumColourFabric(colourRows!, "fabricBalance"),
            }
          : {
        ...(input.fabricMtr !== undefined ? { fabricMtr: input.fabricMtr } : {}),
        ...(input.fabricIssued !== undefined ? { fabricIssued: input.fabricIssued } : {}),
        ...(input.fabricBalance !== undefined ? { fabricBalance: input.fabricBalance } : {}),
            }),
        ...(input.avgConsumption !== undefined ? { avgConsumption: input.avgConsumption } : {}),
        ...(input.sizeRatio !== undefined ? { sizeRatio: input.sizeRatio } : {}),
        ...(input.fabricLotNo !== undefined ? { fabricLotNo: input.fabricLotNo?.trim() || null } : {}),
  } as Record<string, unknown>;

  await db.$transaction(async (tx) => {
    const vendorId = input.vendorName !== undefined ? await resolveVendorId(tx, input.vendorName) : undefined;
    const masterId = input.cuttingMaster ? await resolveCuttingMaster(tx, input.cuttingMaster) : undefined;
    if (cells) {
      await tx.cuttingLayerCell.deleteMany({ where: { layerId: layer.id } });
      for (const c of cells) await tx.cuttingLayerCell.create({ data: { layerId: layer.id, ...c } });
    }
    await tx.cuttingLayer.update({
      where: { id: layer.id },
      data: {
        ...(vendorId !== undefined && vendorId !== null ? { vendorId } : {}),
        ...(masterId !== undefined ? { cuttingMasterId: masterId } : {}),
        ...patch,
        updatedById: user.userId,
      } as any,
    });
    if (newTotal !== oldTotal) {
      await tx.jobCard.update({
        where: { id: layer.jobCardId },
        data: { cutQty: { increment: newTotal - oldTotal }, updatedById: user.userId } as any,
      });
    }

    // ── Change 37: per-colour fabric, and the ledger drive that follows from it ──
    if (colourRows !== undefined) {
      await tx.cuttingLayerColour.deleteMany({ where: { layerId: layer.id } });
      for (const [colour, v] of colourRows) {
        await tx.cuttingLayerColour.create({ data: { layerId: layer.id, colour, ...v } });
      }

      const fabricId = layer.jobCard.product?.fabricId ?? null;
      if (fabricId && hasRows) {
        // The target is the CARD's total entered USED for the colour — Σ across every
        // layer that carries rows — not this layer's figure alone. The ledger has no
        // layer dimension (StockMovement is keyed fabric+jobCard+colour), so a per-layer
        // target would have each layer fighting the others for the same net.
        const sibling = await tx.cuttingLayerColour.findMany({
          where: { layer: { jobCardId: layer.jobCardId } },
          select: { colour: true, fabricUsed: true },
        });
        const target = new Map<string, number>();
        for (const s of sibling) {
          if (s.fabricUsed == null) continue;
          const k = colorKey(s.colour);
          target.set(k, (target.get(k) ?? 0) + s.fabricUsed);
        }
        for (const [colour, used] of target) {
          await tx.jobFabricLine.updateMany({
            where: { jobCardId: layer.jobCardId, fabricId, color: colour },
            data: { qtyUsed: used },
          });
          await reconcileJobFabricColour(tx, {
            fabricId, jobCardId: layer.jobCardId, siNo: layer.jobCard.siNo,
            colour, used, reason: `Layer ${layer.layerNo}`,
            buyerId: layer.jobCard.buyerId, // Change 40 L
          });
        }
      }
    }

    const changes = computeChanges(layer as unknown as Record<string, unknown>, patch);
    await logAudit(tx, user, {
      action: "updateCuttingLayer",
      entity: "CuttingLayer",
      entityId: layer.id,
      entityLabel: `${layer.jobCard.siNo} · layer ${layer.layerNo}`,
      summary:
        newTotal !== oldTotal
          ? `Edited layer ${layer.layerNo} on ${layer.jobCard.siNo} — cut ${num(oldTotal)} → ${num(newTotal)} pcs`
          : `Edited layer ${layer.layerNo} on ${layer.jobCard.siNo}`,
      changes: {
        ...(changes ?? {}),
        ...(newTotal !== oldTotal ? { "layer.cutQty": { old: oldTotal, new: newTotal } } : {}),
      },
      meta: { jobCardId: layer.jobCardId },
    });
  });

  // Change 39 Part F — re-freeze after a correction save (still meets the derived lock).
  await syncJobLock(layer.jobCardId);
  revalidatePath(`/job-cards/${layer.jobCardId}`);
  revalidatePath("/job-cards");
  revalidatePath("/board");
  revalidatePath("/vendors");
  return { ok: true };
}

/**
 * Change 22 Part D — remove a cutting layer, reversing the fabric it was issued and
 * taking its pieces back off the card's cut quantity.
 *
 * Guarded: a layer that has already been dispatched against can't be removed (void the
 * dispatch first) — you can't un-cut cloth that has already come back stitched.
 */
export async function removeCuttingLayer(input: { id: number }) {
  const user = await requireRole("ADMIN", "STAFF");
  const layer = await db.cuttingLayer.findUnique({
    where: { id: input.id },
    include: {
      cells: true,
      colours: true,
      dispatches: { where: { voidedAt: null }, select: { id: true, dispatchNo: true } },
      jobCard: { select: { id: true, siNo: true, buyerId: true, estAvg: true, product: { select: { fabricId: true } } } },
    },
  });
  if (!layer) throw new Error("Cutting layer not found");
  // Change 39 Part F — a frozen card's layers can't be removed until an admin unlocks it.
  await assertJobEditable(layer.jobCard.id);
  if (layer.dispatches.length > 0) {
    const nos = layer.dispatches.map((d) => d.dispatchNo ?? `#${d.id}`).join(", ");
    throw new Error(`This layer has been dispatched against (${nos}) — void those dispatches first`);
  }

  const fabricId = layer.jobCard.product?.fabricId ?? null;
  const issued = layerFabricByColour(layer, layer.jobCard.estAvg);
  const layerTotal = layer.cells.reduce((a, c) => a + c.qty, 0);
  const now = new Date();

  // Change 37: a lay that carries per-colour rows is reversed by re-netting the card to
  // what remains, not by posting an inverse of a recomputed estimate. The recomputed
  // route was always slightly lossy (createJobCard rounds once at the end, the layer
  // paths round per colour), and with entered figures there is no need to guess at all.
  const perColour = layerColourUsed(layer) != null;

  await db.$transaction(async (tx) => {
    if (fabricId && !perColour) {
      for (const [colour, qty] of issued) {
        // put the lay's fabric back — the inverse of the OUT that issued it
        await postMaterialMovement(tx, {
          direction: "IN",
          qty,
          date: now,
          fabricId,
          colour,
          jobCardId: layer.jobCard.id,
          note: `Reverse layer ${layer.layerNo} (${layer.jobCard.siNo})`,
        });
        const line = await tx.jobFabricLine.findFirst({
          where: { jobCardId: layer.jobCard.id, fabricId, color: colour },
        });
        if (line) {
          const cut = layer.cells
            .filter((c) => colorKey(c.colour) === colour)
            .reduce((a, c) => a + c.qty, 0);
          await tx.jobFabricLine.update({
            where: { id: line.id },
            data: {
              cutQty: (line.cutQty ?? 0) - cut,
              qtyIssued: (line.qtyIssued ?? 0) - qty,
            } as any,
          });
        }
      }
    }
    await tx.cuttingLayerCell.deleteMany({ where: { layerId: layer.id } });
    await tx.cuttingLayer.delete({ where: { id: layer.id } }); // colours cascade

    if (fabricId && perColour) {
      // Every colour this lay touched has to be re-driven, including any that drop to
      // zero once it is gone — otherwise a removed layer leaves its metres deducted.
      const remaining = await tx.cuttingLayerColour.findMany({
        where: { layer: { jobCardId: layer.jobCard.id } },
        select: { colour: true, fabricUsed: true },
      });
      const target = new Map<string, number>();
      for (const c of layer.colours) target.set(colorKey(c.colour), 0);
      for (const r of remaining) {
        if (r.fabricUsed == null) continue;
        const k = colorKey(r.colour);
        target.set(k, (target.get(k) ?? 0) + r.fabricUsed);
      }
      for (const [colour, used] of target) {
        const cut = layer.cells.filter((c) => colorKey(c.colour) === colour).reduce((a, c) => a + c.qty, 0);
        await tx.jobFabricLine.updateMany({
          where: { jobCardId: layer.jobCard.id, fabricId, color: colour },
          data: { qtyUsed: used, cutQty: { decrement: cut } },
        });
        await reconcileJobFabricColour(tx, {
          fabricId, jobCardId: layer.jobCard.id, siNo: layer.jobCard.siNo,
          colour, used, reason: `Reverse layer ${layer.layerNo}`,
          buyerId: layer.jobCard.buyerId, // Change 40 L
        });
      }
    }
    if (layerTotal > 0) {
      await tx.jobCard.update({
        where: { id: layer.jobCard.id },
        data: { cutQty: { decrement: layerTotal }, updatedById: user.userId } as any,
      });
    }
    const reversedMtr = Math.round([...issued.values()].reduce((a, q) => a + q, 0) * 100) / 100;
    await logAudit(tx, user, {
      action: "removeCuttingLayer",
      entity: "CuttingLayer",
      entityId: layer.id,
      entityLabel: `${layer.jobCard.siNo} · layer ${layer.layerNo}`,
      summary: `Removed layer ${layer.layerNo} from ${layer.jobCard.siNo} — −${num(layerTotal)} pcs cut, ${num(reversedMtr, 2)} m fabric returned`,
      meta: {
        jobCardId: layer.jobCard.id,
        before_snapshot: {
          row: {
            layerNo: layer.layerNo,
            label: layer.label,
            cutDate: layer.cutDate,
            fabricMtr: layer.fabricMtr,
            fabricIssued: layer.fabricIssued,
            avgConsumption: layer.avgConsumption,
            cells: layer.cells.map((c) => ({ colour: c.colour, size: c.size, qty: c.qty })),
          },
        },
        reversed: [...issued.entries()].map(([colour, qty]) => ({ colour, qty })),
      },
    });
  });

  // Change 39 Part F — removing a lay may reverse the last issued fabric; re-sync the lock.
  await syncJobLock(layer.jobCard.id);
  revalidatePath(`/job-cards/${layer.jobCard.id}`);
  revalidatePath("/job-cards");
  revalidatePath("/board");
  revalidatePath("/inventory");
  revalidatePath("/vendors");
  return { ok: true, reversedMtr: [...issued.values()].reduce((a, q) => a + q, 0) };
}

/**
 * Change 22 Part E — the honest fabric stock adjustment. Replaces the blunt
 * setFabricColorStock overwrite: the counted figure is reached by POSTING the delta
 * through the shared ledger, with a reason, so the movement is recorded and is itself
 * reversible. Negatives allowed.
 */
export async function adjustFabricStock(input: {
  fabricId: number;
  colour: string;
  newQty?: number;
  delta?: number;
  reason: AdjustReason;
  note?: string | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  if (input.newQty == null && input.delta == null) throw new Error("Give a counted quantity or a delta");
  const colour = colorKey(input.colour);
  const fc = await db.fabricColor.findUnique({
    where: { fabricId_color: { fabricId: input.fabricId, color: colour } },
    select: { id: true, currentStock: true, fabric: { select: { name: true, unit: true } } },
  });
  if (!fc) throw new Error("That fabric colour is not in stock yet — add the colour first");

  const delta =
    input.delta != null ? input.delta : Math.round((input.newQty! - fc.currentStock) * 100) / 100;
  if (Math.abs(delta) < 0.005) return { ok: true, unchanged: true as const, current: fc.currentStock };

  await db.$transaction(async (tx) => {
    await postMaterialMovement(tx, {
      direction: delta > 0 ? "IN" : "OUT",
      qty: Math.abs(delta),
      date: new Date(),
      fabricId: input.fabricId,
      colour,
      note: input.note ?? null,
      reason: input.reason,
    });
    // OPENING is the first count: it also becomes the baseline the utilisation bar reads.
    if (input.reason === "OPENING" && input.newQty != null) {
      await tx.fabricColor.update({
        where: { id: fc.id },
        data: { openingStock: input.newQty, updatedById: user.userId },
      });
    } else {
      await tx.fabricColor.update({ where: { id: fc.id }, data: { updatedById: user.userId } });
    }
    const after = Math.round((fc.currentStock + delta) * 100) / 100;
    await logAudit(tx, user, {
      action: "adjustFabricStock",
      entity: "FabricColor",
      entityId: fc.id,
      entityLabel: `${fc.fabric.name} · ${colour}`,
      summary: `Adjusted ${fc.fabric.name} ${colour} stock ${num(fc.currentStock, 2)} → ${num(after, 2)} ${fc.fabric.unit} (${input.reason})`,
      changes: { currentStock: { old: fc.currentStock, new: after } },
      meta: { reason: input.reason, delta, note: input.note ?? null, fabricId: input.fabricId },
    });
  });

  revalidatePath(`/inventory/${input.fabricId}`);
  revalidatePath("/inventory");
  revalidatePath("/");
  return { ok: true, delta, current: Math.round((fc.currentStock + delta) * 100) / 100 };
}

/**
 * Change 22 Part E — the same honest adjustment for trims, which had no correction path
 * at all: the only doors into trim stock were a locked challan and the UI-less legacy
 * recordTrimReceipt.
 */
export async function adjustTrimStock(input: {
  trimItemId: number;
  newQty?: number;
  delta?: number;
  reason: AdjustReason;
  note?: string | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  if (input.newQty == null && input.delta == null) throw new Error("Give a counted quantity or a delta");
  const t = await db.trimItem.findUnique({
    where: { id: input.trimItemId },
    select: { id: true, currentStock: true, name: true, unit: true },
  });
  if (!t) throw new Error("Trim item not found");

  const delta =
    input.delta != null ? input.delta : Math.round((input.newQty! - t.currentStock) * 100) / 100;
  if (Math.abs(delta) < 0.005) return { ok: true, unchanged: true as const, current: t.currentStock };

  await db.$transaction(async (tx) => {
    await postMaterialMovement(tx, {
      direction: delta > 0 ? "IN" : "OUT",
      qty: Math.abs(delta),
      date: new Date(),
      trimItemId: input.trimItemId,
      note: input.note ?? null,
      reason: input.reason,
    });
    await tx.trimItem.update({ where: { id: t.id }, data: { updatedById: user.userId } });
    const after = Math.round((t.currentStock + delta) * 100) / 100;
    await logAudit(tx, user, {
      action: "adjustTrimStock",
      entity: "TrimItem",
      entityId: t.id,
      entityLabel: t.name,
      summary: `Adjusted ${t.name} stock ${num(t.currentStock, 2)} → ${num(after, 2)} ${t.unit ?? "pcs"} (${input.reason})`,
      changes: { currentStock: { old: t.currentStock, new: after } },
      meta: { reason: input.reason, delta, note: input.note ?? null },
    });
  });

  revalidatePath(`/trims/${input.trimItemId}`);
  revalidatePath("/trims");
  revalidatePath("/pending-trims");
  revalidatePath("/");
  return { ok: true, delta, current: Math.round((t.currentStock + delta) * 100) / 100 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Change 20 — finishing as job-work (JW- series)
//
// A hand-off document per finishing step: which vendor, which layers, how many
// pieces out, how many came back, at what rate, against which bill. It mirrors
// addDispatch (event → layers) and reuses the DC-/CH- series idiom verbatim.
//
// ★ A tracking ledger, not a stock ledger. Nothing below calls
// postMaterialMovement or touches dispatchedQty — that is deliberate and load
// bearing. Finished garments live in the ERP (Change 21); fabric and trims were
// deducted upstream (Change 19). Using it is entirely OPTIONAL: a card that never
// raises a JW- behaves exactly as it did before.
// ─────────────────────────────────────────────────────────────────────────────

export type FinishingProcessName = "PRINT" | "EMBROIDERY" | "WASH" | "SUBLIMATION" | "LASER" | "OTHER";

function revalidateFinishing(jobCardId?: number, vendorName?: string | null) {
  revalidatePath("/finishing");
  revalidatePath("/board");
  if (jobCardId) revalidatePath(`/job-cards/${jobCardId}`);
  if (vendorName) revalidatePath(`/vendors/${encodeURIComponent(vendorName)}`);
  revalidatePath("/vendors");
}

/**
 * Change 20 B.1 — give a card's layer(s) out for finishing. Allocates the JW- number
 * inside the transaction so the number and the row can never drift apart.
 */
export async function createFinishingJob(input: {
  jobCardId: number;
  vendorName: string;
  process: FinishingProcessName;
  layerIds?: number[];
  qtyOut?: number;
  lines?: { colour?: string | null; size: string; qtyOut: number }[];
  rate?: number | null;
  billNo?: string | null;
  issuedDate?: string;
  note?: string | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const canSeeCost = canSeeCostFor(user); // rate is cost data, same gate as MRP

  const job = await db.jobCard.findUnique({ where: { id: input.jobCardId }, select: { id: true, siNo: true } });
  if (!job) throw new Error("Job card not found");

  const lines = (input.lines ?? []).filter((l) => l.qtyOut > 0);
  const qtyOut = lines.length ? lines.reduce((a, l) => a + l.qtyOut, 0) : input.qtyOut ?? 0;
  if (qtyOut <= 0) throw new Error("Give a quantity to send for finishing");

  const created = await db.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUnique({ where: { name: input.vendorName.trim() } });
    if (!vendor) throw new Error(`No vendor named "${input.vendorName}" — add the vendor first`);

    // Change 40 I7 — finishing job-work no longer mints its own JW- series; it draws from the
    // shared OUTWARD counter so "one universal series for all" holds. The number carries the
    // process's own 3-letter code (SUB/PRI/EMB/LAS/WSH/OTH). Existing JW- rows stay as history;
    // nextChallanSeq scans both MaterialChallan.challanNo and FinishingJob.docNo under CH-OUT-,
    // so the two models never collide. (The FinishingJob model is kept — it holds vendor rate
    // and bill tracking a MaterialChallan does not — only its numbering changes.)
    const year = new Date().getFullYear();
    const code = WORKTYPE_CODE[input.process] ?? "OTH";
    const seq = String(await nextChallanSeq(tx, "CH-OUT-", true)).padStart(3, "0");
    const docNo = `CH-OUT-${code}-${year}-${seq}`;

    return tx.finishingJob.create({
      data: {
        docNo,
        process: input.process as any,
        status: "OPEN",
        vendorId: vendor.id,
        jobCardId: job.id,
        issuedDate: input.issuedDate ? new Date(input.issuedDate) : new Date(),
        qtyOut,
        qtyBack: 0,
        rate: canSeeCost ? input.rate ?? null : null,
        billNo: input.billNo ?? null,
        note: input.note ?? null,
        ...(input.layerIds?.length ? { layers: { connect: input.layerIds.map((id) => ({ id })) } } : {}),
        ...(lines.length
          ? { lines: { create: lines.map((l) => ({ colour: l.colour ? colorKey(l.colour) : null, size: l.size, qtyOut: l.qtyOut })) } }
          : {}),
      } as any,
      select: { id: true, docNo: true },
    });
  });

  revalidateFinishing(job.id, input.vendorName);
  return created;
}

/**
 * Change 20 B.2 — log pieces coming back. Partial receipts accumulate; over- and
 * short-returns are real house data and are never clamped (same rule as dispatch).
 */
export async function receiveFinishingJob(input: {
  id: number;
  qtyBack: number;
  lines?: { id: number; qtyBack: number }[];
  receivedDate?: string;
  billNo?: string | null;
  note?: string | null;
}) {
  await requireRole("ADMIN", "STAFF");
  const jw = await db.finishingJob.findUnique({
    where: { id: input.id },
    include: { vendor: { select: { name: true } } },
  });
  if (!jw) throw new Error("Finishing job not found");
  if (!input.qtyBack) throw new Error("Give a quantity received back");

  const total = Math.round((jw.qtyBack + input.qtyBack) * 100) / 100;
  const now = input.receivedDate ? new Date(input.receivedDate) : new Date();

  await db.$transaction(async (tx) => {
    for (const l of input.lines ?? []) {
      const line = await tx.finishingJobLine.findUnique({ where: { id: l.id }, select: { qtyBack: true, jobId: true } });
      if (!line || line.jobId !== jw.id) continue;
      await tx.finishingJobLine.update({ where: { id: l.id }, data: { qtyBack: line.qtyBack + l.qtyBack } });
    }
    await tx.finishingJob.update({
      where: { id: jw.id },
      data: {
        qtyBack: total,
        status: total >= jw.qtyOut ? "CLOSED" : "OPEN",
        receivedDate: jw.receivedDate ?? now,
        ...(input.billNo !== undefined ? { billNo: input.billNo } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      } as any,
    });
  });

  revalidateFinishing(jw.jobCardId, jw.vendor.name);
  return { ok: true, docNo: jw.docNo, qtyBack: total, closed: total >= jw.qtyOut };
}

/**
 * Change 20 B.3 — edit an OPEN job that has no receipts yet. Change 22 Part F is
 * explicit that finishing must ship WITH its undo rather than repeat the one-way-door
 * pattern the whole of Change 22 exists to fix; this and deleteFinishingJob are it.
 */
export async function updateFinishingJob(input: {
  id: number;
  process?: FinishingProcessName;
  vendorName?: string;
  qtyOut?: number;
  rate?: number | null;
  billNo?: string | null;
  issuedDate?: string;
  note?: string | null;
  layerIds?: number[];
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const canSeeCost = canSeeCostFor(user);
  const jw = await db.finishingJob.findUnique({
    where: { id: input.id },
    include: { vendor: { select: { name: true } } },
  });
  if (!jw) throw new Error("Finishing job not found");
  if (jw.qtyBack > 0) throw new Error("Pieces have already come back on this job — it stays as history");

  await db.$transaction(async (tx) => {
    let vendorId: number | undefined;
    if (input.vendorName) {
      const v = await tx.vendor.findUnique({ where: { name: input.vendorName.trim() } });
      if (!v) throw new Error(`No vendor named "${input.vendorName}"`);
      vendorId = v.id;
    }
    await tx.finishingJob.update({
      where: { id: jw.id },
      data: {
        ...(input.process ? { process: input.process as any } : {}),
        ...(vendorId ? { vendorId } : {}),
        ...(input.qtyOut != null ? { qtyOut: input.qtyOut } : {}),
        ...(canSeeCost && input.rate !== undefined ? { rate: input.rate } : {}),
        ...(input.billNo !== undefined ? { billNo: input.billNo } : {}),
        ...(input.issuedDate ? { issuedDate: new Date(input.issuedDate) } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.layerIds ? { layers: { set: input.layerIds.map((id) => ({ id })) } } : {}),
      } as any,
    });
  });

  revalidateFinishing(jw.jobCardId, input.vendorName ?? jw.vendor.name);
  return { ok: true };
}

/** Change 20 B.3 — delete an OPEN job with no receipts. Moves no stock (nothing to reverse). */
export async function deleteFinishingJob(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  const jw = await db.finishingJob.findUnique({
    where: { id: input.id },
    include: { vendor: { select: { name: true } } },
  });
  if (!jw) throw new Error("Finishing job not found");
  if (jw.qtyBack > 0) throw new Error("Pieces have already come back on this job — it stays as history");

  await db.finishingJob.delete({ where: { id: jw.id } });
  revalidateFinishing(jw.jobCardId, jw.vendor.name);
  return { ok: true, docNo: jw.docNo };
}

// ── Change 36 Part 0 — master lifecycle: delete, where-used, deactivate ──
//
// Transactional documents have had guarded deletes since Change 20 (deleteJobCard,
// deleteFabricOrder, deleteTrimOrder, deleteFinishingJob). The MASTERS never did, and
// a blind delete on one is worse than on a document: almost every FK pointing at a
// master is OPTIONAL, and Prisma defaults an optional relation to SetNull — so the
// delete SUCCEEDS and quietly blanks the supplier off historical POs and challans.
// Required FKs throw P2003 instead. So neither a try/catch nor a raw delete is safe:
// every blocker is counted explicitly by getMasterRefs (src/lib/master-refs.ts) and we
// refuse before touching the row, offering deactivate as the fallback.
//
// These are requireRole("ADMIN") alone, not ("ADMIN","STAFF"): a master affects every
// future entry, not one transaction. Same reasoning as user administration above.

/** Shared body for all eight master deletes — guard, delete, audit, revalidate. */
async function deleteMaster(
  kind: MasterKind,
  id: number,
  opts: {
    what: string;
    entity: string;
    action: string;
    del: (tx: Tx, id: number) => Promise<unknown>;
    paths: string[];
  }
) {
  const user = await requireRole("ADMIN");
  const refs = await getMasterRefs(kind, id);
  if (refs.total > 0) throw new Error(refsMessage(opts.what, refs));

  await db.$transaction(async (tx) => {
    await opts.del(tx, id);
    // The row is gone but the log keeps the name — AuditLog holds no FK to it.
    await logAudit(tx, user, {
      action: opts.action,
      entity: opts.entity,
      entityId: id,
      entityLabel: refs.name,
      summary: `Deleted ${opts.what.toLowerCase()} ${refs.name}`,
      meta: { before_snapshot: { name: refs.name } },
    });
  });
  for (const p of opts.paths) revalidatePath(p);
  return { ok: true, name: refs.name };
}

export async function deleteSupplier(input: { id: number }) {
  // Contact cascades — a supplier's own people go with it.
  return deleteMaster("supplier", input.id, {
    what: "Supplier", entity: "Supplier", action: "deleteSupplier",
    del: (tx, id) => tx.supplier.delete({ where: { id } }),
    paths: ["/suppliers", "/masters"],
  });
}

export async function deleteVendor(input: { id: number }) {
  return deleteMaster("vendor", input.id, {
    what: "Vendor", entity: "Vendor", action: "deleteVendor",
    del: (tx, id) => tx.vendor.delete({ where: { id } }),
    paths: ["/vendors", "/masters"],
  });
}

export async function deleteProduct(input: { id: number }) {
  // ProductColor and ImageAsset cascade — the product's own data.
  return deleteMaster("product", input.id, {
    what: "Product", entity: "Product", action: "deleteProduct",
    del: (tx, id) => tx.product.delete({ where: { id } }),
    paths: ["/catalog", "/masters"],
  });
}

export async function deleteFabric(input: { id: number }) {
  return deleteMaster("fabric", input.id, {
    what: "Fabric", entity: "Fabric", action: "deleteFabric",
    del: (tx, id) => tx.fabric.delete({ where: { id } }),
    paths: ["/inventory", "/masters"],
  });
}

export async function deleteTrim(input: { id: number }) {
  return deleteMaster("trim", input.id, {
    what: "Trim", entity: "TrimItem", action: "deleteTrim",
    del: (tx, id) => tx.trimItem.delete({ where: { id } }),
    paths: ["/trims", "/masters"],
  });
}

export async function deleteBuyer(input: { id: number }) {
  // Contact and BuyerDeliveryAddress cascade — the firm's own data.
  return deleteMaster("buyer", input.id, {
    what: "Firm", entity: "Buyer", action: "deleteBuyer",
    del: (tx, id) => tx.buyer.delete({ where: { id } }),
    paths: ["/buyers", "/masters"],
  });
}

export async function deleteColour(input: { id: number }) {
  return deleteMaster("colour", input.id, {
    what: "Colour", entity: "Colour", action: "deleteColour",
    del: (tx, id) => tx.colour.delete({ where: { id } }),
    paths: ["/masters"],
  });
}

export async function deleteCuttingMaster(input: { id: number }) {
  return deleteMaster("cuttingMaster", input.id, {
    what: "Cutting master", entity: "CuttingMaster", action: "deleteCuttingMaster",
    del: (tx, id) => tx.cuttingMaster.delete({ where: { id } }),
    paths: ["/vendors", "/masters"],
  });
}

/**
 * The panel's read side. A server action rather than a selector because the master
 * managers are client components: they call this on Delete, and only when it comes
 * back with total > 0 do they open the where-used panel. Attempting the delete and
 * parsing the thrown string would not work — a thrown Error cannot carry the groups.
 */
export async function checkMasterRefs(input: { kind: MasterKind; id: number }) {
  await requireRole("ADMIN");
  return getMasterRefs(input.kind, input.id);
}

/** Deactivate fallback for the masters whose retire flag is a boolean. */
export async function deactivateFabric(input: { id: number; active?: boolean }) {
  const user = await requireRole("ADMIN", "STAFF");
  const next = input.active ?? false;
  await db.$transaction(async (tx) => {
    const f = await tx.fabric.update({ where: { id: input.id }, data: { active: next }, select: { name: true } });
    await logAudit(tx, user, {
      action: "deactivateFabric", entity: "Fabric", entityId: input.id, entityLabel: f.name,
      summary: `${next ? "Reactivated" : "Deactivated"} fabric ${f.name}`,
      changes: { active: { old: !next, new: next } },
    });
  });
  revalidatePath("/inventory");
  revalidatePath("/masters");
  return { ok: true };
}

// ── Change 36 Part 1 — the operational money layer ──
//
// ★ Money is DERIVED from documents, never hand-typed. The bills are computed live in
// getPartyStatement (src/lib/party-ledger.ts) from dispatched pieces and locked inward
// challans; the only figures entered by a human are the ones below — what was actually
// paid. Nothing here is ever deleted or edited: a mistake is corrected by posting its
// inverse, so the trail survives.
//
// ADMIN only. These are not "reachable by direct POST no matter what the sidebar
// renders" hypotheticals — a payment is the most sensitive write in the app.

async function postLedgerEntry(
  input: {
    vendorId?: number | null;
    supplierId?: number | null;
    amount: number;
    note?: string | null;
    at?: string | null;
    jobCardId?: number | null;
    challanId?: number | null;
  },
  kind: "PAYMENT" | "ADVANCE" | "ADJUSTMENT",
  direction: "DEBIT" | "CREDIT",
  action: string
) {
  const user = await requireRole("ADMIN");
  const amount = Math.round((input.amount ?? 0) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount greater than zero");
  const vendorId = input.vendorId ?? null;
  const supplierId = input.supplierId ?? null;
  if ((vendorId == null) === (supplierId == null))
    throw new Error("A ledger entry belongs to exactly one vendor or one supplier");

  const party = vendorId
    ? await db.vendor.findUnique({ where: { id: vendorId }, select: { name: true, jobRate: true } })
    : await db.supplier.findUnique({ where: { id: supplierId! }, select: { name: true } });
  if (!party) throw new Error("Party not found");

  await db.$transaction(async (tx) => {
    await tx.partyLedgerEntry.create({
      data: {
        kind, direction, amount,
        note: input.note?.trim() || null,
        at: input.at ? new Date(input.at) : new Date(),
        vendorId, supplierId,
        jobCardId: input.jobCardId ?? null,
        challanId: input.challanId ?? null,
        // Snapshot the rate in force so a later rate change cannot restate this.
        rateAtPosting: (party as { jobRate?: number | null }).jobRate ?? null,
        createdById: user.userId,
      },
    });
    await logAudit(tx, user, {
      action,
      entity: "PartyLedgerEntry",
      entityId: vendorId ?? supplierId!,
      entityLabel: party.name,
      summary: `${kind === "ADJUSTMENT" ? "Adjustment" : kind === "ADVANCE" ? "Advance" : "Payment"} ${num(amount)} ${direction === "CREDIT" ? "to" : "from"} ${party.name}`,
      meta: { kind, direction, amount, note: input.note ?? null },
    });
  });

  if (vendorId) revalidatePath("/vendors");
  else revalidatePath("/suppliers");
  revalidatePath("/");
  return { ok: true };
}

export async function recordPayment(input: Parameters<typeof postLedgerEntry>[0]) {
  return postLedgerEntry(input, "PAYMENT", "CREDIT", "recordPayment");
}

export async function recordAdvance(input: Parameters<typeof postLedgerEntry>[0]) {
  return postLedgerEntry(input, "ADVANCE", "CREDIT", "recordAdvance");
}

export async function recordAdjustment(input: Parameters<typeof postLedgerEntry>[0] & { reason: string }) {
  if (!input.reason?.trim()) throw new Error("An adjustment needs a reason");
  return postLedgerEntry(
    { ...input, note: `${input.reason.trim()}${input.note ? ` — ${input.note}` : ""}` },
    "ADJUSTMENT",
    "CREDIT",
    "recordAdjustment"
  );
}

/**
 * Reverse an entry by posting its inverse. The original row is never touched — that is
 * the whole point of an append-only ledger, and it is why there is no deletePayment.
 */
export async function reversePartyLedgerEntry(input: { id: number; reason?: string | null }) {
  const user = await requireRole("ADMIN");
  const e = await db.partyLedgerEntry.findUnique({ where: { id: input.id } });
  if (!e) throw new Error("Ledger entry not found");

  await db.$transaction(async (tx) => {
    await tx.partyLedgerEntry.create({
      data: {
        kind: "ADJUSTMENT",
        direction: e.direction === "CREDIT" ? "DEBIT" : "CREDIT",
        amount: e.amount,
        note: `Reversal of #${e.id}${input.reason ? ` — ${input.reason}` : ""}`,
        vendorId: e.vendorId, supplierId: e.supplierId,
        jobCardId: e.jobCardId, challanId: e.challanId,
        createdById: user.userId,
      },
    });
    await logAudit(tx, user, {
      action: "reversePartyLedgerEntry",
      entity: "PartyLedgerEntry",
      entityId: e.id,
      summary: `Reversed ${e.kind} of ${num(e.amount)} by inverse posting`,
      meta: { reason: input.reason ?? null },
    });
  });
  revalidatePath("/vendors");
  revalidatePath("/suppliers");
  return { ok: true };
}

/** The vendor's default job-work rate. Null clears it — no rate means nothing is billed. */
export async function setVendorJobRate(input: { id: number; jobRate?: number | null; jobRateType?: string | null }) {
  const user = await requireRole("ADMIN");
  const before = await db.vendor.findUnique({ where: { id: input.id }, select: { name: true, jobRate: true, jobRateType: true } });
  if (!before) throw new Error("Vendor not found");
  const patch = {
    ...(input.jobRate !== undefined ? { jobRate: input.jobRate } : {}),
    ...(input.jobRateType !== undefined ? { jobRateType: (input.jobRateType || null) as never } : {}),
  };
  await db.$transaction(async (tx) => {
    await tx.vendor.update({ where: { id: input.id }, data: patch });
    await logAudit(tx, user, {
      action: "setVendorJobRate", entity: "Vendor", entityId: input.id, entityLabel: before.name,
      summary: `Set job rate for ${before.name}`,
      changes: computeChanges(before as unknown as Record<string, unknown>, patch as Record<string, unknown>),
    });
  });
  revalidatePath("/vendors");
  return { ok: true };
}

/** This lay's own rate, overriding the vendor default. See CuttingLayer.vendorRate. */
export async function setLayerVendorRate(input: { layerId: number; vendorRate?: number | null }) {
  const user = await requireRole("ADMIN");
  const layer = await db.cuttingLayer.findUnique({
    where: { id: input.layerId },
    select: { layerNo: true, vendorRate: true, jobCardId: true, jobCard: { select: { siNo: true } } },
  });
  if (!layer) throw new Error("Cutting layer not found");
  await db.$transaction(async (tx) => {
    await tx.cuttingLayer.update({ where: { id: input.layerId }, data: { vendorRate: input.vendorRate ?? null } });
    await logAudit(tx, user, {
      action: "setLayerVendorRate", entity: "CuttingLayer", entityId: input.layerId,
      entityLabel: `${layer.jobCard.siNo} · layer ${layer.layerNo}`,
      summary: `Set layer ${layer.layerNo} rate on ${layer.jobCard.siNo}`,
      changes: { vendorRate: { old: layer.vendorRate, new: input.vendorRate ?? null } },
    });
  });
  revalidatePath(`/job-cards/${layer.jobCardId}`);
  return { ok: true };
}

// ── Change 36 Part 2 — the in-app inbox ──

/** Mark this user's unread notifications read. Deliberately not a delete: the log stays. */
export async function markNotificationsRead(input?: { ids?: string[] }) {
  const user = await requireRole("ADMIN", "STAFF", "VENDOR", "TRIMS");
  await db.notification.updateMany({
    where: {
      userId: user.userId,
      status: { not: "READ" },
      ...(input?.ids?.length ? { id: { in: input.ids } } : {}),
    },
    data: { status: "READ" },
  });
  revalidatePath("/");
  return { ok: true };
}

/** Per-event, per-channel opt-out. An absent row means the template is on. */
export async function setNotificationPref(input: { template: string; channel: string; enabled: boolean }) {
  const user = await requireRole("ADMIN", "STAFF", "VENDOR", "TRIMS");
  await db.notificationPref.upsert({
    where: { userId_template_channel: { userId: user.userId, template: input.template, channel: input.channel } },
    create: { userId: user.userId, template: input.template, channel: input.channel, enabled: input.enabled },
    update: { enabled: input.enabled },
  });
  revalidatePath("/settings/notifications");
  return { ok: true };
}

/** Owner contact details — without these the digest has nowhere to go. */
export async function setMyContact(input: { phone?: string | null; email?: string | null }) {
  const user = await requireRole("ADMIN", "STAFF", "VENDOR", "TRIMS");
  await db.user.update({
    where: { id: user.userId },
    data: {
      ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
      ...(input.email !== undefined ? { email: input.email?.trim() || null } : {}),
    },
  });
  revalidatePath("/settings/notifications");
  return { ok: true };
}

// ── Change 36 Part 3 — quality inspection & rework ──
//
// ★ The gate NEVER hard-blocks the floor. It records and warns; dispatching
// un-inspected or failed pieces is allowed, shows a confirm, and is logged. A factory
// that cannot ship because the software disagrees stops using the software.
//
// Two hard rules:
//  - Rework NEVER calls postMaterialMovement and never touches dispatchedQty. Pieces
//    going back to a vendor for repair have not left the factory's ownership, and
//    finished-goods stock lives in the ERP.
//  - Inspections are VOIDED, never deleted: the count may already have been read.

export async function createInspection(input: {
  jobCardId: number;
  layerId?: number | null;
  sampleSize?: number | null;
  checkedQty: number;
  passQty: number;
  rejectQty: number;
  reworkQty?: number | null;
  note?: string | null;
  defects?: { defectTypeId: number; qty: number }[];
  // Change 36 Part 10: replay key for an inspection recorded offline.
  idemKey?: string | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const job = await db.jobCard.findUnique({ where: { id: input.jobCardId }, select: { id: true, siNo: true } });
  if (!job) throw new Error("Job card not found");

  const checked = Math.max(0, input.checkedQty ?? 0);
  const pass = Math.max(0, input.passQty ?? 0);
  const reject = Math.max(0, input.rejectQty ?? 0);
  const rework = Math.max(0, input.reworkQty ?? 0);
  if (checked <= 0) throw new Error("Enter how many pieces were checked");
  if (pass + reject + rework > checked + 0.001)
    throw new Error(`Pass + reject + rework (${num(pass + reject + rework)}) is more than the ${num(checked)} checked`);

  const result = reject === 0 && rework === 0 ? "PASS" : pass === 0 ? "FAIL" : "PARTIAL";

  const created = await db.$transaction(async (tx) =>
    withIdempotency(tx, user, input.idemKey, "createInspection", async () => {
    const row = await tx.inspection.create({
      data: {
        jobCardId: job.id,
        layerId: input.layerId ?? null,
        inspectedById: user.userId,
        sampleSize: input.sampleSize ?? null,
        checkedQty: checked, passQty: pass, rejectQty: reject, reworkQty: rework,
        result: result as never,
        note: input.note?.trim() || null,
        ...(input.defects?.length
          ? { defects: { create: input.defects.filter((d) => d.qty > 0).map((d) => ({ defectTypeId: d.defectTypeId, qty: d.qty })) } }
          : {}),
      },
    });
    await logAudit(tx, user, {
      action: "createInspection", entity: "Inspection", entityId: row.id,
      entityLabel: job.siNo,
      summary: `Inspected ${num(checked)} pcs on ${job.siNo} — ${result.toLowerCase()} (${num(reject)} reject, ${num(rework)} rework)`,
    });
    return row;
    })
  );

  revalidatePath(`/job-cards/${job.id}`);
  revalidatePath("/reports");
  return { ok: true, id: created.result.id, result };
}

export async function voidInspection(input: { id: number; reason?: string | null }) {
  const user = await requireRole("ADMIN", "STAFF");
  const insp = await db.inspection.findUnique({
    where: { id: input.id },
    select: { id: true, voidedAt: true, jobCardId: true, jobCard: { select: { siNo: true } } },
  });
  if (!insp) throw new Error("Inspection not found");
  if (insp.voidedAt) throw new Error("This inspection is already void");

  await db.$transaction(async (tx) => {
    await tx.inspection.update({ where: { id: insp.id }, data: { voidedAt: new Date() } });
    await logAudit(tx, user, {
      action: "voidInspection", entity: "Inspection", entityId: insp.id,
      entityLabel: insp.jobCard.siNo,
      summary: `Voided inspection on ${insp.jobCard.siNo}${input.reason ? ` — ${input.reason}` : ""}`,
    });
  });
  revalidatePath(`/job-cards/${insp.jobCardId}`);
  revalidatePath("/reports");
  return { ok: true };
}

/**
 * Send rejected pieces back for repair. A tracking movement only — see the header.
 * Gets its own RW- series: JW- is a vendor BILLING document and reusing it would put
 * unbilled rework into the finishing job-work ledger.
 */
export async function sendToRework(input: {
  jobCardId: number;
  layerId?: number | null;
  qty: number;
  vendorName?: string | null;
  note?: string | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const job = await db.jobCard.findUnique({ where: { id: input.jobCardId }, select: { id: true, siNo: true } });
  if (!job) throw new Error("Job card not found");
  const qty = Math.max(0, input.qty ?? 0);
  if (qty <= 0) throw new Error("Enter how many pieces are going for rework");

  const rw = await db.$transaction(async (tx) => {
    const vendorId = input.vendorName ? await resolveVendorId(tx, input.vendorName) : null;

    // Allocate inside the transaction, like JW-/DC-/CH-: two concurrent creates would
    // otherwise collide on the @unique docNo.
    const year = new Date().getFullYear();
    const prefix = `RW-${year}-`;
    const existing = await tx.rework.findMany({ where: { docNo: { startsWith: prefix } }, select: { docNo: true } });
    const maxN = existing.reduce((m, e) => Math.max(m, parseInt((e.docNo ?? "").slice(prefix.length), 10) || 0), 0);
    const docNo = `${prefix}${String(maxN + 1).padStart(3, "0")}`;

    const row = await tx.rework.create({
      data: {
        docNo, jobCardId: job.id, layerId: input.layerId ?? null,
        vendorId, qty, status: "OPEN", note: input.note?.trim() || null,
      },
    });
    await logAudit(tx, user, {
      action: "sendToRework", entity: "Rework", entityId: row.id, entityLabel: docNo,
      summary: `Sent ${num(qty)} pcs from ${job.siNo} for rework${input.vendorName ? ` to ${input.vendorName}` : ""}`,
    });
    return row;
  });

  revalidatePath(`/job-cards/${job.id}`);
  return { ok: true, docNo: rw.docNo };
}

export async function receiveRework(input: { id: number; qtyBack: number }) {
  const user = await requireRole("ADMIN", "STAFF");
  const rw = await db.rework.findUnique({
    where: { id: input.id },
    select: { id: true, docNo: true, qty: true, qtyBack: true, jobCardId: true, jobCard: { select: { siNo: true } } },
  });
  if (!rw) throw new Error("Rework not found");
  const add = Math.max(0, input.qtyBack ?? 0);
  if (add <= 0) throw new Error("Enter how many pieces came back");
  const total = rw.qtyBack + add;
  if (total > rw.qty + 0.001) throw new Error(`Only ${num(rw.qty - rw.qtyBack)} pcs are still out on ${rw.docNo}`);

  await db.$transaction(async (tx) => {
    await tx.rework.update({
      where: { id: rw.id },
      data: { qtyBack: total, status: total >= rw.qty - 0.001 ? "CLOSED" : "OPEN" },
    });
    await logAudit(tx, user, {
      action: "receiveRework", entity: "Rework", entityId: rw.id, entityLabel: rw.docNo ?? String(rw.id),
      summary: `${num(add)} pcs back from rework on ${rw.jobCard.siNo}${total >= rw.qty - 0.001 ? " · closed" : ""}`,
    });
  });
  revalidatePath(`/job-cards/${rw.jobCardId}`);
  return { ok: true };
}

/** Owner-managed defect list, mirroring the other simple masters. */
export async function upsertDefectType(input: { id?: number; name: string; category?: string; active?: boolean }) {
  const user = await requireRole("ADMIN", "STAFF");
  const name = input.name.trim();
  if (!name) throw new Error("A defect needs a name");
  await db.$transaction(async (tx) => {
    const row = input.id
      ? await tx.defectType.update({
          where: { id: input.id },
          data: {
            name,
            ...(input.category ? { category: input.category as never } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
          },
        })
      : await tx.defectType.create({ data: { name, category: (input.category ?? "OTHER") as never } });
    await logAudit(tx, user, {
      action: input.id ? "updateDefectType" : "createDefectType",
      entity: "DefectType", entityId: row.id, entityLabel: name,
      summary: `${input.id ? "Updated" : "Added"} defect ${name}`,
    });
  });
  revalidatePath("/masters");
  return { ok: true };
}

/**
 * Change 36 Part 6 Part C — draft a purchase order for a shortfall.
 *
 * Pre-fills, never places: the order lands in PLANNING with no PO number, so the owner
 * still confirms and generates it. "No automated ordering" is the rule.
 */
export async function draftReorderPO(input: {
  kind: "FABRIC" | "TRIM";
  /** FabricColor.id for fabric, TrimItem.id for trim — matching getLowStockAlerts. */
  id: number;
  qty: number;
  supplierId?: number | null;
  rate?: number | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const qty = Math.max(0, input.qty ?? 0);
  if (qty <= 0) throw new Error("Nothing to order — the shortfall is zero");

  if (input.kind === "TRIM") {
    const trim = await db.trimItem.findUnique({ where: { id: input.id }, select: { id: true, name: true, supplierId: true, ratePerUnit: true } });
    if (!trim) throw new Error("Trim not found");
    const order = await db.$transaction(async (tx) => {
      const row = await tx.trimOrder.create({
        data: {
          trimItemId: trim.id,
          supplierId: input.supplierId ?? trim.supplierId ?? null,
          qty,
          rate: input.rate ?? trim.ratePerUnit ?? null,
          status: "PLANNING",
          orderDate: new Date(),
        },
      });
      await logAudit(tx, user, {
        action: "draftReorderPO", entity: "TrimOrder", entityId: row.id, entityLabel: trim.name,
        summary: `Drafted a trim order for ${num(qty)} of ${trim.name} from a reorder alert`,
      });
      return row;
    });
    revalidatePath("/trim-orders");
    return { ok: true, kind: "TRIM" as const, id: order.id };
  }

  const colour = await db.fabricColor.findUnique({
    where: { id: input.id },
    select: { id: true, color: true, fabricId: true, fabric: { select: { name: true, unit: true, ratePerUnit: true } } },
  });
  if (!colour) throw new Error("Fabric colour not found");

  const order = await db.$transaction(async (tx) => {
    const row = await tx.fabricOrder.create({
      data: {
        fabricId: colour.fabricId,
        supplierId: input.supplierId ?? null,
        qty,
        rate: input.rate ?? colour.fabric.ratePerUnit ?? null,
        unit: colour.fabric.unit,
        status: "PLANNING",
        orderDate: new Date(),
        lines: { create: [{ colour: colorKey(colour.color), qty }] },
      },
    });
    await logAudit(tx, user, {
      action: "draftReorderPO", entity: "FabricOrder", entityId: row.id, entityLabel: colour.fabric.name,
      summary: `Drafted a fabric order for ${num(qty)} ${colour.fabric.unit} of ${colour.fabric.name} · ${colour.color} from a reorder alert`,
    });
    return row;
  });
  revalidatePath("/fabric-orders");
  return { ok: true, kind: "FABRIC" as const, id: order.id };
}

/**
 * Change 36 Part 4 — the one entered number in capacity planning.
 * Null clears it, which suppresses the projection rather than implying zero throughput.
 */
export async function setVendorCapacity(input: { id: number; dailyCapacityPcs?: number | null; capacityNote?: string | null }) {
  const user = await requireRole("ADMIN", "STAFF");
  const before = await db.vendor.findUnique({
    where: { id: input.id },
    select: { name: true, dailyCapacityPcs: true, capacityNote: true },
  });
  if (!before) throw new Error("Vendor not found");
  const patch = {
    ...(input.dailyCapacityPcs !== undefined ? { dailyCapacityPcs: input.dailyCapacityPcs } : {}),
    ...(input.capacityNote !== undefined ? { capacityNote: input.capacityNote?.trim() || null } : {}),
  };
  await db.$transaction(async (tx) => {
    await tx.vendor.update({ where: { id: input.id }, data: patch });
    await logAudit(tx, user, {
      action: "setVendorCapacity", entity: "Vendor", entityId: input.id, entityLabel: before.name,
      summary: `Set capacity for ${before.name}`,
      changes: computeChanges(before as unknown as Record<string, unknown>, patch as Record<string, unknown>),
    });
  });
  revalidatePath("/planning");
  revalidatePath("/vendors");
  return { ok: true };
}

/** Change 36 Part 5 — the per-card override of the fabric standard. */
export async function setJobStdFabric(input: { jobCardId: number; stdFabricPerPc?: number | null }) {
  const user = await requireRole("ADMIN", "STAFF");
  const job = await db.jobCard.findUnique({ where: { id: input.jobCardId }, select: { siNo: true, stdFabricPerPc: true } });
  if (!job) throw new Error("Job card not found");
  await db.$transaction(async (tx) => {
    await tx.jobCard.update({ where: { id: input.jobCardId }, data: { stdFabricPerPc: input.stdFabricPerPc ?? null } });
    await logAudit(tx, user, {
      action: "setJobStdFabric", entity: "JobCard", entityId: input.jobCardId, entityLabel: job.siNo,
      summary: `Set the fabric standard on ${job.siNo}`,
      changes: { stdFabricPerPc: { old: job.stdFabricPerPc, new: input.stdFabricPerPc ?? null } },
    });
  });
  revalidatePath(`/job-cards/${input.jobCardId}`);
  return { ok: true };
}

// ── Change 36 Part 7 — sampling & development ──
//
// ★ The sample is a first-class document that GRADUATES into a job card. Everything else
// in ssfact starts after a style is approved; the money-losing decisions happen before.
//
// ⚠️ "Start bulk" PRE-FILLS a job card, it does not create one. createJobCard is not
// inert: it snapshots the BOM into JobBomLine, sets trimsPending and drives fabric maths.
// A speculative card would be real inventory pressure and a real SI- number. See
// startBulkHref below.

export async function createSample(input: {
  name: string;
  productId?: number | null;
  vendorName?: string | null;
  notes?: string | null;
  targetMrp?: number | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const name = input.name?.trim();
  if (!name) throw new Error("A sample needs a name");

  const sample = await db.$transaction(async (tx) => {
    const vendorId = input.vendorName ? await resolveVendorId(tx, input.vendorName) : null;

    // Allocate inside the transaction, like JW-/DC-/CH-/RW-.
    const year = new Date().getFullYear();
    const prefix = `SMP-${year}-`;
    const existing = await tx.sample.findMany({ where: { code: { startsWith: prefix } }, select: { code: true } });
    const maxN = existing.reduce((m, e) => Math.max(m, parseInt(e.code.slice(prefix.length), 10) || 0), 0);
    const code = `${prefix}${String(maxN + 1).padStart(3, "0")}`;

    const row = await tx.sample.create({
      data: {
        code, name,
        productId: input.productId ?? null,
        vendorId,
        requestedById: user.userId,
        notes: input.notes?.trim() || null,
        targetMrp: input.targetMrp ?? null,
      },
    });
    await logAudit(tx, user, {
      action: "createSample", entity: "Sample", entityId: row.id, entityLabel: code,
      summary: `Opened sample ${code} — ${name}`,
    });
    return row;
  });

  revalidatePath("/samples");
  return { ok: true, id: sample.id, code: sample.code };
}

export async function updateSample(input: {
  id: number;
  name?: string;
  vendorName?: string | null;
  notes?: string | null;
  targetMrp?: number | null;
  round?: number | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const before = await db.sample.findUnique({ where: { id: input.id }, select: { code: true, name: true, notes: true, targetMrp: true, round: true } });
  if (!before) throw new Error("Sample not found");

  await db.$transaction(async (tx) => {
    const vendorId = input.vendorName !== undefined ? await resolveVendorId(tx, input.vendorName) : undefined;
    const patch = {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      ...(input.targetMrp !== undefined ? { targetMrp: input.targetMrp } : {}),
      ...(input.round !== undefined && input.round != null ? { round: input.round } : {}),
      ...(vendorId !== undefined ? { vendorId } : {}),
    };
    await tx.sample.update({ where: { id: input.id }, data: patch });
    await logAudit(tx, user, {
      action: "updateSample", entity: "Sample", entityId: input.id, entityLabel: before.code,
      summary: `Edited sample ${before.code}`,
      changes: computeChanges(before as unknown as Record<string, unknown>, patch as Record<string, unknown>),
    });
  });
  revalidatePath("/samples");
  revalidatePath(`/samples/${input.id}`);
  return { ok: true };
}

/**
 * Move a sample along. Approval and rejection are reversible — a decision reverted is a
 * normal thing on a development sample, and the remark records why either way.
 */
export async function setSampleStatus(input: { id: number; status: string; remark?: string | null }) {
  const user = await requireRole("ADMIN", "STAFF");
  const valid = ["REQUESTED", "IN_PROGRESS", "SUBMITTED", "APPROVED", "REJECTED"];
  if (!valid.includes(input.status)) throw new Error("Unknown sample status");
  const before = await db.sample.findUnique({ where: { id: input.id }, select: { code: true, status: true } });
  if (!before) throw new Error("Sample not found");
  if (input.status === "REJECTED" && !input.remark?.trim()) throw new Error("Say why it was rejected");

  const decided = input.status === "APPROVED" || input.status === "REJECTED";
  await db.$transaction(async (tx) => {
    await tx.sample.update({
      where: { id: input.id },
      data: {
        status: input.status as never,
        decidedAt: decided ? new Date() : null,
        ...(input.remark !== undefined ? { remark: input.remark?.trim() || null } : {}),
      },
    });
    await logAudit(tx, user, {
      action: "setSampleStatus", entity: "Sample", entityId: input.id, entityLabel: before.code,
      summary: `${before.code} → ${input.status.toLowerCase().replace("_", " ")}${input.remark ? ` — ${input.remark}` : ""}`,
      changes: { status: { old: before.status, new: input.status } },
    });
  });
  revalidatePath("/samples");
  revalidatePath(`/samples/${input.id}`);
  return { ok: true };
}

/** Start the next round: bump the counter and reopen the sample. */
export async function nextSampleRound(input: { id: number }) {
  const user = await requireRole("ADMIN", "STAFF");
  const s = await db.sample.findUnique({ where: { id: input.id }, select: { code: true, round: true } });
  if (!s) throw new Error("Sample not found");
  await db.$transaction(async (tx) => {
    await tx.sample.update({
      where: { id: input.id },
      data: { round: s.round + 1, status: "IN_PROGRESS", decidedAt: null, remark: null },
    });
    await logAudit(tx, user, {
      action: "nextSampleRound", entity: "Sample", entityId: input.id, entityLabel: s.code,
      summary: `${s.code} — started round ${s.round + 1}`,
    });
  });
  revalidatePath(`/samples/${input.id}`);
  return { ok: true, round: s.round + 1 };
}

export async function upsertSampleCostLine(input: {
  id?: number;
  sampleId: number;
  kind: string;
  description: string;
  qty: number;
  rate: number;
}) {
  await requireRole("ADMIN");
  const description = input.description?.trim();
  if (!description) throw new Error("A cost line needs a description");
  if (input.id) {
    await db.sampleCostLine.update({
      where: { id: input.id },
      data: { kind: input.kind as never, description, qty: input.qty, rate: input.rate },
    });
  } else {
    await db.sampleCostLine.create({
      data: { sampleId: input.sampleId, kind: input.kind as never, description, qty: input.qty, rate: input.rate },
    });
  }
  revalidatePath(`/samples/${input.sampleId}`);
  return { ok: true };
}

export async function deleteSampleCostLine(input: { id: number; sampleId: number }) {
  await requireRole("ADMIN");
  await db.sampleCostLine.delete({ where: { id: input.id } });
  revalidatePath(`/samples/${input.sampleId}`);
  return { ok: true };
}

export async function upsertSampleMeasurement(input: {
  id?: number;
  sampleId: number;
  pom: string;
  size: string;
  valueCm: number;
  tolerance?: number | null;
}) {
  await requireRole("ADMIN", "STAFF");
  const pom = input.pom?.trim();
  const size = sizeKey(input.size);
  if (!pom || !size) throw new Error("A measurement needs a point and a size");
  if (input.id) {
    await db.sampleMeasurement.update({
      where: { id: input.id },
      data: { pom, size, valueCm: input.valueCm, tolerance: input.tolerance ?? null },
    });
  } else {
    await db.sampleMeasurement.create({
      data: { sampleId: input.sampleId, pom, size, valueCm: input.valueCm, tolerance: input.tolerance ?? null },
    });
  }
  revalidatePath(`/samples/${input.sampleId}`);
  return { ok: true };
}

export async function deleteSampleMeasurement(input: { id: number; sampleId: number }) {
  await requireRole("ADMIN", "STAFF");
  await db.sampleMeasurement.delete({ where: { id: input.id } });
  revalidatePath(`/samples/${input.sampleId}`);
  return { ok: true };
}

export async function deleteSample(input: { id: number }) {
  const user = await requireRole("ADMIN");
  const s = await db.sample.findUnique({ where: { id: input.id }, select: { code: true, status: true } });
  if (!s) throw new Error("Sample not found");
  if (s.status === "APPROVED") throw new Error(`${s.code} is approved — reject or reopen it before deleting`);
  await db.$transaction(async (tx) => {
    await tx.sample.delete({ where: { id: input.id } }); // cost lines, measurements and images cascade
    await logAudit(tx, user, {
      action: "deleteSample", entity: "Sample", entityId: input.id, entityLabel: s.code,
      summary: `Deleted sample ${s.code}`,
    });
  });
  revalidatePath("/samples");
  return { ok: true };
}

// ── Change 36 Part 10 — the writes the floor can make offline ──
//
// Only these queue. Everything else (money, void/edit, PO generation) stays online-only:
// a queued write is replayed blind on reconnect, and that is only safe where replaying
// is provably a no-op.

/**
 * One call that creates an inward challan, adds its lines and locks it.
 *
 * The existing chain — createChallan → addChallanLine × N → lockChallan — CANNOT be
 * queued, because calls 2 and 3 need the id that call 1 returns and an offline client
 * does not have it. Collapsing it into a single intent is what makes the receipt
 * queueable at all.
 */
export async function recordInwardReceipt(input: {
  /** Client-generated key. Replaying with the same key returns the first result. */
  idemKey?: string | null;
  supplierId?: number | null;
  jobCardId?: number | null;
  fabricOrderId?: number | null;
  date?: string | null;
  note?: string | null;
  lines: {
    fabricId?: number | null;
    colour?: string | null;
    trimItemId?: number | null;
    qty: number;
    unit?: string | null;
    rate?: number | null;
    lotNo?: string | null;
    shadeRef?: string | null;
  }[];
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const lines = input.lines.filter((l) => l.qty > 0 && (l.fabricId || l.trimItemId));
  if (!lines.length) throw new Error("A receipt needs at least one line");

  const out = await db.$transaction(async (tx) => {
    return withIdempotency(tx, user, input.idemKey, "recordInwardReceipt", async () => {
      const now = input.date ? new Date(input.date) : new Date();

      // Same CH-IN- series idiom as lockChallan; allocated inside the transaction.
      const year = now.getFullYear();
      const prefix = `CH-IN-${year}-`;
      const existing = await tx.materialChallan.findMany({
        where: { challanNo: { startsWith: prefix } },
        select: { challanNo: true },
      });
      const maxN = existing.reduce((m, e) => Math.max(m, parseInt((e.challanNo ?? "").slice(prefix.length), 10) || 0), 0);
      const challanNo = `${prefix}${String(maxN + 1).padStart(3, "0")}`;

      const challan = await tx.materialChallan.create({
        data: {
          direction: "INWARD",
          status: "LOCKED",
          challanNo,
          date: now,
          lockedAt: new Date(),
          supplierId: input.supplierId ?? null,
          jobCardId: input.jobCardId ?? null,
          fabricOrderId: input.fabricOrderId ?? null,
          note: input.note?.trim() || null,
          lines: {
            create: lines.map((l) => ({
              fabricId: l.fabricId ?? null,
              colour: l.fabricId && l.colour ? colorKey(l.colour) : null,
              trimItemId: l.trimItemId ?? null,
              qty: l.qty,
              unit: l.unit ?? null,
              rate: l.rate ?? null,
              lotNo: l.lotNo?.trim() || null,
              shadeRef: l.shadeRef?.trim() || null,
            })),
          },
        },
      });

      for (const l of lines) {
        // ⚠️ jobCardId is deliberately NOT stamped here, for the reason spelled out in
        // lockChallan: Change 19 B reconciles a card's fabric ledger by netting movements
        // keyed on (fabricId, jobCardId, colour), and folding challan traffic into that
        // net would silently corrupt the true-up.
        await postMaterialMovement(tx, {
          direction: "IN",
          qty: l.qty,
          date: now,
          fabricId: l.fabricId ?? null,
          colour: l.fabricId ? l.colour ?? null : null,
          trimItemId: l.trimItemId ?? null,
          rate: l.rate ?? null,
          note: `Challan ${challanNo}`,
        });
      }

      await logAudit(tx, user, {
        action: "recordInwardReceipt",
        entity: "MaterialChallan",
        entityId: challan.id,
        entityLabel: challanNo,
        summary: `Received ${challanNo} — ${lines.length} line${lines.length === 1 ? "" : "s"}`,
      });

      return { ok: true, id: challan.id, challanNo };
    });
  });

  revalidatePath("/challans");
  revalidatePath("/inventory");
  revalidatePath("/trims");
  return out.result;
}
