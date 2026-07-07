import { getProductionBoard } from "@/lib/board";
import { getCurrentUser } from "@/lib/auth";
import { ProductionBoard } from "@/components/production-board";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const u = await getCurrentUser();
  const scope = u?.role === "VENDOR" ? { vendorName: u.vendor ?? "" } : undefined;
  const canSeeCost = u?.role === "ADMIN";
  const { rows, filterOptions } = await getProductionBoard(scope);

  return (
    <div className="p-6">
      <PageHeader
        title="Production Board"
        subtitle="Every order on one screen — most overdue first. Cut · dispatched · stitching balance · fabric · ETD · stage."
      />
      <ProductionBoard rows={rows} filterOptions={filterOptions} canSeeCost={canSeeCost} />
    </div>
  );
}
