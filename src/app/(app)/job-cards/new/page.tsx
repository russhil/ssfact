import { getJobProductOptions } from "@/lib/inventory";
import { db } from "@/lib/db";
import { NewJobCardForm } from "@/components/new-jobcard-form";

export const dynamic = "force-dynamic";

export default async function NewJobCardPage() {
  const [products, vendors, masters] = await Promise.all([
    getJobProductOptions(),
    db.vendor.findMany({ orderBy: { name: "asc" } }),
    db.cuttingMaster.findMany({ orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="p-6">
      <NewJobCardForm
        products={products}
        vendors={vendors.map((v) => v.name)}
        masters={masters.map((m) => m.name)}
      />
    </div>
  );
}
