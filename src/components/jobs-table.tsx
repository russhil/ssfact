"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Bar } from "@/components/ui";
import { num, pct, fmtDate } from "@/lib/format";
import type { JobRow } from "@/lib/jobs";
import { Search } from "lucide-react";

type Filter = "all" | "active" | "overdue" | "closed";

const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "overdue", label: "Overdue" },
  { key: "closed", label: "Closed" },
];

export function JobsTable({ rows }: { rows: JobRow[] }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<Filter>("all");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (f === "active" && r.status !== "ACTIVE") return false;
      if (f === "closed" && r.status !== "CLOSED") return false;
      if (f === "overdue" && !r.overdue) return false;
      if (!needle) return true;
      return (
        r.siNo.toLowerCase().includes(needle) ||
        r.item.toLowerCase().includes(needle) ||
        r.styleNo.toLowerCase().includes(needle) ||
        r.vendor.toLowerCase().includes(needle)
      );
    });
  }, [rows, q, f]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      active: rows.filter((r) => r.status === "ACTIVE").length,
      overdue: rows.filter((r) => r.overdue).length,
      closed: rows.filter((r) => r.status === "CLOSED").length,
    }),
    [rows]
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {filters.map((x) => (
            <button
              key={x.key}
              onClick={() => setF(x.key)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
                f === x.key ? "bg-primary text-white" : "bg-surface text-slate-500 hover:bg-slate-50 border border-border"
              }`}
            >
              {x.label} <span className="opacity-60">{counts[x.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-2.5 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search SI, style, vendor…"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-[12px] outline-none focus:border-primary focus:ring-2 focus:ring-indigo-100"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-semibold">SI</th>
              <th className="px-4 py-2.5 font-semibold">Item</th>
              <th className="px-4 py-2.5 font-semibold">Vendor</th>
              <th className="px-4 py-2.5 text-right font-semibold">Cut</th>
              <th className="px-4 py-2.5 text-right font-semibold">Recd.</th>
              <th className="px-4 py-2.5 font-semibold">Fill</th>
              <th className="px-4 py-2.5 font-semibold">ETD</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.siNo}-${r.styleNo}-${i}`} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td className="px-4 py-2.5">
                  <Link href={`/job-cards/${r.slug}`} className="font-bold text-primary-ink hover:underline">
                    {r.siNo}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{r.item}</div>
                  <div className="text-[11px] text-faint">{r.styleNo}</div>
                </td>
                <td className="px-4 py-2.5 text-slate-500">{r.vendor}</td>
                <td className="px-4 py-2.5 text-right tnum">{num(r.cutQty)}</td>
                <td className="px-4 py-2.5 text-right tnum">{num(r.dispatchedQty)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-16">
                      <Bar value={r.fill} tone={r.fill < 0.65 ? "warn" : "primary"} />
                    </div>
                    <span className="tnum text-[11px] font-semibold">{pct(r.fill)}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-slate-500 tnum">{fmtDate(r.plannedEtd)}</td>
                <td className="px-4 py-2.5">
                  {r.overdue ? (
                    <Badge tone="danger">Overdue</Badge>
                  ) : r.status === "CLOSED" ? (
                    <Badge tone="ok">Closed</Badge>
                  ) : (
                    <Badge tone="primary">Active</Badge>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  No job cards match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-faint">{shown.length} of {rows.length} job cards</p>
    </div>
  );
}
