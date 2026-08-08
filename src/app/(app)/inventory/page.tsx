import { getFabricStock } from "@/lib/inventory";
import { getCurrentUser } from "@/lib/auth";
import { listFirms } from "@/lib/firm-scope";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { AddFabricButton } from "@/components/add-fabric-button";
import { InventoryTable } from "@/components/inventory-table";

export const dynamic = "force-dynamic";

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const { firm } = await searchParams;
  const firms = await listFirms();
  // Change 40 L9 — ADMIN can scope the inventory to one firm or view the all-firms total.
  const firmId = firm && firms.some((f) => String(f.id) === firm) ? Number(firm) : null;
  const [stock, user] = await Promise.all([getFabricStock(firmId), getCurrentUser()]);
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
    // reorderLevel (Change 25 Part E) is what the "Below reorder" filter matches on —
    // without it here the filter compiles but silently matches nothing.
    colors: s.colors.map((c) => ({ id: c.id, color: c.color, current: c.current, status: c.status, reorderLevel: c.reorderLevel })),
  }));

  return (
    <div className="p-6">
      <PageHeader
        title="Inventory"
        subtitle={firmId ? `Live fabric stock · ${firms.find((f) => f.id === firmId)?.name ?? "firm"}` : "Live fabric stock · all firms"}
      />

      {/* Change 40 L9 — firm scope switcher (all-firms total, or one firm's balance). */}
      {firms.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <Link href="/inventory" className={`rounded-lg border px-2.5 py-1 t-xs font-semibold ${!firmId ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-surface text-t1 hover:bg-surface-2"}`}>All firms</Link>
          {firms.map((f) => (
            <Link key={f.id} href={`/inventory?firm=${f.id}`} className={`rounded-lg border px-2.5 py-1 t-xs font-semibold ${firmId === f.id ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-surface text-t1 hover:bg-surface-2"}`}>{f.name}</Link>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="mb-4">
          <AddFabricButton />
        </div>
      )}

      <InventoryTable rows={rows} canDelete={user?.role === "ADMIN"} />
    </div>
  );
}
