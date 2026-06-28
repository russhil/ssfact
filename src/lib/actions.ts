"use server";

import { db } from "@/lib/db";
import { siSlug } from "@/lib/jobs";
import { requireRole } from "@/lib/auth";
import { colorKey } from "@/lib/colour";
import { revalidatePath } from "next/cache";

export type NewJobInput = {
  productId: number;
  vendorName: string;
  cuttingMaster?: string;
  matrix: { size: string; color: string; qty: number }[];
  // per-colour fabric overrides (assumed avg / GSM / roll width); blank ⇒ inherit defaults
  fabricLines?: { color: string; estAvg?: number | null; gsm?: number | null; rollWidth?: number | null }[];
  stage?: "CUTTING" | "STITCHING" | "DISPATCH";
  plannedEtd?: string;
};

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
        productId: product.id,
        vendorId: vendor.id,
        cuttingMasterId,
        sizeBreakup: { create: matrix.map((m) => ({ size: m.size, color: m.color, qty: m.qty })) },
      },
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

    // Frozen BOM snapshot + live trim depletion.
    for (const bom of product.boms) {
      for (const line of bom.lines) {
        const perPieceQty = line.qty ?? null;
        const totalQty = (line.qty ?? 0) * cutQty;
        await tx.jobBomLine.create({
          data: {
            material: line.material,
            color: line.color,
            perPieceQty,
            totalQty: line.trimItemId ? totalQty : perPieceQty != null ? totalQty : null,
            trimItemId: line.trimItemId,
            jobCardId: created.id,
          },
        });
        if (line.trimItemId && totalQty > 0) {
          await tx.trimMovement.create({
            data: { type: "ISSUE", qty: totalQty, date: now, trimItemId: line.trimItemId },
          });
          await tx.trimItem.update({
            where: { id: line.trimItemId },
            data: { currentStock: { decrement: totalQty } },
          });
        }
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
        },
      });
    } else if (fabricId) {
      await db.jobFabricLine.create({
        data: {
          color: key, fabricId, cutQty: 0,
          estAvg: l.actualAvg ?? null, actualAvg: l.actualAvg ?? null,
          gsm: l.gsm ?? null, rollWidth: l.rollWidth ?? null,
          qtyIssued: l.qtyIssued, qtyUsed: l.qtyUsed, jobCardId: job.id,
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
          },
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
