import { getStyleOptions } from "@/lib/inventory";
import { db } from "@/lib/db";
import { NewJobCardForm } from "@/components/new-jobcard-form";

export const dynamic = "force-dynamic";

export default async function NewJobCardPage() {
  const [styles, vendors, masters] = await Promise.all([
    getStyleOptions(),
    db.vendor.findMany({ orderBy: { name: "asc" } }),
    db.cuttingMaster.findMany({ orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="p-6">
      <NewJobCardForm
        styles={styles}
        vendors={vendors.map((v) => v.name)}
        masters={masters.map((m) => m.name)}
      />
    </div>
  );
}
