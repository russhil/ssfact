import { db } from "@/lib/db";
import { getJobs } from "@/lib/jobs";
import { getCurrentUser } from "@/lib/auth";
import { DispatchForm } from "@/components/dispatch-form";
import { DispatchLog } from "@/components/dispatch-log";
import { FinishedGoodsExport } from "@/components/finished-goods-export";
import { PageHeader } from "@/components/ui";
import { jobItem } from "@/lib/job-display";
import { POSTED } from "@/lib/job-scope";

export const dynamic = "force-dynamic";

export default async function DispatchPage() {
  const jobs = await getJobs();
  const me = await getCurrentUser();
  const canEdit = me?.role === "ADMIN" || me?.role === "STAFF";
  const open = jobs
    .filter((j) => j.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    // Change 19 C: the picker names the vendors actually stitching the card (its layer
    // vendors), not the header vendor — a split card would otherwise mislabel itself.
    .map((j) => ({ id: 0, siNo: j.siNo, item: j.item, vendor: j.vendor, balance: j.balance, slug: j.slug }));

  // attach real ids
  // Change 38 Part A: a draft has no SI and nothing to dispatch.
  const all = await db.jobCard.findMany({ where: POSTED, select: { id: true, siNo: true } });
  const idBySi = new Map<string, number[]>();
  for (const r of all) {
    const arr = idBySi.get(r.siNo) ?? [];
    arr.push(r.id);
    idBySi.set(r.siNo, arr);
  }
  const openJobs = open.map((o) => ({ ...o, id: (idBySi.get(o.siNo) ?? [0])[0] }));

  // Change 23 Part D: the whole log, not a "recent 12" — the toolbar is what narrows
  // it now, and a date range over a truncated list would quietly lie.
  const events = await db.dispatchEvent.findMany({
    include: {
      jobCard: { include: { product: true } },
      lines: true,
      layers: { select: { vendor: { select: { name: true } } } },
    },
    orderBy: { date: "desc" },
  });
  const dispatchRows = events.map((e) => ({
    id: e.id, dispatchNo: e.dispatchNo, date: e.date.toISOString(), qty: e.qty,
    reason: e.reason as string, note: e.note, challan: e.challan, arrangedBy: e.arrangedBy,
    voidedAt: e.voidedAt ? e.voidedAt.toISOString() : null,
    lines: e.lines.map((l) => ({ id: l.id, colour: l.colour, size: l.size, qty: l.qty })),
    siNo: e.jobCard.siNo, jobCardId: e.jobCard.id, item: jobItem(e.jobCard),
    // Change 19 C: the vendor that did the work lives on the layer, not the card header.
    vendor: [...new Set(e.layers.map((l) => l.vendor?.name).filter((n): n is string => !!n))].join(", ") || null,
  }));

  return (
    <div className="p-6">
      <PageHeader title="Dispatch" subtitle="Finished garments returned from stitching vendors" />
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[1fr_1.3fr]">
        <div className="flex flex-col gap-3.5">
          <DispatchForm jobs={openJobs} defaultArrangedBy={me?.displayName ?? ""} />
          {/* Change 21: the one bridge to the ERP — a day's finished goods as a file,
              instead of re-typing every size×colour cell off the paper challans. */}
          {canEdit && <FinishedGoodsExport rows={dispatchRows} />}
        </div>

        <DispatchLog rows={dispatchRows} canEdit={canEdit} />
      </div>
    </div>
  );
}
