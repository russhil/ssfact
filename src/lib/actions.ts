"use server";

import { db } from "@/lib/db";
import { siSlug } from "@/lib/jobs";
import { revalidatePath } from "next/cache";

export type NewJobInput = {
  styleId: number;
  vendorName: string;
  cuttingMaster?: string;
  cutQty: number;
  plannedEtd?: string;
};

const SIZE_RATIO: [string, number][] = [
  ["S", 0.08], ["M", 0.17], ["L", 0.25], ["XL", 0.25], ["2XL", 0.17], ["3XL", 0.08],
];

function sizeRows(cutQty: number) {
  let run = 0;
  return SIZE_RATIO.map(([size, r], i) => {
    const qty = i < SIZE_RATIO.length - 1 ? Math.round(cutQty * r) : Math.round(cutQty) - run;
    run += qty;
    return { size, qty };
  }).filter((s) => s.qty > 0);
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
  const style = await db.style.findUnique({ where: { id: input.styleId } });
  if (!style) throw new Error("Style not found");

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

  const siNo = await nextSiNo();
  const consumed = style.avgConsumption ? input.cutQty * style.avgConsumption : null;

  const job = await db.jobCard.create({
    data: {
      siNo,
      orderDate: new Date(),
      cutQty: input.cutQty,
      dispatchedQty: 0,
      avgConsumption: style.avgConsumption,
      fabricConsumed: consumed,
      fabricIssueDate: new Date(),
      cuttingIssuedOn: new Date(),
      plannedEtd: input.plannedEtd ? new Date(input.plannedEtd) : null,
      status: "ACTIVE",
      styleId: style.id,
      vendorId: vendor.id,
      cuttingMasterId,
      sizeBreakup: { create: sizeRows(input.cutQty) },
      movements:
        style.fabricId && consumed
          ? { create: [{ type: "ISSUE", qty: consumed, date: new Date(), fabricId: style.fabricId }] }
          : undefined,
    },
  });

  revalidatePath("/");
  revalidatePath("/job-cards");
  revalidatePath("/inventory");
  return { slug: siSlug(job.siNo), siNo: job.siNo };
}

export async function addDispatch(input: { jobCardId: number; qty: number; date?: string }) {
  const job = await db.jobCard.findUnique({ where: { id: input.jobCardId } });
  if (!job) throw new Error("Job card not found");

  const newDispatched = Math.min(job.cutQty, job.dispatchedQty + input.qty);
  const closed = newDispatched >= job.cutQty;

  await db.jobCard.update({
    where: { id: job.id },
    data: {
      dispatchedQty: newDispatched,
      status: closed ? "CLOSED" : job.status,
      dispatches: { create: [{ date: input.date ? new Date(input.date) : new Date(), qty: input.qty }] },
    },
  });

  revalidatePath("/");
  revalidatePath("/dispatch");
  revalidatePath("/job-cards");
  return { siNo: job.siNo, dispatched: newDispatched, closed };
}
