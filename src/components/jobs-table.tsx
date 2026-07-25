"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Bar,
  DataTable,
  EmptyState,
  SearchInput,
  SegmentedFilter,
  Select,
  Toolbar,
  type Column,
} from "@/components/ui";
import { num, pct, fmtDate } from "@/lib/format";
import type { JobRow } from "@/lib/jobs";

type Filter = "all" | "active" | "overdue" | "closed";

export function JobsTable({ rows }: { rows: JobRow[] }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<Filter>("all");
  const [productId, setProductId] = useState<number | "all">("all");

  const productOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of rows) if (r.productId != null && !m.has(r.productId)) m.set(r.productId, r.product ?? "—");
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (productId !== "all" && r.productId !== productId) return false;
      if (f === "active" && r.status !== "ACTIVE") return false;
      if (f === "closed" && r.status !== "CLOSED") return false;
      if (f === "overdue" && !r.overdue) return false;
      if (!needle) return true;
      return (
        r.siNo.toLowerCase().includes(needle) ||
        r.item.toLowerCase().includes(needle) ||
        r.styleNo.toLowerCase().includes(needle) ||
        r.vendors.some((v) => v.toLowerCase().includes(needle))
      );
    });
  }, [rows, q, f, productId]);

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
      header: "SI",
      cell: (r) => (
        <Link href={`/job-cards/${r.slug}`} className="font-bold text-accent-ink hover:underline">
          {r.siNo}
        </Link>
      ),
    },
    {
      key: "item",
      header: "Item",
      cell: (r) => (
        <>
          <span className="block font-medium">{r.item}</span>
          <span className="block t-xs text-t3">{r.styleNo}</span>
        </>
      ),
    },
    { key: "vendor", header: "Vendor", cell: (r) => r.vendor, className: "text-t2" },
    { key: "cut", header: "Cut", align: "right", cell: (r) => num(r.cutQty) },
    { key: "recd", header: "Recd.", align: "right", cell: (r) => num(r.dispatchedQty) },
    {
      key: "fill",
      header: "Fill",
      width: "7.5rem",
      cell: (r) => (
        <span className="flex items-center gap-2">
          <Bar className="w-16" value={r.fill} tone={r.fill < 0.65 ? "warn" : r.fill >= 0.99 ? "ok" : "primary"} />
          <span className="t-xs font-semibold tnum">{pct(r.fill)}</span>
        </span>
      ),
    },
    { key: "etd", header: "ETD", cell: (r) => fmtDate(r.plannedEtd), className: "text-t2 tnum" },
    {
      key: "status",
      header: "Status",
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
      <Toolbar>
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
        <div className="flex items-center gap-2">
          <Select
            size="sm"
            value={productId}
            onChange={(e) => setProductId(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="w-auto"
          >
            <option value="all">All products</option>
            {productOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <SearchInput
            size="sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search SI, style, vendor…"
            wrapClassName="w-64"
          />
        </div>
      </Toolbar>

      <DataTable
        columns={columns}
        rows={shown}
        keyOf={(r, i) => `${r.siNo}-${r.styleNo}-${i}`}
        footer={`${shown.length} of ${rows.length} job cards`}
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
