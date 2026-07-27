"use client";

import { useMemo, useState } from "react";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { num } from "@/lib/format";
import { Download } from "lucide-react";
import type { DispatchRow } from "@/components/dispatch-log";

/**
 * Change 21 Part C.1 — the ERP hand-off, from the dispatch screen.
 *
 * Pick a day (defaults to today), see the count that will be exported, download
 * the CSV. The preview is computed from the same rows the log below renders, so
 * what the staffer sees is what the file contains — the point is to be able to
 * reconcile the file against the day before importing it.
 */

const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function FinishedGoodsExport({ rows }: { rows: DispatchRow[] }) {
  const [from, setFrom] = useState(todayStr);
  const [to, setTo] = useState(todayStr);
  const [reason, setReason] = useState("ORDER");
  const [group, setGroup] = useState(false);

  // Mirrors the route's filter exactly: inclusive range, reason, voided excluded.
  const preview = useMemo(() => {
    const lo = new Date(`${from}T00:00:00`).getTime();
    const hi = new Date(`${to}T23:59:59.999`).getTime();
    const hit = rows.filter((r) => {
      if (r.voidedAt) return false;
      if (reason !== "ALL" && r.reason !== reason) return false;
      const t = new Date(r.date).getTime();
      return t >= lo && t <= hi;
    });
    return {
      lines: hit.reduce((a, r) => a + (r.lines.length || 1), 0),
      pcs: hit.reduce((a, r) => a + r.qty, 0),
      docs: hit.length,
    };
  }, [rows, from, to, reason]);

  const href =
    `/export/finished-goods?from=${from}&to=${to}&reason=${reason}` + (group ? "&group=daily" : "");

  return (
    <Card className="p-5">
      <h3 className="t-body font-bold">Export finished goods (ERP)</h3>
      <p className="mt-0.5 t-xs text-t3">
        One row per dispatched size × colour cell. Read-only — downloading changes nothing here.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      <Field label="Reason" className="mt-3" hint="Finished goods to the warehouse are ORDER.">
        <Select value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="ORDER">ORDER only</option>
          <option value="SALE">SALE only</option>
          <option value="OTHER">OTHER only</option>
          <option value="ALL">Everything</option>
        </Select>
      </Field>

      <label className="mt-3 flex items-center gap-2 t-sm">
        <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} className="size-4 accent-accent" />
        <span className="text-t2">Pre-sum by day × SKU × colour × size</span>
      </label>

      <div className="mt-3 flex items-baseline justify-between rounded-lg bg-surface-2 px-3 py-2.5 t-sm">
        <span className="text-t2">In this range</span>
        <span className="font-bold tnum">
          {num(preview.lines)} line{preview.lines === 1 ? "" : "s"} · {num(preview.pcs)} pcs
        </span>
      </div>
      <p className="mt-1 t-xs text-t3">
        {preview.docs} dispatch document{preview.docs === 1 ? "" : "s"}. Check this against the day before importing.
      </p>

      <Button
        variant="primary"
        className="mt-3 w-full"
        disabled={preview.lines === 0}
        onClick={() => {
          window.location.href = href;
        }}
      >
        <Download size={14} /> Download CSV
      </Button>
    </Card>
  );
}
