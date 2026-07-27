import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { FinishingLog } from "@/components/finishing-log";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Change 20 Part C.3 — the top-level finishing index.
 *
 * Read-only. Issuing and receiving happen on the job card, where the layers are;
 * this is the "what is out with whom right now" view across every card.
 */
export default async function FinishingPage() {
  const user = await getCurrentUser();
  const canSeeCost = user?.role === "ADMIN";

  const jobs = await db.finishingJob.findMany({
    include: { vendor: { select: { name: true } }, jobCard: { select: { id: true, siNo: true } } },
    orderBy: { issuedDate: "desc" },
  });

  const rows = jobs.map((f) => ({
    id: f.id,
    docNo: f.docNo,
    process: f.process as string,
    status: f.status as string,
    vendor: f.vendor.name,
    siNo: f.jobCard.siNo,
    jobCardId: f.jobCard.id,
    issuedDate: f.issuedDate.toISOString(),
    receivedDate: f.receivedDate ? f.receivedDate.toISOString() : null,
    qtyOut: f.qtyOut,
    qtyBack: f.qtyBack,
    rate: canSeeCost ? f.rate : null,
    billNo: f.billNo,
  }));

  const out = rows.reduce((a, r) => a + r.qtyOut, 0);
  const back = rows.reduce((a, r) => a + r.qtyBack, 0);
  const open = rows.filter((r) => r.status === "OPEN").length;

  return (
    <div className="p-6">
      <PageHeader
        title="Finishing"
        subtitle="Print · embroidery · wash · sublimation"
      />

      <div className="mb-4 grid grid-cols-4 gap-3.5">
        {[
          ["Documents", num(rows.length), ""],
          ["Pieces Out", num(out), ""],
          ["Pieces Back", num(back), "text-ok"],
          ["Still With Vendors", num(Math.round((out - back) * 100) / 100), "text-warn"],
        ].map(([label, value, tone]) => (
          <Card key={label} className="p-4">
            <div className="t-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
            <div className={`mt-1.5 t-display font-extrabold tnum ${tone}`}>{value}</div>
          </Card>
        ))}
      </div>

      <FinishingLog
        rows={rows}
        canSeeCost={canSeeCost}
        id="jwall"
        title="All job-work"
        subtitle={`${open} open`}
      />
    </div>
  );
}
