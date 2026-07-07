import Link from "next/link";
import { getProducts, getCatalogSummary } from "@/lib/catalog";
import { getCurrentUser } from "@/lib/auth";
import { CatalogTable } from "@/components/catalog-table";
import { Card, PageHeader } from "@/components/ui";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const [rows, summary, u] = await Promise.all([getProducts(), getCatalogSummary(), getCurrentUser()]);
  const canSeeCost = u?.role === "ADMIN"; // office/production view hides cost
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
        subtitle="The full commercial range, from the product master. Pricing, lifecycle status, and live production at a glance."
        actions={
          canEdit ? (
            <Link
              href="/catalog/new"
              className="rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-indigo-600"
            >
              + New Product
            </Link>
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-4 gap-3.5">
        {kpis.map(([label, value]) => (
          <Card key={label} className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
            <div className="mt-1.5 text-[22px] font-extrabold tnum">{value}</div>
          </Card>
        ))}
      </div>

      <CatalogTable rows={rows} categories={summary.byCategory.map((c) => c.name)} canSeeCost={canSeeCost} />
    </div>
  );
}
