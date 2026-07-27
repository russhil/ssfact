"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge, TableToolbar, useTableView, type CsvExport, type FilterDef } from "@/components/ui";
import { num, fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";

export type VendorDispatchEvent = {
  id: number;
  date: string; // ISO
  reason: string;
  qty: number;
  challan: string | null;
  siNo: string;
  jobCardId: number;
  layerIds: number[];
  layerLabels: string[];
  cells: string[]; // e.g. "BLACK M:150"
};

/**
 * Change 16 Part D — the vendor's dispatch log. Read-only.
 *
 * Change 23 Part H: keeps the layer filter and adds a date range and reason filter.
 * The vendor is fixed by the page, so those are the axes left that matter — "what
 * did this vendor return to me in July" is now two clicks.
 */
export function VendorDispatchLog({
  events,
  layers,
}: {
  events: VendorDispatchEvent[];
  layers: { id: number; label: string }[];
}) {
  const filters: FilterDef<VendorDispatchEvent>[] = useMemo(
    () => [
      {
        key: "layer",
        label: "layers",
        options: layers.map((l) => ({ value: String(l.id), label: l.label })),
        match: (e, v) => e.layerIds.includes(Number(v)),
      },
      {
        key: "reason",
        label: "reasons",
        options: ["ORDER", "SALE", "OTHER"].map((v) => ({ value: v, label: v })),
        match: (e, v) => e.reason === v,
      },
    ],
    [layers]
  );

  const csv: CsvExport<VendorDispatchEvent> = {
    filename: "vendor-dispatches",
    columns: [
      { header: "dispatch_date", value: (e) => new Date(e.date) },
      { header: "si_no", value: (e) => e.siNo },
      { header: "reason", value: (e) => e.reason },
      { header: "layers", value: (e) => e.layerLabels.join("; ") },
      { header: "challan", value: (e) => e.challan },
      { header: "qty", value: (e) => e.qty },
      // the size×colour cells shown under the row
      { header: "cells", value: (e) => e.cells.join("; ") },
    ],
  };

  const view = useTableView<VendorDispatchEvent>({
    id: "vdl",
    rows: events,
    filters,
    search: (e) => [e.siNo, e.challan, ...e.layerLabels, ...e.cells],
    date: (e) => e.date,
    sorts: { date: (e) => new Date(e.date), qty: (e) => e.qty, si: (e) => e.siNo },
    defaultSort: { key: "date", dir: "desc" },
    sum: (e) => e.qty,
  });

  return (
    <div>
      <TableToolbar
        view={view}
        filters={filters}
        searchPlaceholder="Search SI, layer, cell…"
        dateLabel="Dispatch date"
        unit="pcs"
        csv={csv}
      />

      {view.rows.length === 0 ? (
        <p className="py-4 text-center t-sm text-muted">
          {events.length === 0 ? "No dispatches" : "No dispatches match these filters"}
        </p>
      ) : (
        <div className="space-y-1.5">
          {view.rows.map((e) => (
            <div key={e.id} className="border-b border-hairline py-2 t-sm last:border-0">
              <div className="flex items-center justify-between">
                <span className="flex flex-wrap items-center gap-2 text-t2 tnum">
                  {fmtDate(e.date)}
                  <Link href={`/job-cards/${e.jobCardId}`} className="font-bold text-primary-ink hover:underline">{e.siNo}</Link>
                  <Badge tone={e.reason === "SALE" ? "warn" : e.reason === "OTHER" ? "default" : "primary"}>{e.reason}</Badge>
                  {e.layerLabels.length > 0 && <span className="text-faint">{e.layerLabels.join(" + ")}</span>}
                  {e.challan && <span className="text-faint">challan {e.challan}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-bold tnum">+{num(e.qty)}</span>
                  <Link href={`/dispatch-doc/${e.id}`} className="t-xs font-semibold text-primary-ink hover:underline">doc →</Link>
                </span>
              </div>
              {e.cells.length > 0 && <div className={cn("mt-0.5 t-xs text-faint")}>{e.cells.join(" · ")}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
