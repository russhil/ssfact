import { db } from "@/lib/db";
import { isOverdue } from "@/lib/queries";

export const siSlug = (si: string) => si.replace(/\s/g, "");

const SIZE_ORDER = ["S", "M", "L", "XL", "2XL", "3XL"];

export type JobScope = { vendorName?: string };

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

export async function getJobs(scope?: JobScope): Promise<JobRow[]> {
  const jobs = await db.jobCard.findMany({
    where: scope?.vendorName ? { vendor: { name: scope.vendorName } } : undefined,
    include: { product: true, vendor: true },
    orderBy: { id: "asc" },
  });
  const now = new Date();
  return jobs.map((j) => ({
    siNo: j.siNo,
    slug: siSlug(j.siNo),
    item: j.product.itemDesc ?? j.product.name,
    styleNo: j.product.styleNo ?? j.product.skuCode,
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

export async function getJob(slug: string, scope?: JobScope) {
  const jobs = await db.jobCard.findMany({
    include: {
      product: { include: { fabric: true } },
      vendor: true,
      cuttingMaster: true,
      dispatches: { orderBy: { date: "asc" } },
      sizeBreakup: true,
      jobLines: { include: { trimItem: true } },
      returnNotes: true,
    },
  });
  const j = jobs.find((x) => siSlug(x.siNo) === slug);
  if (!j) return null;
  if (scope?.vendorName && j.vendor.name !== scope.vendorName) return null;
  j.sizeBreakup.sort(
    (a, b) =>
      SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size) || a.color.localeCompare(b.color)
  );
  return j;
}
