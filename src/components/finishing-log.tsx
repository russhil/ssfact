"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge, Card, SortHeader, TableToolbar, useTableView, type FilterDef } from "@/components/ui";
import { num, fmtDate } from "@/lib/format";

/**
 * Change 20 Part C.2/C.3 — the finishing job-work log.
 *
 * The owner's headline ask, verbatim: "we can also do that in terms of a challan,
 * with a different series, so that we can keep track of all the job works given to
 * that vendor, and have all their bills or quantities sorted."
 *
 * Used twice: on a vendor page (that vendor's job-work across every card) and on
 * the top-level /finishing index (everything, filterable by vendor too). Read-only
 * — issuing and receiving happen on the job card.
 */

export type FinishingLogRow = {
  id: number;
  docNo: string | null;
  process: string;
  status: string;
  vendor: string;
  siNo: string;
  jobCardId: number;
  issuedDate: string;
  receivedDate: string | null;
  qtyOut: number;
  qtyBack: number;
  rate: number | null;
  billNo: string | null;
};

const PROCESSES = ["PRINT", "EMBROIDERY", "WASH", "SUBLIMATION", "LASER", "OTHER"];

export function FinishingLog({
  rows,
  canSeeCost,
  showVendor = true,
  id = "jw",
  title = "Finishing job-work",
  subtitle,
}: {
  rows: FinishingLogRow[];
  canSeeCost: boolean;
  /** false on a vendor page, where the vendor is fixed. */
  showVendor?: boolean;
  id?: string;
  title?: string;
  subtitle?: string;
}) {
  const vendors = useMemo(() => [...new Set(rows.map((r) => r.vendor))].sort(), [rows]);

  const filters: FilterDef<FinishingLogRow>[] = useMemo(() => {
    const f: FilterDef<FinishingLogRow>[] = [
      {
        key: "process",
        label: "processes",
        options: PROCESSES.map((p) => ({ value: p, label: p })),
        match: (r, v) => r.process === v,
      },
      {
        key: "status",
        label: "statuses",
        options: [
          { value: "OPEN", label: "Open (still out)" },
          { value: "CLOSED", label: "Closed" },
        ],
        match: (r, v) => r.status === v,
      },
    ];
    if (showVendor) {
      f.unshift({
        key: "vendor",
        label: "vendors",
        options: vendors.map((v) => ({ value: v, label: v })),
        match: (r, v) => r.vendor === v,
      });
    }
    return f;
  }, [vendors, showVendor]);

  const view = useTableView<FinishingLogRow>({
    id,
    rows,
    filters,
    search: (r) => [r.docNo, r.siNo, r.vendor, r.billNo, r.process],
    date: (r) => r.issuedDate,
    sorts: {
      date: (r) => new Date(r.issuedDate),
      no: (r) => r.docNo ?? "",
      si: (r) => r.siNo,
      vendor: (r) => r.vendor,
      out: (r) => r.qtyOut,
      back: (r) => r.qtyBack,
      balance: (r) => r.qtyOut - r.qtyBack,
    },
    defaultSort: { key: "date", dir: "desc" },
    sum: (r) => r.qtyOut,
  });

  const totalBack = view.rows.reduce((a, r) => a + r.qtyBack, 0);

  return (
    <Card className="mt-3.5 p-5">
      <h3 className="mb-3 t-body font-bold">
        {title} {subtitle && <span className="font-medium text-faint">· {subtitle}</span>}
      </h3>
      <TableToolbar
        view={view}
        filters={filters}
        searchPlaceholder="Search JW no, SI, bill…"
        dateLabel="Issued"
        unit="out"
      />
      {view.rows.length === 0 ? (
        <p className="py-6 text-center t-sm text-muted">
          {rows.length === 0 ? "No finishing job-work recorded." : "Nothing matches these filters."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-micro uppercase tracking-wide text-faint">
                <th className="px-2 py-2"><SortHeader view={view} sortKey="date">Issued</SortHeader></th>
                <th className="px-2 py-2"><SortHeader view={view} sortKey="no">JW no</SortHeader></th>
                <th className="px-2 py-2"><SortHeader view={view} sortKey="si">SI</SortHeader></th>
                {showVendor && <th className="px-2 py-2"><SortHeader view={view} sortKey="vendor">Vendor</SortHeader></th>}
                <th className="px-2 py-2 font-semibold">Process</th>
                <th className="px-2 py-2 text-right"><SortHeader view={view} sortKey="out" align="right">Out</SortHeader></th>
                <th className="px-2 py-2 text-right"><SortHeader view={view} sortKey="back" align="right">Back</SortHeader></th>
                <th className="px-2 py-2 text-right"><SortHeader view={view} sortKey="balance" align="right">Balance</SortHeader></th>
                <th className="px-2 py-2 font-semibold">Bill</th>
                {canSeeCost && <th className="px-2 py-2 text-right font-semibold">Rate</th>}
                {canSeeCost && <th className="px-2 py-2 text-right font-semibold">Value</th>}
                <th className="px-2 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => {
                const bal = Math.round((r.qtyOut - r.qtyBack) * 100) / 100;
                return (
                  <tr key={r.id} className="border-b border-hairline last:border-0">
                    <td className="px-2 py-2 text-t2 tnum">{fmtDate(r.issuedDate)}</td>
                    <td className="px-2 py-2 font-semibold text-primary-ink tnum">{r.docNo ?? `#${r.id}`}</td>
                    <td className="px-2 py-2">
                      <Link href={`/job-cards/${r.jobCardId}`} className="font-bold text-primary-ink hover:underline">
                        {r.siNo}
                      </Link>
                    </td>
                    {showVendor && <td className="px-2 py-2">{r.vendor}</td>}
                    <td className="px-2 py-2 text-t2">{r.process}</td>
                    <td className="px-2 py-2 text-right font-semibold tnum">{num(r.qtyOut)}</td>
                    <td className="px-2 py-2 text-right tnum">{num(r.qtyBack)}</td>
                    <td className={`px-2 py-2 text-right font-bold tnum ${bal < 0 ? "text-ok" : bal > 0 ? "text-warn" : ""}`}>
                      {num(bal)}
                    </td>
                    <td className="px-2 py-2 text-t2">{r.billNo ?? "—"}</td>
                    {canSeeCost && <td className="px-2 py-2 text-right text-t2 tnum">{r.rate != null ? `₹${num(r.rate, 2)}` : "—"}</td>}
                    {canSeeCost && (
                      <td className="px-2 py-2 text-right font-semibold tnum">
                        {/* what the vendor bills for: rate × pieces actually returned */}
                        {r.rate != null ? `₹${num(Math.round(r.rate * r.qtyBack))}` : "—"}
                      </td>
                    )}
                    <td className="px-2 py-2">
                      <Badge tone={r.status === "CLOSED" ? "ok" : "warn"}>{r.status}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 t-xs text-faint">
            {num(view.rows.reduce((a, r) => a + r.qtyOut, 0))} out · {num(totalBack)} back ·{" "}
            {num(Math.round((view.rows.reduce((a, r) => a + r.qtyOut, 0) - totalBack) * 100) / 100)} still with the vendor
          </p>
        </div>
      )}
    </Card>
  );
}
