import { listSamples } from "@/lib/samples";
import { getCurrentUser, canSeeCost } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { SampleManager } from "@/components/sample-manager";

export const dynamic = "force-dynamic";

export default async function SamplesPage() {
  const [samples, me, products, vendors] = await Promise.all([
    listSamples(),
    getCurrentUser(),
    db.product.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, skuCode: true } }),
    db.vendor.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } }),
  ]);
  const owner = canSeeCost(me);

  return (
    <div className="p-6">
      <PageHeader title="Samples" subtitle="Development before bulk" />
      <SampleManager
        samples={samples}
        owner={owner}
        products={products.map((p) => ({ id: p.id, label: p.name || p.skuCode }))}
        vendors={vendors.map((v) => v.name)}
      />
    </div>
  );
}
