import { db } from "@/lib/db";
import { getDashboard } from "@/lib/queries";
import { jobItem } from "@/lib/job-display";
import { STAGE_LABEL, normStage } from "@/lib/job-labels";
import { Lab, type LabData } from "./lab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Design Lab — Sportsun" };

export default async function DesignLabPage() {
  const [{ kpis, vendors, overdue, trend }, rows] = await Promise.all([
    getDashboard(),
    db.jobCard.findMany({
      where: { status: "ACTIVE" },
      include: { vendor: true, product: true },
      orderBy: { orderDate: "desc" },
      take: 12,
    }),
  ]);

  const now = Date.now();
  const jobs: LabData["jobs"] = rows.map((j) => ({
    id: j.id,
    siNo: j.siNo,
    item: jobItem(j),
    vendor: j.vendor?.name ?? "—",
    stage: STAGE_LABEL[normStage(j.stage)],
    cutQty: j.cutQty,
    dispatchedQty: j.dispatchedQty,
    etd: j.plannedEtd
      ? j.plannedEtd.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
      : null,
    late: !!j.plannedEtd && j.plannedEtd.getTime() < now && j.dispatchedQty < j.cutQty,
  }));

  return <Lab data={{ kpis, vendors, overdue, trend, jobs }} />;
}
