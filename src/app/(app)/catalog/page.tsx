import Link from "next/link";
import { getProducts, getCatalogSummary } from "@/lib/catalog";
import { getCurrentUser, canSeeCost as canSee } from "@/lib/auth";
import { CatalogTable } from "@/components/catalog-table";
import { Card, PageHeader } from "@/components/ui";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const [rows, summary, u] = await Promise.all([getProducts(), getCatalogSummary(), getCurrentUser()]);
  const canSeeCost = canSee(u); // office/production view hides cost
  const canEdit = u?.role === "ADMIN" || u?.role === "STAFF";

  const kpis: [string, string | number, string?][] = [
    ["Total SKUs", num(summary.total)],
    ["Active", num(summary.active)],
    ["With BOM", num(summary.withBom)],
    ["In Production", num(summary.inProduction)],
  ];

  return (
    <div className="p-6">
      <PageHeader
        title="Catalog — Product Master"
        subtitle="The full commercial range"
        actions={
          canEdit ? (
            <Link
              href="/catalog/new"
              className="rounded-lg bg-primary px-3.5 py-2 t-body font-semibold text-accent-on shadow-sm transition hover:opacity-90"
            >
              + New Product
            </Link>
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-3.5">
        {kpis.map(([label, value]) => (
          <Card key={label} className="p-4">
            <div className="t-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
            <div className="mt-1.5 t-display font-extrabold tnum">{value}</div>
          </Card>
        ))}
      </div>

      <CatalogTable rows={rows} categories={summary.byCategory.map((c) => c.name)} canSeeCost={canSeeCost} canDelete={u?.role === "ADMIN"} />
    </div>
  );
}
