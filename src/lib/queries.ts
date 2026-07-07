import { db } from "@/lib/db";

export type JobLike = {
  status: string;
  plannedEtd: Date | null;
  cutQty: number;
  dispatchedQty: number;
};

export const isOverdue = (j: JobLike, now = new Date()) =>
  j.status === "ACTIVE" && !!j.plannedEtd && j.plannedEtd < now && j.cutQty > j.dispatchedQty;

export async function getDashboard() {
  const jobs = await db.jobCard.findMany({
    include: { vendor: true, product: true },
    orderBy: { orderDate: "asc" },
  });
  const now = new Date();

  const totalCut = jobs.reduce((a, j) => a + j.cutQty, 0);
  const totalDispatched = jobs.reduce((a, j) => a + j.dispatchedQty, 0);
  const active = jobs.filter((j) => j.status === "ACTIVE");
  const overdueJobs = jobs.filter((j) => isOverdue(j, now));

  // vendor progress (active jobs only)
  const byVendor = new Map<string, { name: string; jobs: number; cut: number; disp: number }>();
  for (const j of active) {
    const k = j.vendor.name;
    const v = byVendor.get(k) ?? { name: k, jobs: 0, cut: 0, disp: 0 };
    v.jobs++;
    v.cut += j.cutQty;
    v.disp += j.dispatchedQty;
    byVendor.set(k, v);
  }
  const vendors = [...byVendor.values()]
    .filter((v) => v.cut > 0)
    .map((v) => ({ ...v, fill: v.disp / v.cut }))
    .sort((a, b) => b.cut - a.cut)
    .slice(0, 8);

  // overdue list (top 5 by days late)
  const overdue = overdueJobs
    .map((j) => ({
      siNo: j.siNo,
      slug: String(j.id),
      item: j.product.itemDesc ?? j.product.name,
      daysLate: Math.round((now.getTime() - j.plannedEtd!.getTime()) / 86_400_000),
    }))
    .sort((a, b) => b.daysLate - a.daysLate)
    .slice(0, 5);

  // weekly trend by order week (last 9 weeks present in data)
  const weekMap = new Map<number, { week: number; cut: number }>();
  for (const j of jobs) {
    if (!j.orderDate) continue;
    const d = new Date(j.orderDate);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const k = monday.getTime();
    const w = weekMap.get(k) ?? { week: k, cut: 0 };
    w.cut += j.cutQty;
    weekMap.set(k, w);
  }
  const trend = [...weekMap.values()]
    .sort((a, b) => a.week - b.week)
    .slice(-9)
    .map((w) => ({
      label: new Date(w.week).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      cut: Math.round(w.cut),
    }));

  return {
    kpis: {
      totalCut,
      totalDispatched,
      balance: totalCut - totalDispatched,
      fillRate: totalCut ? totalDispatched / totalCut : 0,
      totalJobs: jobs.length,
      activeJobs: active.length,
      closedJobs: jobs.length - active.length,
      overdue: overdueJobs.length,
    },
    vendors,
    overdue,
    trend,
  };
}
