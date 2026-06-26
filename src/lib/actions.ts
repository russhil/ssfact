"use server";

import { db } from "@/lib/db";
import { siSlug } from "@/lib/jobs";
import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export type NewJobInput = {
  productId: number;
  vendorName: string;
  cuttingMaster?: string;
  matrix: { size: string; color: string; qty: number }[];
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
  const estAvg = product.avgConsumption ?? null;
  const estFabric = estAvg != null ? cutQty * estAvg : null;

  const siNo = await nextSiNo();
  const now = new Date();

  const job = await db.$transaction(async (tx) => {
    const created = await tx.jobCard.create({
      data: {
        siNo,
        orderDate: now,
        cutQty,
        dispatchedQty: 0,
        estAvg,
        estFabric,
        avgConsumption: estAvg,
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
        movements:
          product.fabricId && estFabric
            ? { create: [{ type: "ISSUE" as const, qty: estFabric, date: now, fabricId: product.fabricId }] }
            : undefined,
      },
    });

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
  actualAvg?: number;
  fabricDispatched: number;
  fabricUsed: number;
  note?: string;
};

export async function recordFabricActuals(input: FabricActualsInput) {
  await requireRole("ADMIN", "STAFF");
  const job = await db.jobCard.findUnique({
    where: { id: input.jobCardId },
    include: { product: true, returnNotes: true },
  });
  if (!job) throw new Error("Job card not found");

  const returnQty = Math.max(0, input.fabricDispatched - input.fabricUsed);
  const alreadyReturned = job.returnNotes.length > 0;

  await db.jobCard.update({
    where: { id: job.id },
    data: {
      actualAvg: input.actualAvg ?? null,
      fabricDispatched: input.fabricDispatched,
      fabricUsed: input.fabricUsed,
    },
  });

  if (returnQty > 0 && job.product.fabricId && !alreadyReturned) {
    await db.returnNote.create({
      data: {
        qty: returnQty,
        fabricId: job.product.fabricId,
        jobCardId: job.id,
        note: input.note ?? null,
      },
    });
    await db.stockMovement.create({
      data: {
        type: "RECEIPT",
        qty: returnQty,
        date: new Date(),
        fabricId: job.product.fabricId,
        jobCardId: job.id,
        note: `Return ${job.siNo}`,
      },
    });
  }

  revalidatePath(`/job-cards/${siSlug(job.siNo)}`);
  revalidatePath("/inventory");
  return { returnQty: alreadyReturned ? 0 : returnQty };
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
