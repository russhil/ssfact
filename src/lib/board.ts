import { db } from "@/lib/db";
import { isOverdue } from "@/lib/queries";
import { jobItem, jobSku, jobStyle, jobMrp } from "@/lib/job-display";
import { normStage, type Stage } from "@/lib/job-labels";
import type { JobScope } from "@/lib/jobs";

const DAY = 86_400_000;

export type BoardRow = {
  id: number;
  slug: string;
  siNo: string;
  orderDate: Date | null;
  item: string;
  sku: string;
  styleNo: string;
  mrp: number | null; // owner-only render is decided by the page
  cutQty: number;
  dispatchedQty: number;
  stitchBalance: number; // dispatched − cut (negative = still to stitch; positive = extra)
  fabricName: string | null;
  unit: string; // KG for knits, MTR for wovens
  fabricIssueDate: Date | null;
  avg: number | null; // actual avg falls back to estimate
  cutMaster: string | null;
  vendor: string;
  cuttingIssuedOn: Date | null;
  plannedEtd: Date | null;
  daysToEtd: number | null; // whole days; negative = overdue; null = no ETD (sorts last)
  stage: Stage;
  status: string;
  overdue: boolean;
  remark: string | null;
  rejectQty: number | null;
  alterQty: number | null;
  extraQty: number | null;
  hasProduct: boolean;
};

export type BoardFilterOptions = {
  stages: Stage[];
  vendors: string[];
  cuttingMasters: string[];
  products: string[];
  fabrics: string[];
};

/**
 * One row per job card for the Production Board (Change 12, Part A). Reads the stored
 * cutQty/dispatchedQty scalars (maintained by the create/dispatch actions) — no need to
 * re-aggregate children. Derives stitch balance + days-to-ETD (Part C). Tolerates
 * made-to-order cards with no catalogue product (Part D) via the jobItem/… helpers.
 */
export async function getProductionBoard(
  scope?: JobScope
): Promise<{ rows: BoardRow[]; filterOptions: BoardFilterOptions }> {
  const jobs = await db.jobCard.findMany({
    where: scope?.vendorName ? { vendor: { name: scope.vendorName } } : undefined,
    include: {
      product: { include: { fabric: true } },
      vendor: true,
      cuttingMaster: true,
    },
    orderBy: { id: "desc" },
  });
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const rows: BoardRow[] = jobs.map((j) => {
    const stage = normStage(j.stage);
    return {
      id: j.id,
      slug: String(j.id),
      siNo: j.siNo,
      orderDate: j.orderDate,
      item: jobItem(j),
      sku: jobSku(j),
      styleNo: jobStyle(j),
      mrp: j.mrp ?? jobMrp(j),
      cutQty: j.cutQty,
      dispatchedQty: j.dispatchedQty,
      stitchBalance: j.dispatchedQty - j.cutQty,
      fabricName: j.product?.fabric?.name ?? null,
      unit: j.product?.fabric?.unit ?? j.product?.unit ?? "MTR",
      fabricIssueDate: j.fabricIssueDate,
      avg: j.actualAvg ?? j.estAvg ?? j.avgConsumption ?? null,
      cutMaster: j.cuttingMaster?.name ?? null,
      vendor: j.vendor.name,
      cuttingIssuedOn: j.cuttingIssuedOn,
      plannedEtd: j.plannedEtd,
      daysToEtd: j.plannedEtd
        ? Math.floor(
            (new Date(j.plannedEtd.getFullYear(), j.plannedEtd.getMonth(), j.plannedEtd.getDate()).getTime() - today) / DAY
          )
        : null,
      stage,
      status: j.status,
      overdue: isOverdue(j, now),
      remark: j.remark,
      rejectQty: j.rejectQty,
      alterQty: j.alterQty,
      extraQty: j.extraQty,
      hasProduct: j.productId != null,
    };
  });

  const distinct = (xs: (string | null)[]) =>
    [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));

  return {
    rows,
    filterOptions: {
      stages: [...new Set(rows.map((r) => r.stage))],
      vendors: distinct(rows.map((r) => r.vendor)),
      cuttingMasters: distinct(rows.map((r) => r.cutMaster)),
      products: distinct(rows.map((r) => r.item)),
      fabrics: distinct(rows.map((r) => r.fabricName)),
    },
  };
}
