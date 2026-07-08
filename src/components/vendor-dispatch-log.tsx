"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui";
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
 * Change 16 Part D — the vendor's dispatch log, filterable by layer. Read-only.
 * (Vendor is fixed by the page; this adds the within-vendor "by layer" axis.)
 */
export function VendorDispatchLog({
  events,
  layers,
}: {
  events: VendorDispatchEvent[];
  layers: { id: number; label: string }[];
}) {
  const [layerId, setLayerId] = useState<number | "all">("all");

  const shown = useMemo(
    () => (layerId === "all" ? events : events.filter((e) => e.layerIds.includes(layerId))),
    [events, layerId]
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">Filter</span>
        <select
          value={layerId}
          onChange={(e) => setLayerId(e.target.value === "all" ? "all" : Number(e.target.value))}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] outline-none focus:border-primary"
        >
          <option value="all">All layers</option>
          {layers.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <span className="ml-auto text-[12px] text-muted">{shown.length} of {events.length}</span>
      </div>

      {shown.length === 0 ? (
        <p className="py-4 text-center text-[12px] text-muted">No dispatches{layerId !== "all" ? " for this layer" : " yet"}.</p>
      ) : (
        <div className="space-y-1.5">
          {shown.map((e) => (
            <div key={e.id} className="border-b border-slate-50 py-2 text-[12px] last:border-0">
              <div className="flex items-center justify-between">
                <span className="flex flex-wrap items-center gap-2 text-slate-500 tnum">
                  {fmtDate(e.date)}
                  <Link href={`/job-cards/${e.jobCardId}`} className="font-bold text-primary-ink hover:underline">{e.siNo}</Link>
                  <Badge tone={e.reason === "SALE" ? "warn" : e.reason === "OTHER" ? "default" : "primary"}>{e.reason}</Badge>
                  {e.layerLabels.length > 0 && <span className="text-faint">{e.layerLabels.join(" + ")}</span>}
                  {e.challan && <span className="text-faint">challan {e.challan}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-bold tnum">+{num(e.qty)}</span>
                  <Link href={`/dispatch-doc/${e.id}`} className="text-[11px] font-semibold text-primary-ink hover:underline">doc →</Link>
                </span>
              </div>
              {e.cells.length > 0 && <div className={cn("mt-0.5 text-[11px] text-faint")}>{e.cells.join(" · ")}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
