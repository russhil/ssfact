import { db } from "@/lib/db";
import { isOverdue } from "@/lib/queries";

export const siSlug = (si: string) => si.replace(/\s/g, "");

export type JobRow = {
  siNo: string;
  slug: string;
  item: string;
  styleNo: string;
  vendor: string;
  cutQty: number;
  dispatchedQty: number;
  balance: number;
  fill: number;
  status: string;
  overdue: boolean;
  plannedEtd: Date | null;
  orderDate: Date | null;
};

export async function getJobs(): Promise<JobRow[]> {
  const jobs = await db.jobCard.findMany({
    include: { style: true, vendor: true },
    orderBy: { id: "asc" },
  });
  const now = new Date();
  return jobs.map((j) => ({
    siNo: j.siNo,
    slug: siSlug(j.siNo),
    item: j.style.itemDesc,
    styleNo: j.style.styleNo,
    vendor: j.vendor.name,
    cutQty: j.cutQty,
    dispatchedQty: j.dispatchedQty,
    balance: j.cutQty - j.dispatchedQty,
    fill: j.cutQty ? j.dispatchedQty / j.cutQty : 0,
    status: j.status,
    overdue: isOverdue(j, now),
    plannedEtd: j.plannedEtd,
    orderDate: j.orderDate,
  }));
}

export async function getJob(slug: string) {
  const jobs = await db.jobCard.findMany({
    include: {
      style: { include: { fabric: true } },
      vendor: true,
      cuttingMaster: true,
      dispatches: { orderBy: { date: "asc" } },
      sizeBreakup: true,
    },
  });
  const j = jobs.find((x) => siSlug(x.siNo) === slug);
  if (!j) return null;
  const sizeOrder = ["S", "M", "L", "XL", "2XL", "3XL"];
  j.sizeBreakup.sort((a, b) => sizeOrder.indexOf(a.size) - sizeOrder.indexOf(b.size));
  return j;
}
