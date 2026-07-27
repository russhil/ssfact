import { getProductionBoard } from "@/lib/board";
import { getCurrentUser, canSeeCost as canSee } from "@/lib/auth";
import { ProductionBoard } from "@/components/production-board";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const u = await getCurrentUser();
  const scope = u?.role === "VENDOR" ? { vendorName: u.vendor ?? "" } : undefined;
  const canSeeCost = canSee(u);
  const { rows, filterOptions } = await getProductionBoard(scope);

  return (
    <div className="p-6">
      <PageHeader
        title="Production Board"
        subtitle="Most overdue first"
      />
      <ProductionBoard rows={rows} filterOptions={filterOptions} canSeeCost={canSeeCost} />
    </div>
  );
}
