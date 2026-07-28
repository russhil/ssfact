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
import { getMasterRefs, refsMessage, type MasterKind } from "@/lib/master-refs";
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
  }
): Promise<void> {
  if (!m.qty || m.qty <= 0) return;
  const type = m.direction === "IN" ? "RECEIPT" : "ISSUE";
  const date = m.date ?? new Date();
  const delta = m.direction === "IN" ? { increment: m.qty } : { decrement: m.qty };

  if (m.fabricId) {
    const colour = colorKey(m.colour);
    await tx.stockMovement.create({
      data: { type, qty: m.qty, date, fabricId: m.fabricId, jobCardId: m.jobCardId ?? null, color: colour, note: m.note ?? null, reason: m.reason ?? null } as any,
    });
    const fc = await tx.fabricColor.upsert({
      where: { fabricId_color: { fabricId: m.fabricId, color: colour } },
      create: { fabricId: m.fabricId, color: colour, openingStock: 0, currentStock: 0 },
      update: {},
    });
    await tx.fabricColor.update({ where: { id: fc.id }, data: { currentStock: delta } });
  } else if (m.trimItemId) {
    await tx.trimMovement.create({
      data: { type, qty: m.qty, date, trimItemId: m.trimItemId, vendor: m.vendor ?? null, invoice: m.invoice ?? null, rate: m.rate ?? null, note: m.note ?? null, reason: m.reason ?? null } as any,
    });
    await tx.trimItem.update({ where: { id: m.trimItemId }, data: { currentStock: delta } });
  }
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
  cells: { colour: string; size: string; qty: number }[];
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

// Total trim need = perPieceQty × cutQty, except a COLOUR line tied to one garment
// colour, which explodes only against that colour's cut quantity.
function explodeBom(
  dimension: BomDim,
  color: string | null | undefined,
  perPieceQty: number,
  cutQty: number,
  cutByColour: Map<string, { qty: number }>
): number {
  if (dimension === "COLOR" && color) {
    return perPieceQty * (cutByColour.get(colorKey(color))?.qty ?? 0);
  }
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

export async function createJobCard(input: NewJobInput) {
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
    const cm =
      (await db.cuttingMaster.findUnique({ where: { name: input.cuttingMaster } })) ??
      (await db.cuttingMaster.create({ data: { name: input.cuttingMaster } }));
    cuttingMasterId = cm.id;
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

  // Per-colour fabric metres contributed by the layer maths (Part C). A layer's
  // fabricMtr is a lay total; split it across the layer's colours by cut proportion.
  const mtrByColour = new Map<string, number>();
  const colourHasMtr = new Set<string>();
  for (const l of layers) {
    const layerTotal = l.cells.reduce((a, c) => a + c.qty, 0);
    if (l.fabricMtr == null || layerTotal <= 0) continue;
    const byCol = new Map<string, number>();
    for (const c of l.cells) byCol.set(c.colour, (byCol.get(c.colour) ?? 0) + c.qty);
    for (const [col, q] of byCol) {
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
        const qtyIssued = colourHasMtr.has(key)
          ? Math.round((mtrByColour.get(key) ?? 0) * 100) / 100
          : lineAvg != null
            ? Math.round(qty * lineAvg * 100) / 100
            : null;
        return {
          key,
          cutQty: qty,
          estAvg: lineAvg,
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

  const siNo = input.siNo?.trim() || (await nextSiNo());
  const now = new Date();

  const job = await db.$transaction(async (tx) => {
    const created = await tx.jobCard.create({
      data: {
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
        status: "ACTIVE",
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
        vendorId: vendor.id,
        cuttingMasterId,
        // Layers are the source of truth for new cards; legacy grids still write SizeBreakup.
        ...(hasLayers
          ? {}
          : { sizeBreakup: { create: flatMatrix.map((m) => ({ size: m.size, color: m.color, qty: m.qty })) } }),
      } as any,
    });

    // Cutting layers + their colour×size cells (each layer may carry its own date/master/vendor).
    for (const l of layers) {
      const layerMasterId = l.cuttingMaster
        ? await resolveCuttingMaster(tx, l.cuttingMaster)
        : cuttingMasterId;
      const layerVendorId = (await resolveVendorId(tx, l.vendorName)) ?? vendor.id;
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
          fabricMtr: l.fabricMtr ?? null,
          fabricBalance: l.fabricBalance ?? null,
          fabricIssued: l.fabricIssued ?? null,
          sizeRatio: l.sizeRatio ?? null,
          cells: { create: l.cells.map((c) => ({ colour: c.colour, size: c.size, qty: c.qty })) },
        } as any,
      });
    }

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
          reqPcs: line.reqPcs,
          reqMtr: line.reqMtr,
          rolls: line.rolls,
          imageUrl: line.imageUrl,
        } as any,
      });
      await postMaterialMovement(tx, {
        direction: "OUT",
        qty: line.qtyIssued ?? 0,
        date: now,
        fabricId: fabricId!,
        colour: line.key,
        jobCardId: created.id,
        note: "Cutting issue",
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

    // Change 16 Part F: card-level stitch assignments retired — vendor lives on the
    // cutting layer (Change 14 A) and the "received" record is the dispatch (Change 14 B).

    return created;
  });

  revalidatePath("/");
  revalidatePath("/job-cards");
  revalidatePath("/inventory");
  revalidatePath("/trims");
  revalidatePath("/challans");
  return { slug: String(job.id), siNo: job.siNo };
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

      // ── Change 19 Part B: reconcile the ledger to USED ──
      // The old code returned Math.max(0, issued − used), which CLAMPED: when a layer was
      // over-cut (used > issued) it returned nothing, so net stock stayed parked at the
      // issued ESTIMATE and the extra fabric really consumed was never deducted.
      // Owner's rule: "It should not look at issued. It should always look at the manually
      // filled one which is USED." So we post whatever delta makes the net equal USED —
      // in both directions, never clamped. Negative stock is allowed: it's real over-cut.
      const agg = await tx.stockMovement.groupBy({
        by: ["type"],
        where: {
          fabricId,
          jobCardId: job.id,
          // legacy colourless movements were stored as null; colorKey("") === ""
          ...(key === "" ? { OR: [{ color: "" }, { color: null }] } : { color: key }),
        },
        _sum: { qty: true },
      });
      const sumOf = (t: string) => agg.find((a) => a.type === t)?._sum.qty ?? 0;
      const postedSoFar = sumOf("ISSUE") - sumOf("RECEIPT");

      // Idempotency falls out of this: re-saving the same USED gives delta 0 and posts
      // nothing, which is why the old one-shot `returnedColours` lock is gone.
      const raw = (l.qtyUsed ?? 0) - postedSoFar;
      const delta = Math.abs(raw) < 0.005 ? 0 : Math.round(raw * 100) / 100;

      if (delta > 0) {
        // used more than we've taken out — deduct the difference (over-cut)
        await postMaterialMovement(tx, {
          direction: "OUT",
          qty: delta,
          date: new Date(),
          fabricId,
          colour: key,
          jobCardId: job.id,
          note: `Actuals true-up ${job.siNo} · ${key || "—"}`,
        });
        totalIssued += delta;
      } else if (delta < 0) {
        // used less — the leftover goes back, and still leaves a human-facing ReturnNote
        const ret = -delta;
        await postMaterialMovement(tx, {
          direction: "IN",
          qty: ret,
          date: new Date(),
          fabricId,
          colour: key,
          jobCardId: job.id,
          note: `Return ${job.siNo} · ${key || "—"}`,
        });
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
  };
}

export async function addDispatch(input: {
  jobCardId: number;
  qty?: number; // legacy single-total path; ignored when `lines` are given
  date?: string;
  challan?: string;
  note?: string;
  arrangedBy?: string | null;
  reason?: "ORDER" | "SALE" | "OTHER";
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
  cells: { colour: string; size: string; qty: number }[];
}) {
  await requireRole("ADMIN", "STAFF");
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

  await db.$transaction(async (tx) => {
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
        fabricMtr: input.fabricMtr ?? null,
        fabricBalance: input.fabricBalance ?? null,
        fabricIssued: input.fabricIssued ?? null,
        sizeRatio: input.sizeRatio ?? null,
        cells: { create: cells },
      } as any,
    });

    if (fabricId) {
      for (const [col, q] of byCol) {
        const issued =
          input.fabricMtr != null && layerTotal > 0
            ? Math.round(input.fabricMtr * (q / layerTotal) * 100) / 100
            : avg != null
              ? Math.round(q * avg * 100) / 100
              : 0;
        const existing = job.fabricLines.find((f) => colorKey(f.color) === col);
        if (existing) {
          await tx.jobFabricLine.update({
            where: { id: existing.id },
            data: {
              cutQty: (existing.cutQty ?? 0) + q,
              qtyIssued: (existing.qtyIssued ?? 0) + issued,
            } as any,
          });
        } else {
          await tx.jobFabricLine.create({
            data: { color: col, fabricId, jobCardId: job.id, cutQty: q, estAvg: avg, qtyIssued: issued } as any,
          });
        }
        await postMaterialMovement(tx, {
          direction: "OUT",
          qty: issued,
          date: now,
          fabricId,
          colour: col,
          jobCardId: job.id,
          note: `Layer ${layerNo} issue`,
        });
      }
    }

    await tx.jobCard.update({ where: { id: job.id }, data: { cutQty: { increment: layerTotal } } as any });
  });

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
    include: { jobCard: { include: { jobLines: true } } },
  });
  // Recompute trims-pending live: any line still needing more than the trim's current stock.
  const trimIds = [...new Set(line.jobCard.jobLines.map((l) => l.trimItemId).filter((x): x is number => x != null))];
  const trims = trimIds.length
    ? await db.trimItem.findMany({ where: { id: { in: trimIds } }, select: { id: true, currentStock: true } })
    : [];
  const stock = new Map(trims.map((t) => [t.id, t.currentStock]));
  const pending = line.jobCard.jobLines.some((l) => {
    const bal = (l.requiredQty ?? l.totalQty ?? 0) - (l.issuedQty ?? 0);
    return l.trimItemId != null && bal > 0 && (l.requiredQty ?? 0) > (stock.get(l.trimItemId) ?? 0);
  });
  await db.jobCard.update({ where: { id: line.jobCardId }, data: { trimsPending: pending } as any });
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
}) {
  await requireRole("ADMIN", "STAFF");
  const lines = (input.lines ?? [])
    .map((l) => ({ colour: colorKey(l.colour), qty: l.qty }))
    .filter((l) => l.colour && l.qty > 0);
  if (lines.length === 0) throw new Error("Add at least one colour with a quantity");
  const total = lines.reduce((a, l) => a + l.qty, 0);
  // Change 17 Part E/G: the unit comes from the master by default (override per order).
  const fabric = await db.fabric.findUnique({ where: { id: input.fabricId }, select: { unit: true } });
  const unit = (input.unit ?? fabric?.unit ?? "MTR") as any;
  await db.fabricOrder.create({
    data: {
      fabricId: input.fabricId, supplierId: input.supplierId ?? null,
      qty: total, rate: input.rate ?? null, gsm: input.gsm ?? null, unit,
      status: (input.status ?? "ORDER_PLACED") as any, orderDate: new Date(),
      expectedDate: input.expectedDate ? new Date(input.expectedDate) : null, remarks: input.remarks ?? null,
      lines: { create: lines },
    } as any,
  });
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
  revalidatePath("/fabric-orders");
  revalidatePath("/inventory");
  return { ok: true };
}

