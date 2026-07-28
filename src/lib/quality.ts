import { db } from "@/lib/db";

/**
 * Change 36 Part 3 — the read side of the quality gate.
 *
 * ★ The gate records and warns; it never blocks. So nothing here throws or refuses —
 * it answers "what do we know about this card's quality?" and lets the UI decide how
 * loudly to say it.
 */

export type InspectionStatus = "NONE" | "PASS" | "FAIL" | "PARTIAL" | "OPEN_REJECTS";

export type JobQuality = {
  status: InspectionStatus;
  checked: number;
  pass: number;
  reject: number;
  rework: number;
  /** Rework pieces sent out and not yet back. */
  openRework: number;
  inspections: number;
};

/**
 * One card's quality position. `OPEN_REJECTS` outranks a PASS: a card can pass its last
 * inspection while pieces are still out for repair, and shipping then is the case the
 * owner most wants flagged.
 */
export async function getJobQuality(jobCardId: number): Promise<JobQuality> {
  const [rows, rework] = await Promise.all([
    db.inspection.findMany({
      where: { jobCardId, voidedAt: null },
      orderBy: { at: "desc" },
      select: { result: true, checkedQty: true, passQty: true, rejectQty: true, reworkQty: true },
    }),
    db.rework.findMany({ where: { jobCardId, status: "OPEN" }, select: { qty: true, qtyBack: true } }),
  ]);

  const openRework = rework.reduce((a, r) => a + Math.max(0, r.qty - r.qtyBack), 0);
  if (rows.length === 0) {
    return { status: openRework > 0 ? "OPEN_REJECTS" : "NONE", checked: 0, pass: 0, reject: 0, rework: 0, openRework, inspections: 0 };
  }

  const sum = rows.reduce(
    (a, r) => ({
      checked: a.checked + r.checkedQty,
      pass: a.pass + r.passQty,
      reject: a.reject + r.rejectQty,
      rework: a.rework + r.reworkQty,
    }),
    { checked: 0, pass: 0, reject: 0, rework: 0 }
  );

  const latest = rows[0].result as "PASS" | "FAIL" | "PARTIAL";
  const status: InspectionStatus = openRework > 0 ? "OPEN_REJECTS" : latest;
  return { status, ...sum, openRework, inspections: rows.length };
}

/** Batched for list screens — one query rather than one per card. */
export async function getJobQualityMap(jobCardIds: number[]): Promise<Map<number, InspectionStatus>> {
  if (jobCardIds.length === 0) return new Map();
  const [rows, rework] = await Promise.all([
    db.inspection.findMany({
      where: { jobCardId: { in: jobCardIds }, voidedAt: null },
      orderBy: { at: "desc" },
      select: { jobCardId: true, result: true },
    }),
    db.rework.groupBy({ by: ["jobCardId"], where: { jobCardId: { in: jobCardIds }, status: "OPEN" }, _count: { _all: true } }),
  ]);
  const openSet = new Set(rework.map((r) => r.jobCardId));
  const out = new Map<number, InspectionStatus>();
  for (const id of jobCardIds) out.set(id, "NONE");
  // rows are newest-first, so the first hit per card is its latest result
  for (const r of rows) if (out.get(r.jobCardId) === "NONE") out.set(r.jobCardId, r.result as InspectionStatus);
  for (const id of openSet) out.set(id, "OPEN_REJECTS");
  return out;
}

export async function getJobInspections(jobCardId: number) {
  return db.inspection.findMany({
    where: { jobCardId },
    orderBy: { at: "desc" },
    include: {
      inspectedBy: { select: { displayName: true, username: true } },
      layer: { select: { layerNo: true, label: true } },
      defects: { include: { defectType: { select: { name: true, category: true } } } },
    },
  });
}

export async function getJobReworks(jobCardId: number) {
  return db.rework.findMany({
    where: { jobCardId },
    orderBy: { at: "desc" },
    include: { vendor: { select: { name: true } }, layer: { select: { layerNo: true, label: true } } },
  });
}

export async function getDefectTypes(activeOnly = true) {
  return db.defectType.findMany({
    where: activeOnly ? { active: true } : {},
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}

export type DefectRate = { category: string; name: string; qty: number; share: number };

/** Where the rejects actually come from, over a period. Drives the /reports section. */
export async function getDefectBreakdown(range?: { from?: Date; to?: Date }): Promise<DefectRate[]> {
  const lines = await db.inspectionDefect.findMany({
    where: {
      inspection: {
        voidedAt: null,
        ...(range?.from || range?.to
          ? { at: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
          : {}),
      },
    },
    select: { qty: true, defectType: { select: { name: true, category: true } } },
  });

  const acc = new Map<string, DefectRate>();
  let total = 0;
  for (const l of lines) {
    const key = `${l.defectType.category}|${l.defectType.name}`;
    const g = acc.get(key) ?? { category: l.defectType.category, name: l.defectType.name, qty: 0, share: 0 };
    g.qty += l.qty;
    total += l.qty;
    acc.set(key, g);
  }
  return [...acc.values()]
    .map((g) => ({ ...g, qty: Math.round(g.qty * 100) / 100, share: total > 0 ? g.qty / total : 0 }))
    .sort((a, b) => b.qty - a.qty);
}
