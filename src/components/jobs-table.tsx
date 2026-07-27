"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Bar,
  DataTable,
  EmptyState,
  SegmentedFilter,
  SortHeader,
  TableToolbar,
  useTableView,
  type Column,
  type FilterDef,
} from "@/components/ui";
import { num, pct, fmtDate } from "@/lib/format";
import type { JobRow } from "@/lib/jobs";

type Filter = "all" | "active" | "overdue" | "closed";

export function JobsTable({ rows }: { rows: JobRow[] }) {
  const [f, setF] = useState<Filter>("all");

  const productOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of rows) if (r.productId != null && !m.has(r.productId)) m.set(r.productId, r.product ?? "—");
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // The status tabs stay their own control (they carry counts); everything else —
  // product filter, search, sort, ETD range — moves onto the shared toolbar so this
  // table behaves like every other one (Change 23 Part G).
  const byStatus = useMemo(
    () =>
      rows.filter((r) => {
        if (f === "active") return r.status === "ACTIVE";
        if (f === "closed") return r.status === "CLOSED";
        if (f === "overdue") return r.overdue;
        return true;
      }),
    [rows, f]
  );

  const filters: FilterDef<JobRow>[] = useMemo(
    () => [
      {
        key: "product",
        label: "products",
        options: productOptions.map((p) => ({ value: String(p.id), label: p.name })),
        match: (r, v) => String(r.productId) === v,
      },
    ],
    [productOptions]
  );

  const view = useTableView<JobRow>({
    id: "jc",
    rows: byStatus,
    filters,
    search: (r) => [r.siNo, r.item, r.styleNo, ...r.vendors],
    date: (r) => r.plannedEtd,
    sorts: {
      si: (r) => r.siNo,
      item: (r) => r.item,
      vendor: (r) => r.vendor,
      cut: (r) => r.cutQty,
      recd: (r) => r.dispatchedQty,
      fill: (r) => r.fill,
      etd: (r) => (r.plannedEtd ? new Date(r.plannedEtd) : null),
      status: (r) => (r.overdue ? "0 overdue" : r.status),
    },
    sum: (r) => r.cutQty,
  });

  const counts = useMemo(
    () => ({
      all: rows.length,
      active: rows.filter((r) => r.status === "ACTIVE").length,
      overdue: rows.filter((r) => r.overdue).length,
      closed: rows.filter((r) => r.status === "CLOSED").length,
    }),
    [rows]
  );

  const columns: Column<JobRow>[] = [
    {
      key: "si",
      header: <SortHeader view={view} sortKey="si">SI</SortHeader>,
      cell: (r) => (
        <Link href={`/job-cards/${r.slug}`} className="font-bold text-accent hover:underline">
          {r.siNo}
        </Link>
      ),
    },
    {
      key: "item",
      header: <SortHeader view={view} sortKey="item">Item</SortHeader>,
      cell: (r) => (
        <>
          <span className="block font-medium">{r.item}</span>
          <span className="block t-xs text-t3">{r.styleNo}</span>
        </>
      ),
    },
    { key: "vendor", header: <SortHeader view={view} sortKey="vendor">Vendor</SortHeader>, cell: (r) => r.vendor, className: "text-t2" },
    { key: "cut", header: <SortHeader view={view} sortKey="cut" align="right">Cut</SortHeader>, align: "right", cell: (r) => num(r.cutQty) },
    { key: "recd", header: <SortHeader view={view} sortKey="recd" align="right">Recd.</SortHeader>, align: "right", cell: (r) => num(r.dispatchedQty) },
    {
      key: "fill",
      header: <SortHeader view={view} sortKey="fill">Fill</SortHeader>,
      width: "7.5rem",
      cell: (r) => (
        <span className="flex items-center gap-2">
          <Bar className="w-16" value={r.fill} tone={r.fill < 0.65 ? "warn" : r.fill >= 0.99 ? "ok" : "primary"} />
          <span className="t-xs font-semibold tnum">{pct(r.fill)}</span>
        </span>
      ),
    },
    { key: "etd", header: <SortHeader view={view} sortKey="etd">ETD</SortHeader>, cell: (r) => fmtDate(r.plannedEtd), className: "text-t2 tnum" },
    {
      key: "status",
      header: <SortHeader view={view} sortKey="status">Status</SortHeader>,
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          {r.overdue ? (
            <Badge tone="danger">Overdue</Badge>
          ) : r.status === "CLOSED" ? (
            <Badge tone="ok">Closed</Badge>
          ) : (
            <Badge tone="primary">Active</Badge>
          )}
          {r.trimsPending && <Badge tone="warn">Trims short</Badge>}
        </span>
      ),
    },
  ];

  return (
    <div>
      <TableToolbar
        view={view}
        filters={filters}
        searchPlaceholder="Search SI, style, vendor…"
        dateLabel="Planned ETD"
        unit="cut"
      >
        <SegmentedFilter
          value={f}
          onChange={setF}
          options={[
            { key: "all", label: "All", count: counts.all },
            { key: "active", label: "Active", count: counts.active },
            { key: "overdue", label: "Overdue", count: counts.overdue },
            { key: "closed", label: "Closed", count: counts.closed },
          ]}
        />
      </TableToolbar>

      <DataTable
        columns={columns}
        rows={view.rows}
        keyOf={(r, i) => `${r.siNo}-${r.styleNo}-${i}`}
        empty={
          rows.length === 0 ? (
            <EmptyState
              title="No job cards yet"
              hint="A job card is created when fabric is issued for cutting. Start one to begin tracking cut, stitch and receipt."
            />
          ) : (
            <EmptyState title="No job cards match" hint="Try clearing the search or switching back to All." />
          )
        }
      />
    </div>
  );
}
