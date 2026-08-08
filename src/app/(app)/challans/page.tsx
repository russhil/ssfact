import { db } from "@/lib/db";
import { getSuppliers, getVendorList, getColours, listChallans, getPendingPOs, getPoPendingChallans, getInwardToday } from "@/lib/masters";
import { PageHeader } from "@/components/ui";
import { ChallanManager } from "@/components/challan-manager";
import { InwardWorklists } from "@/components/inward-worklists";
import { TransferForm } from "@/components/transfer-form";
import { listFirms } from "@/lib/firm-scope";
import { POSTED } from "@/lib/job-scope";

export const dynamic = "force-dynamic";

export default async function ChallansPage({ searchParams }: { searchParams: Promise<{ jobCardId?: string; direction?: string }> }) {
  const sp = await searchParams;
  const [fabrics, trims, suppliers, vendors, colours, challans, jobRows, pendingPOs, poPending, inwardToday] = await Promise.all([
    db.fabric.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.trimItem.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSuppliers(),
    getVendorList(),
    getColours(),
    listChallans(),
    // Job cards for the "raise against a job card" picker (Change 17 Part C).
    db.jobCard.findMany({
      // Change 38 Part A: you cannot raise a challan against a card that has not been saved.
      where: POSTED,
      orderBy: { id: "desc" },
      select: { id: true, siNo: true, customItem: true, product: { select: { name: true } } },
    }),
    // Change 40 Part H8 — the two worklists + the inward-today strip.
    getPendingPOs(),
    getPoPendingChallans(),
    getInwardToday(),
  ]);
  const firms = await listFirms(); // Change 40 Part L8 — firm→firm transfer
  const jobCards = jobRows.map((j) => ({ id: j.id, label: `${j.siNo} · ${j.product?.name ?? j.customItem ?? "—"}` }));
  const initialJobCardId = sp.jobCardId ? Number(sp.jobCardId) : null;
  const initialDirection = sp.direction === "INWARD" ? "INWARD" : "OUTWARD";
  return (
    <div className="p-6">
      <PageHeader title="Materials Challans" subtitle="Inward from suppliers · outward to vendors" />
      <ChallanManager
        fabrics={fabrics}
        trims={trims}
        suppliers={suppliers.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))}
        vendors={vendors.filter((v) => v.active).map((v) => ({ id: v.id, name: v.name }))}
        colours={colours.map((c) => ({ name: c.name }))}
        challans={challans}
        jobCards={jobCards}
        initialJobCardId={initialJobCardId}
        initialDirection={initialDirection}
      />
      <InwardWorklists today={inwardToday} pendingPOs={pendingPOs} poPending={poPending} />
      <TransferForm fabrics={fabrics} trims={trims} firms={firms} colours={colours.map((c) => ({ name: c.name }))} />
    </div>
  );
}
