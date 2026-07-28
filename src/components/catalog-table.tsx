"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ProductRow } from "@/lib/catalog";
import { STATUS_LABEL, statusTone } from "@/lib/catalog-labels";
import { Badge, SortHeader, TableToolbar, useTableView, type CsvExport, type FilterDef } from "@/components/ui";
import { inr } from "@/lib/format";
import { MasterDelete } from "@/components/master-delete";
import { deleteProduct, updateProduct } from "@/lib/actions";

// Delete is ADMIN-only (Change 36 Part 0); the column is hidden for everyone else so
// nobody is offered a button that would throw Forbidden.
export function CatalogTable({ rows, categories, canSeeCost = true, canDelete = false }: { rows: ProductRow[]; categories: string[]; canSeeCost?: boolean; canDelete?: boolean }) {
  // Change 23 Part G: search + status + category kept exactly as they were, moved onto
  // the shared toolbar, and click-to-sort added.
  const filters: FilterDef<ProductRow>[] = useMemo(
    () => [
      {
        key: "status",
        label: "statuses",
        options: Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: k, label: v })),
        match: (r, v) => r.status === v,
      },
      {
        key: "cat",
        label: "categories",
        options: categories.map((c) => ({ value: c, label: c })),
        match: (r, v) => (r.headCategory ?? "Uncategorised") === v,
      },
    ],
    [categories]
  );

  const csv: CsvExport<ProductRow> = {
    filename: "catalog",
    columns: [
      { header: "sku", value: (r) => r.skuCode },
      { header: "product", value: (r) => r.name },
      { header: "category", value: (r) => r.headCategory },
      // the table swaps MRP/wholesale for fabric/sampling when cost is hidden — so does this
      ...(canSeeCost
        ? [
            { header: "mrp", value: (r: ProductRow) => r.mrp },
            { header: "wholesale", value: (r: ProductRow) => r.wholesale },
          ]
        : [
            { header: "fabric", value: (r: ProductRow) => r.fabricName },
            { header: "sampling", value: (r: ProductRow) => r.samplingStatus },
          ]),
      { header: "where_in_production", value: (r) => r.whereInProduction },
      { header: "status", value: (r) => STATUS_LABEL[r.status] ?? r.status },
    ],
  };

  const view = useTableView<ProductRow>({
    id: "cat",
    rows,
    filters,
    search: (r) => [r.skuCode, r.name, r.headCategory, r.styleGroup],
    sorts: {
      sku: (r) => r.skuCode,
      name: (r) => r.name,
      category: (r) => r.headCategory ?? "",
      mrp: (r) => r.mrp,
      wholesale: (r) => r.wholesale,
    },
  });

  return (
    <div>
      <TableToolbar view={view} filters={filters} searchPlaceholder="Search SKU, name, category…" showDate={false} csv={csv} />

      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <table className="w-full t-sm">
          <thead>
            <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-semibold"></th>
              <th className="px-4 py-2.5"><SortHeader view={view} sortKey="sku">SKU</SortHeader></th>
              <th className="px-4 py-2.5"><SortHeader view={view} sortKey="name">Product</SortHeader></th>
              <th className="px-4 py-2.5"><SortHeader view={view} sortKey="category">Category</SortHeader></th>
              {canSeeCost ? (
                <>
                  <th className="px-4 py-2.5 text-right"><SortHeader view={view} sortKey="mrp" align="right">MRP</SortHeader></th>
                  <th className="px-4 py-2.5 text-right"><SortHeader view={view} sortKey="wholesale" align="right">Wholesale</SortHeader></th>
                </>
              ) : (
                <>
                  <th className="px-4 py-2.5 font-semibold">Fabric</th>
                  <th className="px-4 py-2.5 font-semibold">Sampling</th>
                </>
              )}
              <th className="px-4 py-2.5 font-semibold">Stage</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              {canDelete && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.extId} className="border-b border-hairline last:border-0 hover:bg-surface-2">
                <td className="px-4 py-2">
                  {r.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imageUrl} alt="" loading="lazy" className="h-9 w-9 rounded-md border border-border object-cover" />
                  ) : (
                    <div className="h-9 w-9 rounded-md border border-dashed border-border bg-surface-2" />
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Link href={`/catalog/${encodeURIComponent(r.skuCode)}`} className="font-bold text-primary-ink hover:underline">
                    {r.skuCode}
                  </Link>
                </td>
                <td className="px-4 py-2.5 font-medium">{r.name}</td>
                <td className="px-4 py-2.5 text-t2">{r.headCategory ?? "—"}</td>
                {canSeeCost ? (
                  <>
                    <td className="px-4 py-2.5 text-right tnum">{inr(r.mrp)}</td>
                    <td className="px-4 py-2.5 text-right tnum text-t2">{inr(r.wholesale)}</td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2.5 text-t2">{r.fabricName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-t2">{r.samplingStatus ? r.samplingStatus.replace(/_/g, " ") : "—"}</td>
                  </>
                )}
                <td className="px-4 py-2.5">
                  {r.whereInProduction ? <Badge tone="ok">{r.whereInProduction}</Badge> : <span className="text-faint">—</span>}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={statusTone(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                </td>
                {canDelete && (
                  <td className="px-4 py-2.5 text-right">
                    {/* Change 36 Part 0. A product has no `active` flag — retiring it
                        means status = DISCONTINUED. */}
                    <MasterDelete
                      kind="product"
                      id={r.id}
                      label="Product"
                      onDelete={() => deleteProduct({ id: r.id })}
                      onDeactivate={r.status !== "DISCONTINUED" ? () => updateProduct({ id: r.id, status: "DISCONTINUED" }) : undefined}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
