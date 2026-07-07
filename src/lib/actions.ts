"use server";

import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { requireRole } from "@/lib/auth";
import { colorKey } from "@/lib/colour";
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
  }
): Promise<void> {
  if (!m.qty || m.qty <= 0) return;
  const type = m.direction === "IN" ? "RECEIPT" : "ISSUE";
  const date = m.date ?? new Date();
  const delta = m.direction === "IN" ? { increment: m.qty } : { decrement: m.qty };

  if (m.fabricId) {
    const colour = colorKey(m.colour);
    await tx.stockMovement.create({
      data: { type, qty: m.qty, date, fabricId: m.fabricId, jobCardId: m.jobCardId ?? null, color: colour, note: m.note ?? null } as any,
    });
    const fc = await tx.fabricColor.upsert({
      where: { fabricId_color: { fabricId: m.fabricId, color: colour } },
      create: { fabricId: m.fabricId, color: colour, openingStock: 0, currentStock: 0 },
      update: {},
    });
    await tx.fabricColor.update({ where: { id: fc.id }, data: { currentStock: delta } });
  } else if (m.trimItemId) {
    await tx.trimMovement.create({
      data: { type, qty: m.qty, date, trimItemId: m.trimItemId, vendor: m.vendor ?? null, invoice: m.invoice ?? null, rate: m.rate ?? null } as any,
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

// One cutting layer (lay) at create time (Change 10, Part B/C/D).
export type NewJobLayerInput = {
  label?: string | null;
  cutDate?: string | null;
  cuttingMaster?: string | null;
  avgConsumption?: number | null;
  rolls?: number | null;
  fabricMtr?: number | null;
  fabricBalance?: number | null;
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
  // multi-vendor stitching (Change 10, Part G)
  stitch?: { vendorName: string; colour?: string | null; lotQty?: number | null; note?: string | null }[];
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
    (await db.vendor.findUnique({ where: { name: "Unassigned" } }))!;

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
        .filter((c) => c.qty > 0)
        .map((c) => ({ colour: colorKey(c.colour), size: c.size, qty: c.qty })),
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
  const bomPlan = rawBom.map((l) => ({
    trimItemId: l.trimItemId ?? null,
    material: l.material,
    color: l.color ?? null,
    dimension: l.dimension,
    perPieceQty: l.perPieceQty ?? 0,
    requiredQty: explodeBom(l.dimension, l.color, l.perPieceQty ?? 0, cutQty, cutByColour),
  }));
  // Flag shortage (trimsPending) against current stock BEFORE depletion.
  const trimIds = [...new Set(bomPlan.map((l) => l.trimItemId).filter((x): x is number => x != null))];
  const trims = trimIds.length
    ? await db.trimItem.findMany({ where: { id: { in: trimIds } }, select: { id: true, currentStock: true } })
    : [];
  const trimStock = new Map(trims.map((t) => [t.id, t.currentStock]));
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

    // Cutting layers + their colour×size cells (each layer may carry its own date/master).
    for (const l of layers) {
      const layerMasterId = l.cuttingMaster
        ? await resolveCuttingMaster(tx, l.cuttingMaster)
        : cuttingMasterId;
      await tx.cuttingLayer.create({
        data: {
          jobCardId: created.id,
          layerNo: l.layerNo,
          label: l.label ?? null,
          cutDate: l.cutDate ? new Date(l.cutDate) : now,
          cuttingMasterId: layerMasterId,
          avgConsumption: l.avgConsumption ?? null,
          rolls: l.rolls ?? null,
          fabricMtr: l.fabricMtr ?? null,
          fabricBalance: l.fabricBalance ?? null,
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

    // Frozen BOM snapshot (from the EDITED trim sheet) + live trim depletion via the ledger.
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
      await postMaterialMovement(tx, {
        direction: "OUT",
        qty: line.requiredQty,
        date: now,
        trimItemId: line.trimItemId ?? undefined,
      });
    }

    // Multi-vendor stitching assignments (Part G) — optional at create.
    for (const s of input.stitch ?? []) {
      if (!s.vendorName?.trim()) continue;
      const sv = await tx.vendor.findUnique({ where: { name: s.vendorName.trim() } });
      if (!sv) continue;
      await tx.stitchAssignment.create({
        data: {
          jobCardId: created.id,
          vendorId: sv.id,
          colour: s.colour ? colorKey(s.colour) : null,
          lotQty: s.lotQty ?? null,
          note: s.note ?? null,
        },
      });
    }

    return created;
  });

  revalidatePath("/");
  revalidatePath("/job-cards");
  revalidatePath("/inventory");
  revalidatePath("/trims");
  return { slug: String(job.id), siNo: job.siNo };
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
    include: { product: true, returnNotes: true, fabricLines: true },
  });
  if (!job) throw new Error("Job card not found");
  const fabricId = job.product?.fabricId ?? null;

  // Returns are locked per colour once recorded — re-saving never double-counts.
  const returnedColours = new Set(job.returnNotes.map((r) => colorKey(r.color)));
  let totalReturned = 0;

  for (const l of input.lines) {
    const key = colorKey(l.color);
    const existing = job.fabricLines.find((f) => colorKey(f.color) === key);
    if (existing) {
      await db.jobFabricLine.update({
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
      await db.jobFabricLine.create({
        data: {
          color: key, fabricId, cutQty: 0,
          estAvg: l.actualAvg ?? null, actualAvg: l.actualAvg ?? null,
          gsm: l.gsm ?? null, rollWidth: l.rollWidth ?? null,
          qtyIssued: l.qtyIssued, qtyUsed: l.qtyUsed, jobCardId: job.id,
          arrangedBy: input.arrangedBy ?? null, challan: input.challan ?? null,
        } as any,
      });
    }

    const returnQty = Math.max(0, l.qtyIssued - l.qtyUsed);
    if (returnQty > 0 && fabricId && !returnedColours.has(key)) {
      await db.returnNote.create({
        data: { qty: returnQty, fabricId, jobCardId: job.id, color: key, note: input.note ?? null } as any,
      });
      await db.stockMovement.create({
        data: {
          type: "RECEIPT", qty: returnQty, date: new Date(),
          fabricId, jobCardId: job.id, color: key, note: `Return ${job.siNo} · ${key}`,
        } as any,
      });
      const fc = await db.fabricColor.upsert({
        where: { fabricId_color: { fabricId, color: key } },
        create: { fabricId, color: key, openingStock: returnQty, currentStock: returnQty },
        update: { currentStock: { increment: returnQty } },
      });
      void fc;
      returnedColours.add(key);
      totalReturned += returnQty;
    }
  }

  // Roll up to the job-level legacy fields for back-compat displays.
  const sum = (k: "qtyIssued" | "qtyUsed") => input.lines.reduce((a, l) => a + (l[k] ?? 0), 0);
  const avgs = input.lines.map((l) => l.actualAvg).filter((v): v is number => v != null);
  await db.jobCard.update({
    where: { id: job.id },
    data: {
      actualAvg: avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null,
      fabricDispatched: sum("qtyIssued"),
      fabricUsed: sum("qtyUsed"),
    },
  });

  revalidatePath(`/job-cards/${String(job.id)}`);
  revalidatePath("/inventory");
  return { returnQty: totalReturned };
}

export async function setJobStage(input: {
  jobCardId: number;
  stage: "FABRIC_AWAITED" | "CUTTING" | "ON_MACHINE" | "FINISHING" | "DISPATCH";
}) {
  await requireRole("ADMIN", "STAFF");
  const job = await db.jobCard.update({
    where: { id: input.jobCardId },
    data: { stage: input.stage },
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

export async function addDispatch(input: {
  jobCardId: number;
  qty: number;
  date?: string;
  challan?: string;
  note?: string;
  arrangedBy?: string | null;
  reason?: "ORDER" | "SALE" | "OTHER";
}) {
  await requireRole("ADMIN", "STAFF");
  const job = await db.jobCard.findUnique({ where: { id: input.jobCardId } });
  if (!job) throw new Error("Job card not found");

  // Running balance may go negative/over (Part H) — do NOT clamp to cutQty.
  const newDispatched = job.dispatchedQty + input.qty;
  const closed = newDispatched >= job.cutQty;

  await db.jobCard.update({
    where: { id: job.id },
    data: {
      dispatchedQty: newDispatched,
      status: closed ? "CLOSED" : job.status,
      dispatches: {
        create: [
          {
            date: input.date ? new Date(input.date) : new Date(),
            qty: input.qty,
            challan: input.challan ?? null,
            note: input.note ?? null,
            arrangedBy: input.arrangedBy ?? null,
            reason: input.reason ?? "ORDER",
          } as any,
        ],
      },
    },
  });

  revalidatePath("/");
  revalidatePath("/dispatch");
  revalidatePath("/job-cards");
  revalidatePath(`/job-cards/${job.id}`);
  return { siNo: job.siNo, dispatched: newDispatched, closed };
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
  avgConsumption?: number | null;
  rolls?: number | null;
  fabricMtr?: number | null;
  fabricBalance?: number | null;
  cells: { colour: string; size: string; qty: number }[];
}) {
  await requireRole("ADMIN", "STAFF");
  const cells = input.cells
    .filter((c) => c.qty > 0)
    .map((c) => ({ colour: colorKey(c.colour), size: c.size, qty: c.qty }));
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
    await tx.cuttingLayer.create({
      data: {
        jobCardId: job.id,
        layerNo,
        label: input.label ?? null,
        cutDate: input.cutDate ? new Date(input.cutDate) : now,
        cuttingMasterId: layerMasterId,
        avgConsumption: input.avgConsumption ?? null,
        rolls: input.rolls ?? null,
        fabricMtr: input.fabricMtr ?? null,
        fabricBalance: input.fabricBalance ?? null,
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

export async function addStitchAssignment(input: {
  jobCardId: number;
  vendorId: number;
  colour?: string | null;
  lotQty?: number | null;
  note?: string | null;
}) {
  await requireRole("ADMIN", "STAFF");
  await db.stitchAssignment.create({
    data: {
      jobCardId: input.jobCardId,
      vendorId: input.vendorId,
      colour: input.colour ? colorKey(input.colour) : null,
      lotQty: input.lotQty ?? null,
      note: input.note ?? null,
    },
  });
  revalidatePath(`/job-cards/${input.jobCardId}`);
  return { ok: true };
}

export async function addStitchReceipt(input: {
  assignmentId: number;
  qty: number;
  date?: string;
  note?: string | null;
}) {
  await requireRole("ADMIN", "STAFF");
  if (input.qty <= 0) throw new Error("Qty must be positive");
  const a = await db.stitchAssignment.findUnique({ where: { id: input.assignmentId }, select: { jobCardId: true } });
  if (!a) throw new Error("Assignment not found");
  await db.stitchReceipt.create({
    data: {
      assignmentId: input.assignmentId,
      qty: input.qty,
      date: input.date ? new Date(input.date) : new Date(),
      note: input.note ?? null,
    },
  });
  revalidatePath(`/job-cards/${a.jobCardId}`);
  return { ok: true };
}

export async function removeStitchAssignment(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  const a = await db.stitchAssignment.findUnique({ where: { id: input.id }, select: { jobCardId: true } });
  await db.stitchAssignment.delete({ where: { id: input.id } });
  if (a) revalidatePath(`/job-cards/${a.jobCardId}`);
  return { ok: true };
}

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

export async function addFabricSupplier(input: { fabricId: number; name: string; rate?: number | null }) {
  await requireRole("ADMIN", "STAFF");
  if (!input.name.trim()) throw new Error("Supplier name is required");
  await db.fabricSupplier.create({
    data: { fabricId: input.fabricId, name: input.name.trim(), rate: input.rate ?? null },
  });
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

export async function createSupplier(input: { name: string; type?: string | null; city?: string | null; phone?: string | null; address?: string | null; email?: string | null; remarks?: string | null }) {
  await requireRole("ADMIN", "STAFF");
  if (!input.name.trim()) throw new Error("Name required");
  const s = await db.supplier.create({
    data: { name: input.name.trim(), type: (input.type ?? null) as any, city: input.city ?? null, phone: input.phone ?? null, address: input.address ?? null, email: input.email ?? null, remarks: input.remarks ?? null } as any,
  });
  revalidatePath("/suppliers");
  return { id: s.id };
}

export async function updateSupplier(input: { id: number; name?: string; type?: string | null; city?: string | null; phone?: string | null; address?: string | null; email?: string | null; remarks?: string | null; active?: boolean }) {
  await requireRole("ADMIN", "STAFF");
  await db.supplier.update({
    where: { id: input.id },
    data: {
      ...(input.name != null ? { name: input.name.trim() } : {}),
      ...(input.type !== undefined ? { type: (input.type ?? null) as any } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    } as any,
  });
  revalidatePath("/suppliers");
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

export async function createFabricQuick(input: { name: string; unit?: "KG" | "MTR" }) {
  await requireRole("ADMIN", "STAFF");
  const name = input.name.trim();
  if (!name) throw new Error("Fabric name required");
  const f = await db.fabric.upsert({
    where: { name },
    create: { name, unit: (input.unit ?? "MTR") as any },
    update: {},
  });
  revalidatePath("/fabric-orders");
  revalidatePath("/inventory");
  return { id: f.id, name: f.name };
}

// ── Change 08: multi-colour fabric orders + PO ──
export async function createFabricOrder(input: {
  fabricId: number; supplierId?: number | null; expectedDate?: string | null; rate?: number | null;
  gsm?: number | null; status?: string; remarks?: string | null; lines: { colour: string; qty: number }[];
}) {
  await requireRole("ADMIN", "STAFF");
  const lines = (input.lines ?? [])
    .map((l) => ({ colour: colorKey(l.colour), qty: l.qty }))
    .filter((l) => l.colour && l.qty > 0);
  if (lines.length === 0) throw new Error("Add at least one colour with a quantity");
  const total = lines.reduce((a, l) => a + l.qty, 0);
  await db.fabricOrder.create({
    data: {
      fabricId: input.fabricId, supplierId: input.supplierId ?? null,
      qty: total, rate: input.rate ?? null, gsm: input.gsm ?? null,
      status: (input.status ?? "ORDER_PLACED") as any, orderDate: new Date(),
      expectedDate: input.expectedDate ? new Date(input.expectedDate) : null, remarks: input.remarks ?? null,
      lines: { create: lines },
    } as any,
  });
  revalidatePath("/fabric-orders");
  return { ok: true };
}

export async function updateFabricOrder(input: {
  id: number; supplierId?: number | null; expectedDate?: string | null; rate?: number | null;
  gsm?: number | null; lines?: { colour: string; qty: number }[];
}) {
  await requireRole("ADMIN", "STAFF");
  const o = await db.fabricOrder.findUnique({ where: { id: input.id }, select: { poNumber: true } });
  if (!o) throw new Error("Order not found");
  if (o.poNumber) throw new Error("Order is locked — PO already generated");
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
        ...(input.expectedDate !== undefined ? { expectedDate: input.expectedDate ? new Date(input.expectedDate) : null } : {}),
      },
    });
  });
  revalidatePath("/fabric-orders");
  return { ok: true };
}

export async function deleteFabricOrder(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  const o = await db.fabricOrder.findUnique({ where: { id: input.id }, select: { poNumber: true } });
  if (o?.poNumber) throw new Error("Order is locked — PO already generated");
  await db.fabricOrder.delete({ where: { id: input.id } });
  revalidatePath("/fabric-orders");
  return { ok: true };
}

export async function updateFabricOrderStatus(input: { id: number; status: string }) {
  await requireRole("ADMIN", "STAFF");
  if (input.status === "RECEIVED") return receiveFabricOrder({ id: input.id });
  await db.fabricOrder.update({ where: { id: input.id }, data: { status: input.status as any } });
  revalidatePath("/fabric-orders");
  return { ok: true };
}

/** Receive a fabric order: land EVERY line's qty into that colour's stock once (guard via receivedDate). */
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

/** Assign PO-YYYY-NNN (yearly sequence), lock the order. Idempotent. */
export async function generatePO(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  const o = await db.fabricOrder.findUnique({ where: { id: input.id }, select: { poNumber: true } });
  if (!o) throw new Error("Order not found");
  if (o.poNumber) return { poNumber: o.poNumber }; // idempotent
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const existing = await db.fabricOrder.findMany({ where: { poNumber: { startsWith: prefix } }, select: { poNumber: true } });
  const maxN = existing.reduce((m, e) => Math.max(m, parseInt(e.poNumber!.slice(prefix.length), 10) || 0), 0);
  const poNumber = `${prefix}${String(maxN + 1).padStart(3, "0")}`;
  await db.fabricOrder.update({ where: { id: input.id }, data: { poNumber, poGeneratedAt: new Date() } });
  revalidatePath("/fabric-orders");
  return { poNumber };
}

export async function markPOSent(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  await db.fabricOrder.update({ where: { id: input.id }, data: { sentAt: new Date() } });
  revalidatePath("/fabric-orders");
  return { ok: true };
}

export async function createTrim(input: {
  name: string; category?: string | null; supplierId?: number | null; ratePerUnit?: number | null; unit?: string | null;
  openingStock?: number; size?: string | null; material?: string | null; weight?: string | null; shape?: string | null; color?: string | null; remarks?: string | null;
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
    } as any,
  });
  revalidatePath("/trims");
  return { id: t.id };
}

export async function updateTrim(input: {
  id: number; name?: string; category?: string | null; supplierId?: number | null; ratePerUnit?: number | null;
  unit?: string | null; status?: string; size?: string | null; material?: string | null; weight?: string | null;
  shape?: string | null; color?: string | null; remarks?: string | null;
}) {
  await requireRole("ADMIN", "STAFF");
  const { id, ...rest } = input;
  await db.trimItem.update({ where: { id }, data: rest as any });
  revalidatePath("/trims");
  revalidatePath(`/trims/${id}`);
  return { ok: true };
}

/** Stock grows via receipts (writes a movement rather than overwriting). */
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

type ImgEntity = "trim" | "fabric" | "fabricOrder" | "product";
const IMG_FK: Record<ImgEntity, "trimItemId" | "fabricId" | "fabricOrderId" | "productId"> = {
  trim: "trimItemId", fabric: "fabricId", fabricOrder: "fabricOrderId", product: "productId",
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
  samplingStatus?: string | null; productionLot?: string | null; fabricRemarks?: string | null; otherRemarks?: string | null;
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
      ...(rest.samplingStatus !== undefined ? { samplingStatus: (rest.samplingStatus || null) as any } : {}),
      ...(rest.productionLot !== undefined ? { productionLot: (rest.productionLot || null) as any } : {}),
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
  samplingStatus?: string | null;
  productionLot?: string | null;
  avgConsumption?: number | null;
  unit?: string;
  mrp?: number | null;
  customWsRate?: number | null;
  fabricRemarks?: string | null;
  otherRemarks?: string | null;
}) {
  const user = await requireRole("ADMIN", "STAFF");
  const name = input.name.trim();
  if (!name) throw new Error("Product name is required");

  const sku = (input.skuCode ?? "").trim();
  const canSeeCost = user.role === "ADMIN";

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
          samplingStatus: (input.samplingStatus || null) as any,
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

export async function createChallan(input: {
  direction: "INWARD" | "OUTWARD";
  supplierId?: number | null;
  vendorId?: number | null;
  date?: string;
  note?: string | null;
}) {
  await requireRole("ADMIN", "STAFF");
  if (input.direction === "INWARD" && !input.supplierId) throw new Error("Inward challan needs a supplier");
  if (input.direction === "OUTWARD" && !input.vendorId) throw new Error("Outward challan needs a vendor");
  const c = await db.materialChallan.create({
    data: {
      direction: input.direction as any,
      supplierId: input.direction === "INWARD" ? input.supplierId ?? null : null,
      vendorId: input.direction === "OUTWARD" ? input.vendorId ?? null : null,
      date: input.date ? new Date(input.date) : new Date(),
      note: input.note ?? null,
    },
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
  revalidatePath(`/challans/${line.challanId}`);
  return { ok: true };
}

/** Lock a challan: assign CH-IN/CH-OUT-YYYY-NNN and post every line to the shared ledger. Idempotent. */
export async function lockChallan(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  const c = await db.materialChallan.findUnique({ where: { id: input.id }, include: { lines: true } });
  if (!c) throw new Error("Challan not found");
  if (c.status === "LOCKED") return { challanNo: c.challanNo }; // idempotent
  if (c.lines.length === 0) throw new Error("Add at least one line before locking");

  const year = new Date().getFullYear();
  const prefix = c.direction === "INWARD" ? `CH-IN-${year}-` : `CH-OUT-${year}-`;
  const existing = await db.materialChallan.findMany({ where: { challanNo: { startsWith: prefix } }, select: { challanNo: true } });
  const maxN = existing.reduce((m, e) => Math.max(m, parseInt(e.challanNo!.slice(prefix.length), 10) || 0), 0);
  const challanNo = `${prefix}${String(maxN + 1).padStart(3, "0")}`;
  const dir = c.direction === "INWARD" ? "IN" : "OUT";
  const now = new Date();

  await db.$transaction(async (tx) => {
    await tx.materialChallan.update({ where: { id: c.id }, data: { status: "LOCKED", challanNo, lockedAt: now } });
    for (const l of c.lines) {
      await postMaterialMovement(tx, {
        direction: dir,
        qty: l.qty,
        date: now,
        note: `Challan ${challanNo}`,
        fabricId: l.fabricId ?? null,
        colour: l.colour ?? null,
        trimItemId: l.trimItemId ?? null,
      });
    }
  });
  revalidatePath("/challans");
  revalidatePath(`/challans/${c.id}`);
  revalidatePath("/inventory");
  revalidatePath("/trims");
  return { challanNo };
}

/** Void a LOCKED challan: reverse every posted movement. */
export async function voidChallan(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  const c = await db.materialChallan.findUnique({ where: { id: input.id }, include: { lines: true } });
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
    await tx.materialChallan.update({ where: { id: c.id }, data: { voidedAt: now } });
  });
  revalidatePath("/challans");
  revalidatePath(`/challans/${c.id}`);
  revalidatePath("/inventory");
  revalidatePath("/trims");
  return { ok: true };
}
