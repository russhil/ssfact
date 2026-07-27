import { getFabricStock } from "@/lib/inventory";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { AddFabricButton } from "@/components/add-fabric-button";
import { InventoryTable } from "@/components/inventory-table";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const [stock, user] = await Promise.all([getFabricStock(), getCurrentUser()]);
  const canEdit = user?.role === "ADMIN" || user?.role === "STAFF";

  // Change 23 Part E: the KPI counts moved into the table component so the headline
  // figures and the filter that shows those rows read one definition of low/short.
  const rows = stock.map((s) => ({
    id: s.id,
    name: s.name,
    unit: s.unit,
    opening: s.opening,
    issued: s.issued,
    available: s.available,
    usedPct: s.usedPct,
    colors: s.colors.map((c) => ({ id: c.id, color: c.color, current: c.current, status: c.status })),
  }));

  return (
    <div className="p-6">
      <PageHeader
        title="Inventory"
        subtitle="Live fabric stock"
      />

      {canEdit && (
        <div className="mb-4">
          <AddFabricButton />
        </div>
      )}

      <InventoryTable rows={rows} />
    </div>
  );
}
