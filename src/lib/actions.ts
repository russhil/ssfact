"use server";

import { db } from "@/lib/db";
import { siSlug } from "@/lib/jobs";
import { requireRole } from "@/lib/auth";
import { colorKey } from "@/lib/colour";
import { revalidatePath } from "next/cache";

type BomDim = "COLOR" | "SIZE" | "FLAT";

export type NewJobInput = {
  productId: number;
  vendorName: string;
  cuttingMaster?: string;
  matrix: { size: string; color: string; qty: number }[];
  // per-colour fabric overrides (assumed avg / GSM / roll width); blank ⇒ inherit defaults
  fabricLines?: { color: string; estAvg?: number | null; gsm?: number | null; rollWidth?: number | null }[];
  // edited trim sheet (Change 02); omit to fall back to the product's preset BOM
  bomLines?: { trimItemId: number | null; material: string; color?: string | null; dimension: BomDim; perPieceQty: number }[];
  remark?: string;
  stage?: "CUTTING" | "STITCHING" | "DISPATCH";
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
  await requireRole("ADMIN", "STAFF");
  const product = await db.product.findUnique({
    where: { id: input.productId },
    include: { boms: { include: { lines: true } } },
  });
  if (!product) throw new Error("Product not found");

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

  const matrix = input.matrix.filter((m) => m.qty > 0);
  const cutQty = matrix.reduce((a, m) => a + m.qty, 0);
  const defaultAvg = product.avgConsumption ?? null;

  // Group the size×colour matrix into per-colour cut quantities.
  const cutByColour = new Map<string, { display: string; qty: number }>();
  for (const m of matrix) {
    const key = colorKey(m.color);
    const e = cutByColour.get(key) ?? { display: m.color || key, qty: 0 };
    e.qty += m.qty;
    cutByColour.set(key, e);
  }
  // Per-colour overrides from the form, keyed by colour.
  const overrides = new Map(
    (input.fabricLines ?? []).map((l) => [colorKey(l.color), l])
  );

  // Build the per-colour fabric plan (only when the product has a fabric).
  const fabricPlan = product.fabricId
    ? [...cutByColour.entries()].map(([key, { qty }]) => {
        const ov = overrides.get(key);
        const lineAvg = ov?.estAvg ?? defaultAvg;
        const qtyIssued = lineAvg != null ? Math.round(qty * lineAvg * 100) / 100 : null;
        return {
          key,
          cutQty: qty,
          estAvg: lineAvg,
          gsm: ov?.gsm ?? null,
          rollWidth: ov?.rollWidth ?? null,
          qtyIssued,
        };
      })
    : [];
  const estFabric = fabricPlan.length
    ? fabricPlan.reduce((a, l) => a + (l.qtyIssued ?? 0), 0)
    : defaultAvg != null
      ? cutQty * defaultAvg
      : null;

  // Build the trim sheet from the edited lines (fall back to the product preset).
  const presetLines = product.boms.flatMap((b) => b.lines);
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

  const siNo = await nextSiNo();
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
        productId: product.id,
        vendorId: vendor.id,
        cuttingMasterId,
        sizeBreakup: { create: matrix.map((m) => ({ size: m.size, color: m.color, qty: m.qty })) },
      } as any,
    });

    // Per-colour fabric: snapshot a JobFabricLine, issue from that colour's stock,
    // and decrement the FabricColor balance (get-or-create the colour at 0 if new).
    for (const line of fabricPlan) {
      await tx.jobFabricLine.create({
        data: {
          color: line.key,
          fabricId: product.fabricId!,
          jobCardId: created.id,
          cutQty: line.cutQty,
          estAvg: line.estAvg,
          gsm: line.gsm,
          rollWidth: line.rollWidth,
          qtyIssued: line.qtyIssued,
        } as any,
      });
      if (line.qtyIssued && line.qtyIssued > 0) {
        await tx.stockMovement.create({
          data: {
            type: "ISSUE", qty: line.qtyIssued, date: now,
            fabricId: product.fabricId!, jobCardId: created.id, color: line.key,
          } as any,
        });
        const fc = await tx.fabricColor.upsert({
          where: { fabricId_color: { fabricId: product.fabricId!, color: line.key } },
          create: { fabricId: product.fabricId!, color: line.key, openingStock: 0, currentStock: 0 },
          update: {},
        });
        await tx.fabricColor.update({
          where: { id: fc.id },
          data: { currentStock: { decrement: line.qtyIssued } },
        });
      }
    }

    // Frozen BOM snapshot (from the EDITED trim sheet) + live trim depletion.
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
      if (line.trimItemId && line.requiredQty > 0) {
        await tx.trimMovement.create({
          data: { type: "ISSUE", qty: line.requiredQty, date: now, trimItemId: line.trimItemId },
        });
        await tx.trimItem.update({
          where: { id: line.trimItemId },
          data: { currentStock: { decrement: line.requiredQty } },
        });
      }
    }

    return created;
  });

  revalidatePath("/");
  revalidatePath("/job-cards");
  revalidatePath("/inventory");
  revalidatePath("/trims");
  return { slug: siSlug(job.siNo), siNo: job.siNo };
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
  const fabricId = job.product.fabricId;

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

  revalidatePath(`/job-cards/${siSlug(job.siNo)}`);
  revalidatePath("/inventory");
  return { returnQty: totalReturned };
}

