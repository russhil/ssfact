import { db } from "@/lib/db";
import { getSuppliers, getVendorList, getColours, listChallans } from "@/lib/masters";
import { PageHeader } from "@/components/ui";
import { ChallanManager } from "@/components/challan-manager";

export const dynamic = "force-dynamic";

export default async function ChallansPage() {
  const [fabrics, trims, suppliers, vendors, colours, challans] = await Promise.all([
    db.fabric.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.trimItem.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSuppliers(),
    getVendorList(),
    getColours(),
    listChallans(),
  ]);
  return (
    <div className="p-6">
      <PageHeader title="Materials Challans" subtitle="Inward from suppliers · outward to vendors — one master inventory ledger" />
      <ChallanManager
        fabrics={fabrics}
        trims={trims}
        suppliers={suppliers.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))}
        vendors={vendors.filter((v) => v.active).map((v) => ({ id: v.id, name: v.name }))}
        colours={colours.map((c) => ({ name: c.name }))}
        challans={challans}
      />
    </div>
  );
}
