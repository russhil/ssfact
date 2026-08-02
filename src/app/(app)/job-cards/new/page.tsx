import { getJobProductOptions } from "@/lib/inventory";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { NewJobCardForm } from "@/components/new-jobcard-form";
import { getDraftForEdit } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export default async function NewJobCardPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string; si?: string; draft?: string }>;
}) {
  const { productId, si, draft } = await searchParams;
  const [products, vendors, masters, me] = await Promise.all([
    getJobProductOptions(),
    db.vendor.findMany({ orderBy: { name: "asc" } }),
    db.cuttingMaster.findMany({ orderBy: { name: "asc" } }),
    getCurrentUser(),
  ]);
  // Change 38 Part A — resuming a half-finished card.
  const draftCard = draft ? await getDraftForEdit(Number(draft)) : null;
  return (
    <div className="p-6">
      <NewJobCardForm
        products={products}
        vendors={vendors.map((v) => v.name)}
        masters={masters.map((m) => m.name)}
        canSeeCost={me?.role === "ADMIN"}
        defaultProductId={productId ? Number(productId) : null}
        defaultSi={si ?? null}
        draft={draftCard}
      />
    </div>
  );
}