export async function updateFabricOrder(input: {
  id: number; supplierId?: number | null; expectedDate?: string | null; rate?: number | null;
  gsm?: number | null; unit?: "KG" | "MTR"; lines?: { colour: string; qty: number }[];
  // Change 25 Part J: createFabricOrder always accepted remarks; the edit path did not,
  // so a remark could be set on creation and then never corrected.
  remarks?: string | null;
}) {
  await requireRole("ADMIN", "STAFF");
  const o = await db.fabricOrder.findUnique({ where: { id: input.id }, select: { poNumber: true, receivedDate: true } });
  if (!o) throw new Error("Order not found");
  if (o.poNumber) throw new Error("Order is locked — PO already generated");
  // Rewriting the lines of an already-received order would move the goods out from
  // under a locked challan that has already posted them to stock.
  if (o.receivedDate) throw new Error("Order is already received — it can no longer be edited");
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
  });
  revalidatePath("/fabric-orders");
  return { ok: true };
}

export async function deleteFabricOrder(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  const o = await db.fabricOrder.findUnique({
    where: { id: input.id },
    select: { poNumber: true, receivedDate: true },
  });
  if (!o) throw new Error("Order not found");
  if (o.poNumber) throw new Error("Order is locked — PO already generated");
  if (o.receivedDate) throw new Error("Order is already received — it can no longer be deleted");
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

type TrimOrderLineInput = { colour?: string | null; size?: string | null; qty: number };

const cleanTrimLines = (lines?: TrimOrderLineInput[] | null) =>
  (lines ?? [])
    .map((l) => ({ colour: l.colour?.trim() || null, size: l.size?.trim() || null, qty: l.qty }))
    .filter((l) => l.qty > 0);

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
}) {
  await requireRole("ADMIN", "STAFF");
  const lines = cleanTrimLines(input.lines);
  // A split order's total is the sum of its lines; otherwise the flat qty stands.
  const total = lines.length > 0 ? lines.reduce((a, l) => a + l.qty, 0) : input.qty ?? 0;
  if (total <= 0) throw new Error("Enter a quantity (or at least one split line)");
  const trim = await db.trimItem.findUnique({ where: { id: input.trimItemId }, select: { unit: true } });
  if (!trim) throw new Error("Trim not found");
  const o = await db.trimOrder.create({
    data: {
      trimItemId: input.trimItemId,
      supplierId: input.supplierId ?? null,
      qty: total,
      unit: input.unit ?? trim.unit ?? null,
      rate: input.rate ?? null,
      status: (input.status ?? "ORDER_PLACED") as any,
      orderDate: new Date(),
      expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
      remarks: input.remarks ?? null,
      ...(lines.length > 0 ? { lines: { create: lines } } : {}),
    } as any,
  });
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
  await requireRole("ADMIN", "STAFF");
  const o = await db.trimOrder.findUnique({ where: { id: input.id }, select: { poNumber: true, receivedDate: true } });
  if (!o) throw new Error("Order not found");
  if (o.poNumber) throw new Error("Order is locked — PO already generated");
  if (o.receivedDate) throw new Error("Order is already received — it can no longer be edited");
  await db.$transaction(async (tx) => {
    if (input.lines) {
      const lines = cleanTrimLines(input.lines);
      await tx.trimOrderLine.deleteMany({ where: { trimOrderId: input.id } });
      if (lines.length > 0) {
        await tx.trimOrderLine.createMany({ data: lines.map((l) => ({ ...l, trimOrderId: input.id })) });
        await tx.trimOrder.update({
          where: { id: input.id },
          data: { qty: lines.reduce((a, l) => a + l.qty, 0) },
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
  });
  revalidatePath("/trim-orders");
  return { ok: true };
}

export async function deleteTrimOrder(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  const o = await db.trimOrder.findUnique({
    where: { id: input.id },
    select: { poNumber: true, receivedDate: true },
  });
  if (!o) throw new Error("Order not found");
  if (o.poNumber) throw new Error("Order is locked — PO already generated");
  if (o.receivedDate) throw new Error("Order is already received — it can no longer be deleted");
  // Mirrors deleteFabricOrder: MaterialChallan.trimOrderId is onDelete: SetNull.
  const challans = await db.materialChallan.count({
    where: { trimOrderId: input.id, voidedAt: null },
  });
  if (challans > 0) throw new Error("Challans are logged against this order — void them first");
  await db.trimOrder.delete({ where: { id: input.id } });
  revalidatePath("/trim-orders");
  return { ok: true };
}

/**
 * Assign POT-YYYY-NNN (yearly sequence), lock the order. Idempotent.
 * Trims get their own series so trim and fabric PO numbers never collide.
 */
export async function generateTrimPO(input: { id: number } & PoIssueInput) {
  const user = await requireRole("ADMIN", "STAFF");
  const o = await db.trimOrder.findUnique({ where: { id: input.id }, select: { poNumber: true } });
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
        ...(input.buyerId !== undefined ? { buyerId: input.buyerId } : {}),
        ...(input.deliveryAddressId !== undefined ? { deliveryAddressId: input.deliveryAddressId } : {}),
        ...(input.gstRate !== undefined ? { gstRate: input.gstRate } : {}),
        updatedById: user.userId,
      },
    });
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

export async function createChallan(input: {
  direction: "INWARD" | "OUTWARD";
  supplierId?: number | null;
  vendorId?: number | null;
  jobCardId?: number | null; // Change 17 Part C: the "master head" this challan is raised against
  date?: string;
  note?: string | null;
}) {
  await requireRole("ADMIN", "STAFF");
  if (input.direction === "INWARD" && !input.supplierId) throw new Error("Inward challan needs a supplier");
  if (input.direction === "OUTWARD" && !input.vendorId) throw new Error("Outward challan needs a vendor");
  // Job-card requirement by kind is a UI warning only (spec Part C) — never blocked here.
  const c = await db.materialChallan.create({
    data: {
      direction: input.direction as any,
      supplierId: input.direction === "INWARD" ? input.supplierId ?? null : null,
      vendorId: input.direction === "OUTWARD" ? input.vendorId ?? null : null,
      jobCardId: input.jobCardId ?? null,
      date: input.date ? new Date(input.date) : new Date(),
      note: input.note ?? null,
    } as any,
  });
  revalidatePath("/challans");
  return { id: c.id };
}

async function assertDraft(challanId: number) {
  const c = await db.materialChallan.findUnique({ where: { id: challanId }, select: { status: true } });
  if (!c) throw new Error("Challan not found");
  if (c.status !== "DRAFT") throw new Error("Challan is locked — no further line edits");
}

export async function addChallanLine(
  challanId: number,
  input: { fabricId?: number | null; colour?: string | null; trimItemId?: number | null; qty: number; unit?: string | null; rate?: number | null; note?: string | null }
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
  // Change 25 Part D: a purchase return is outward, but it gets its own CH-RET-
  // series so a debit note is never mistaken for an ordinary issue to a vendor.
  const prefix = c.returnOfChallanId
    ? `CH-RET-${year}-`
    : c.direction === "INWARD"
      ? `CH-IN-${year}-`
      : `CH-OUT-${year}-`;
  const existing = await db.materialChallan.findMany({ where: { challanNo: { startsWith: prefix } }, select: { challanNo: true } });
  const maxN = existing.reduce((m, e) => Math.max(m, parseInt(e.challanNo!.slice(prefix.length), 10) || 0), 0);
  const challanNo = `${prefix}${String(maxN + 1).padStart(3, "0")}`;
  const dir = c.direction === "INWARD" ? "IN" : "OUT";
  const now = new Date();

  await db.$transaction(async (tx) => {
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
    // Change 18 Part C: locking the challan is what marks its purchase order received.
    // receivedDate is preserved once set, so a multi-delivery PO keeps its first date.
    if (c.fabricOrderId) {
      const o = await tx.fabricOrder.findUnique({ where: { id: c.fabricOrderId }, select: { receivedDate: true } });
      if (o) {
        await tx.fabricOrder.update({
          where: { id: c.fabricOrderId },
          data: { status: "RECEIVED", receivedDate: o.receivedDate ?? now },
        });
      }
    }
    if (c.trimOrderId) {
      const o = await tx.trimOrder.findUnique({ where: { id: c.trimOrderId }, select: { receivedDate: true } });
      if (o) {
        await tx.trimOrder.update({
          where: { id: c.trimOrderId },
          data: { status: "RECEIVED", receivedDate: o.receivedDate ?? now },
        });
      }
    }
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
  const lines = rows
    .filter((r) => r.qty > 0)
    .map((r) => ({ fabricId: o.fabricId, colour: r.colour, qty: r.qty, unit: String(o.unit), rate: o.rate }));
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
  // A split order receives line by line; a plain-qty order is one line.
  const rows = o.lines.length > 0 ? o.lines.map((l) => l.qty) : [o.qty];
  const lines = rows
    .filter((q) => q > 0)
    .map((q) => ({ trimItemId: o.trimItemId, qty: q, unit, rate: o.rate }));
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
  lines: { fabricId?: number | null; colour?: string | null; trimItemId?: number | null; qty: number; unit?: string | null; rate?: number | null; note?: string | null }[];
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
 * delta; they do NOT re-post fabric. Fabric is trued up in exactly one place
 * (recordFabricActuals) and posting here too would double-count the lay.
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
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const layer = await db.cuttingLayer.findUnique({
    where: { id: input.id },
    include: { cells: true, jobCard: { select: { siNo: true } } },
  });
  if (!layer) throw new Error("Cutting layer not found");

  const oldTotal = layer.cells.reduce((a, c) => a + c.qty, 0);
  const cells = input.cells
    ?.filter((c) => c.qty > 0 && sizeKey(c.size) !== "") // Change 26 E
    .map((c) => ({ colour: colorKey(c.colour), size: sizeKey(c.size), qty: c.qty }));
  if (cells && cells.length === 0) throw new Error("A layer needs at least one cell — remove the layer instead");
  const newTotal = cells ? cells.reduce((a, c) => a + c.qty, 0) : oldTotal;

  const patch = {
        ...(input.cutDate !== undefined ? { cutDate: input.cutDate ? new Date(input.cutDate) : null } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.rolls !== undefined ? { rolls: input.rolls } : {}),
        ...(input.fabricMtr !== undefined ? { fabricMtr: input.fabricMtr } : {}),
        ...(input.fabricIssued !== undefined ? { fabricIssued: input.fabricIssued } : {}),
        ...(input.fabricBalance !== undefined ? { fabricBalance: input.fabricBalance } : {}),
        ...(input.avgConsumption !== undefined ? { avgConsumption: input.avgConsumption } : {}),
        ...(input.sizeRatio !== undefined ? { sizeRatio: input.sizeRatio } : {}),
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
      dispatches: { where: { voidedAt: null }, select: { id: true, dispatchNo: true } },
      jobCard: { select: { id: true, siNo: true, estAvg: true, product: { select: { fabricId: true } } } },
    },
  });
  if (!layer) throw new Error("Cutting layer not found");
  if (layer.dispatches.length > 0) {
    const nos = layer.dispatches.map((d) => d.dispatchNo ?? `#${d.id}`).join(", ");
    throw new Error(`This layer has been dispatched against (${nos}) — void those dispatches first`);
  }

  const fabricId = layer.jobCard.product?.fabricId ?? null;
  const issued = layerFabricByColour(layer, layer.jobCard.estAvg);
  const layerTotal = layer.cells.reduce((a, c) => a + c.qty, 0);
  const now = new Date();

  await db.$transaction(async (tx) => {
    if (fabricId) {
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
    await tx.cuttingLayer.delete({ where: { id: layer.id } });
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

    // Same series idiom as addDispatch (DC-) and lockChallan (CH-). Do not invent a new one.
    const year = new Date().getFullYear();
    const prefix = `JW-${year}-`;
    const existing = await tx.finishingJob.findMany({
      where: { docNo: { startsWith: prefix } },
      select: { docNo: true },
    });
    const maxN = existing.reduce(
      (m, e) => Math.max(m, parseInt((e.docNo ?? "").slice(prefix.length), 10) || 0),
      0
    );
    const docNo = `${prefix}${String(maxN + 1).padStart(3, "0")}`;

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
