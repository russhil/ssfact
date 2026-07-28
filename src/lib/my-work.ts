import { db } from "@/lib/db";
import { vendorScopeWhere } from "@/lib/jobs";
import { normStage, type Stage } from "@/lib/job-labels";
import { getLowStockAlerts } from "@/lib/insights";

/**
 * Change 36 Part 9 — the same data, through a role-shaped lens.
 *
 * ★ No new tables, no new roles, no new permissions. ssfact is built for the owner's
 * desktop, but the people who move the work are on phones on the floor.
 *
 * ⚠️ Vendor scoping ALWAYS goes through vendorScopeWhere. Hand-rolling
 * `{ vendor: { name } }` misses cards where this vendor owns a LAYER but not the header —
 * which is most split cards, and the exact class of bug Change 19 C exists to fix.
 */

export type WorkCard = {
  id: number;
  siNo: string;
  item: string | null;
  stage: Stage;
  cutQty: number;
  dispatchedQty: number;
  balance: number;
  plannedEtd: Date | null;
  daysToEtd: number | null;
  overdue: boolean;
};

const DAY = 86400000;
function midnight(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** A vendor's own open work, grouped by the stage it sits at. */
export async function getVendorWork(vendorName: string): Promise<Partial<Record<Stage, WorkCard[]>>> {
  const jobs = await db.jobCard.findMany({
    where: { status: "ACTIVE", ...(vendorScopeWhere({ vendorName }) ?? {}) },
    select: {
      id: true, siNo: true, stage: true, cutQty: true, dispatchedQty: true, plannedEtd: true,
      customItem: true,
      product: { select: { name: true, skuCode: true } },
    },
    orderBy: [{ plannedEtd: "asc" }, { id: "desc" }],
  });

  const today = midnight(new Date());
  const grouped: Partial<Record<Stage, WorkCard[]>> = {};
  for (const j of jobs) {
    const balance = j.cutQty - j.dispatchedQty;
    const stage = normStage(j.stage);
    const daysToEtd = j.plannedEtd ? Math.round((midnight(j.plannedEtd) - today) / DAY) : null;
    const card: WorkCard = {
      id: j.id,
      siNo: j.siNo,
      item: j.product?.name || j.product?.skuCode || j.customItem || null,
      stage,
      cutQty: j.cutQty,
      dispatchedQty: j.dispatchedQty,
      balance,
      plannedEtd: j.plannedEtd,
      daysToEtd,
      overdue: daysToEtd != null && daysToEtd < 0 && balance > 0,
    };
    (grouped[stage] ??= []).push(card);
  }
  return grouped;
}

export type CuttingWork = {
  layerId: number;
  layerNo: number;
  label: string | null;
  siNo: string;
  jobCardId: number;
  cutDate: Date | null;
  qty: number;
  issued: number | null;
  used: number | null;
  vendor: string | null;
  master: string | null;
};

/**
 * The cutting-master lens.
 *
 * ⚠️ This is a FILTERED STAFF VIEW, not a role. There is no CUTTING role — the four roles
 * are ADMIN | STAFF | VENDOR | TRIMS — and CuttingMaster has no link to User at all.
 * Part 9's own out-of-scope says "no new roles", so this shows every open lay and lets
 * the master filter to their own name rather than inventing a login for them.
 */
export async function getCuttingWork(masterName?: string | null): Promise<CuttingWork[]> {
  const layers = await db.cuttingLayer.findMany({
    where: {
      jobCard: { status: "ACTIVE" },
      ...(masterName ? { cuttingMaster: { name: masterName } } : {}),
    },
    orderBy: [{ cutDate: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true, layerNo: true, label: true, cutDate: true, fabricIssued: true, fabricMtr: true,
      vendor: { select: { name: true } },
      cuttingMaster: { select: { name: true } },
      cells: { select: { qty: true } },
      jobCard: { select: { id: true, siNo: true } },
    },
  });

  return layers.map((l) => ({
    layerId: l.id,
    layerNo: l.layerNo,
    label: l.label,
    siNo: l.jobCard.siNo,
    jobCardId: l.jobCard.id,
    cutDate: l.cutDate,
    qty: l.cells.reduce((a, c) => a + c.qty, 0),
    issued: l.fabricIssued,
    used: l.fabricMtr,
    vendor: l.vendor?.name ?? null,
    master: l.cuttingMaster?.name ?? null,
  }));
}

export type TrimsWork = {
  pendingChallans: { id: number; challanNo: string | null; date: Date; lines: number; direction: string }[];
  belowReorder: { id: number; name: string; colour: string | null; currentStock: number; reorderLevel: number; unit: string }[];
};

/** The trims keeper's lens: what is waiting to be logged, and what is running out. */
export async function getTrimsWork(): Promise<TrimsWork> {
  const [drafts, low] = await Promise.all([
    db.materialChallan.findMany({
      where: { status: "DRAFT", voidedAt: null },
      orderBy: { date: "desc" },
      take: 30,
      select: { id: true, challanNo: true, date: true, direction: true, lines: { select: { id: true } } },
    }),
    getLowStockAlerts(),
  ]);

  return {
    pendingChallans: drafts.map((c) => ({
      id: c.id, challanNo: c.challanNo, date: c.date, lines: c.lines.length, direction: c.direction as string,
    })),
    belowReorder: low
      .filter((a) => a.kind === "TRIM")
      .map((a) => ({
        id: a.id, name: a.name, colour: a.colour, currentStock: a.currentStock,
        reorderLevel: a.reorderLevel, unit: a.unit,
      })),
  };
}