export async function setJobStage(input: {
  jobCardId: number;
  stage: "CUTTING" | "STITCHING" | "DISPATCH";
}) {
  await requireRole("ADMIN", "STAFF");
  const job = await db.jobCard.update({
    where: { id: input.jobCardId },
    data: { stage: input.stage },
  });
  revalidatePath("/job-cards");
  revalidatePath(`/job-cards/${siSlug(job.siNo)}`);
  return { stage: job.stage };
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
}) {
  await requireRole("ADMIN", "STAFF");
  const job = await db.jobCard.findUnique({ where: { id: input.jobCardId } });
  if (!job) throw new Error("Job card not found");

  const newDispatched = Math.min(job.cutQty, job.dispatchedQty + input.qty);
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
          } as any,
        ],
      },
    },
  });

  revalidatePath("/");
  revalidatePath("/dispatch");
  revalidatePath("/job-cards");
  return { siNo: job.siNo, dispatched: newDispatched, closed };
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
  const job = await db.jobCard.findUnique({ where: { id: line.jobCardId }, select: { siNo: true } });
  if (job) revalidatePath(`/job-cards/${siSlug(job.siNo)}`);
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

export async function createSupplier(input: { name: string; type?: string | null; city?: string | null; phone?: string | null; remarks?: string | null }) {
  await requireRole("ADMIN", "STAFF");
  if (!input.name.trim()) throw new Error("Name required");
  const s = await db.supplier.create({
    data: { name: input.name.trim(), type: (input.type ?? null) as any, city: input.city ?? null, phone: input.phone ?? null, remarks: input.remarks ?? null },
  });
  revalidatePath("/suppliers");
  return { id: s.id };
}

export async function updateSupplier(input: { id: number; name?: string; type?: string | null; city?: string | null; phone?: string | null; remarks?: string | null; active?: boolean }) {
  await requireRole("ADMIN", "STAFF");
  await db.supplier.update({
    where: { id: input.id },
    data: {
      ...(input.name != null ? { name: input.name.trim() } : {}),
      ...(input.type !== undefined ? { type: (input.type ?? null) as any } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
  revalidatePath("/suppliers");
  return { ok: true };
}

export async function createFabricOrder(input: {
  fabricId: number; color?: string | null; supplierId?: number | null; qty: number; unit?: "KG" | "MTR";
  rate?: number | null; gsm?: number | null; expectedDate?: string | null; status?: string; remarks?: string | null;
}) {
  await requireRole("ADMIN", "STAFF");
  await db.fabricOrder.create({
    data: {
      fabricId: input.fabricId, color: input.color ? colorKey(input.color) : null, supplierId: input.supplierId ?? null,
      qty: input.qty, unit: (input.unit ?? "MTR") as any, rate: input.rate ?? null, gsm: input.gsm ?? null,
      status: (input.status ?? "PLANNING") as any, orderDate: new Date(),
      expectedDate: input.expectedDate ? new Date(input.expectedDate) : null, remarks: input.remarks ?? null,
    },
  });
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

/** Receive a fabric order: land qty into the colour's stock once (guard via receivedDate). */
export async function receiveFabricOrder(input: { id: number }) {
  await requireRole("ADMIN", "STAFF");
  const o = await db.fabricOrder.findUnique({ where: { id: input.id } });
  if (!o) throw new Error("Order not found");
  if (o.receivedDate) return { ok: true, already: true as const }; // double-receive guard
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.fabricOrder.update({ where: { id: o.id }, data: { status: "RECEIVED", receivedDate: now } });
    const color = o.color ? colorKey(o.color) : null;
    await tx.stockMovement.create({ data: { type: "RECEIPT", qty: o.qty, date: now, fabricId: o.fabricId, color, note: "Fabric order received" } as any });
    if (color) {
      const fc = await tx.fabricColor.upsert({
        where: { fabricId_color: { fabricId: o.fabricId, color } },
        create: { fabricId: o.fabricId, color, openingStock: o.qty, currentStock: o.qty },
        update: { currentStock: { increment: o.qty } },
      });
      void fc;
    } else {
      await tx.fabric.update({ where: { id: o.fabricId }, data: { openingStock: { increment: o.qty } } });
    }
  });
  revalidatePath("/fabric-orders");
  revalidatePath("/inventory");
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
