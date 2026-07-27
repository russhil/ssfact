import Link from "next/link";
import { getJobs } from "@/lib/jobs";
import { getVendorList, getCuttingMasterList } from "@/lib/masters";
import { getCurrentUser } from "@/lib/auth";
import { Card, Bar, PageHeader } from "@/components/ui";
import { VendorCuttingManager } from "@/components/vendor-cutting-manager";
import { num, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const jobs = await getJobs();
  const me = await getCurrentUser();
  const canEdit = me?.role === "ADMIN" || me?.role === "STAFF";
  const [vendorList, cuttingList] = canEdit ? await Promise.all([getVendorList(), getCuttingMasterList()]) : [[], []];

  // Change 19 C: roll up by the LAYER vendor. This index used to attribute a whole card to
  // its header vendor, so its totals contradicted /vendors/[name], which is already
  // layer-based. Split cards now contribute to each vendor in proportion to the work.
  const map = new Map<string, { name: string; jobs: number; active: number; cut: number; disp: number; overdue: number }>();
  for (const j of jobs) {
    for (const s of j.split) {
      const v = map.get(s.vendor) ?? { name: s.vendor, jobs: 0, active: 0, cut: 0, disp: 0, overdue: 0 };
      v.jobs++;
      if (j.status === "ACTIVE") v.active++;
      if (j.overdue) v.overdue++;
      v.cut += s.cutQty;
      v.disp += s.dispatchedQty;
      map.set(s.vendor, v);
    }
  }
  const vendors = [...map.values()]
    .filter((v) => v.cut > 0 && v.name !== "Unassigned")
    .map((v) => ({ ...v, fill: v.cut ? v.disp / v.cut : 0 }))
    .sort((a, b) => b.cut - a.cut);

  return (
    <div className="p-6">
      <PageHeader title="Vendors" subtitle="Stitching units — in-house and external" />
      {canEdit && (
        <div className="mb-4">
          <VendorCuttingManager vendors={vendorList} masters={cuttingList} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {vendors.map((v) => (
          <Card key={v.name} className="p-5">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <Link href={`/vendors/${encodeURIComponent(v.name)}`} className="t-head font-bold text-primary-ink hover:underline">
                  {v.name}
                </Link>
                <div className="mt-0.5 t-xs text-faint">
                  {v.active} active · {v.jobs} total{v.overdue > 0 && <span className="text-danger"> · {v.overdue} overdue</span>}
                </div>
              </div>
              <span className="t-title font-extrabold tnum">{pct(v.fill)}</span>
            </div>
            <Bar value={v.fill} tone={v.fill < 0.65 ? "warn" : "primary"} />
            <div className="mt-3 flex justify-between t-xs text-muted">
              <span>Cut <b className="text-ink tnum">{num(v.cut)}</b></span>
              <span>Received <b className="text-ink tnum">{num(v.disp)}</b></span>
              <span>Balance <b className="text-ink tnum">{num(v.cut - v.disp)}</b></span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
