"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card, SortHeader, TableToolbar, useTableView, type CsvExport, type FilterDef } from "@/components/ui";
import { DispatchActions, type DispatchEditable } from "@/components/dispatch-actions";
import { num, fmtDate } from "@/lib/format";

/**
 * Change 23 Part D — the dispatch log, sliceable.
 *
 * Was a static "recent 12" list with no controls at all. The date range here is
 * the one that matters most: it's the daily tally the owner reconciles against,
 * and the same selector the Change 21 finished-goods export reuses.
 */

export type DispatchRow = DispatchEditable & {
  siNo: string;
  jobCardId: number;
  item: string;
  vendor: string | null;
};

export function DispatchLog({ rows, canEdit }: { rows: DispatchRow[]; canEdit: boolean }) {
  const vendors = useMemo(
    () => [...new Set(rows.map((r) => r.vendor).filter((v): v is string => !!v))].sort(),
    [rows]
  );

  const filters: FilterDef<DispatchRow>[] = useMemo(
    () => [
      {
        key: "vendor",
        label: "vendors",
        options: vendors.map((v) => ({ value: v, label: v })),
        match: (r, v) => r.vendor === v,
      },
      {
        key: "reason",
        label: "reasons",
        options: ["ORDER", "SALE", "OTHER"].map((v) => ({ value: v, label: v })),
        match: (r, v) => r.reason === v,
      },
      {
        key: "state",
        label: "states",
        // Change 22 B.1: voided dispatches never happened — out of the daily view
        // unless asked for, and never in the tally.
        initial: "LIVE",
        options: [
          { value: "LIVE", label: "Live only" },
          { value: "VOID", label: "Voided" },
        ],
        match: (r, v) => (v === "VOID" ? !!r.voidedAt : !r.voidedAt),
      },
    ],
    [vendors]
  );

  const csv: CsvExport<DispatchRow> = {
    filename: "dispatches",
    columns: [
      { header: "dispatch_date", value: (r) => new Date(r.date) },
      { header: "dc_no", value: (r) => r.dispatchNo ?? r.challan ?? `#${r.id}` },
      { header: "si_no", value: (r) => r.siNo },
      { header: "item", value: (r) => r.item },
      { header: "vendor", value: (r) => r.vendor },
      { header: "reason", value: (r) => r.reason },
      { header: "qty", value: (r) => r.qty },
      // the row is struck through when voided; the export says so in words
      { header: "state", value: (r) => (r.voidedAt ? "VOID" : "LIVE") },
    ],
  };

  const view = useTableView<DispatchRow>({
    id: "dp",
    rows,
    filters,
    search: (r) => [r.siNo, r.dispatchNo, r.challan, r.vendor, r.item, r.note],
    date: (r) => r.date,
    sorts: {
      date: (r) => new Date(r.date),
      no: (r) => r.dispatchNo ?? "",
      si: (r) => r.siNo,
      vendor: (r) => r.vendor ?? "",
      qty: (r) => r.qty,
    },
    defaultSort: { key: "date", dir: "desc" },
    // the daily dispatch tally — the number the owner checks the day against
    sum: (r) => (r.voidedAt ? 0 : r.qty),
  });

  return (
    <Card className="p-5">
      <div className="mb-3 t-body font-bold">Dispatches</div>
      <TableToolbar
        view={view}
        filters={filters}
        searchPlaceholder="Search SI, DC no, vendor, note…"
        dateLabel="Dispatch date"
        unit="pcs"
        csv={csv}
      />
      <div className="overflow-x-auto">
        <table className="w-full t-sm">
          <thead>
            <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
              <th className="px-3 py-2.5"><SortHeader view={view} sortKey="date">Date</SortHeader></th>
              <th className="px-3 py-2.5"><SortHeader view={view} sortKey="no">Challan</SortHeader></th>
              <th className="px-3 py-2.5"><SortHeader view={view} sortKey="si">Job</SortHeader></th>
              <th className="px-3 py-2.5 font-semibold">Item</th>
              <th className="px-3 py-2.5"><SortHeader view={view} sortKey="vendor">Vendor</SortHeader></th>
              <th className="px-3 py-2.5 font-semibold">Reason</th>
              <th className="px-3 py-2.5 text-right"><SortHeader view={view} sortKey="qty" align="right">Qty</SortHeader></th>
              {canEdit && <th className="px-3 py-2.5"></th>}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((e) => {
              const dead = !!e.voidedAt;
              return (
                <tr key={e.id} className={`border-b border-hairline last:border-0 ${dead ? "opacity-55" : ""}`}>
                  <td className="px-3 py-2.5 text-t2 tnum">{fmtDate(e.date)}</td>
                  <td className="px-3 py-2.5">
                    <Link href={`/dispatch-doc/${e.id}`} className="font-semibold text-primary-ink hover:underline tnum">
                      {e.dispatchNo ?? e.challan ?? `#${e.id}`}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/job-cards/${e.jobCardId}`} className="font-bold text-primary-ink hover:underline">
                      {e.siNo}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-t2">{e.item}</td>
                  <td className="px-3 py-2.5 text-t2">{e.vendor ?? "—"}</td>
                  <td className="px-3 py-2.5 text-t2">{e.reason}</td>
                  <td className={`px-3 py-2.5 text-right font-bold tnum ${dead ? "text-t3 line-through" : "text-ok"}`}>
                    +{num(e.qty)}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2.5 text-right">
                      <DispatchActions compact event={e} />
                    </td>
                  )}
                </tr>
              );
            })}
            {view.rows.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 8 : 7} className="px-3 py-10 text-center text-muted">
                  {rows.length === 0 ? "No dispatches yet." : "No dispatches match these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
