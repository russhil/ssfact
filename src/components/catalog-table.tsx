"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { ProductRow } from "@/lib/catalog";
import { STATUS_LABEL, statusTone } from "@/lib/catalog-labels";
import { Badge } from "@/components/ui";
import { inr } from "@/lib/format";

export function CatalogTable({ rows, categories }: { rows: ProductRow[]; categories: string[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [cat, setCat] = useState("ALL");

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "ALL" && r.status !== status) return false;
      if (cat !== "ALL" && (r.headCategory ?? "Uncategorised") !== cat) return false;
      if (!n) return true;
      return (
        r.skuCode.toLowerCase().includes(n) ||
        r.name.toLowerCase().includes(n) ||
        (r.headCategory ?? "").toLowerCase().includes(n) ||
        (r.styleGroup ?? "").toLowerCase().includes(n)
      );
    });
  }, [q, status, cat, rows]);

  const selectCls =
    "rounded-lg border border-border bg-surface px-3 py-2 text-[12px] outline-none focus:border-primary focus:ring-2 focus:ring-indigo-100";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search size={14} className="absolute left-3 top-2.5 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search SKU, name, category…"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-[12px] outline-none focus:border-primary focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
          <option value="ALL">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={selectCls}>
          <option value="ALL">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-semibold">SKU</th>
              <th className="px-4 py-2.5 font-semibold">Product</th>
              <th className="px-4 py-2.5 font-semibold">Category</th>
              <th className="px-4 py-2.5 text-right font-semibold">MRP</th>
              <th className="px-4 py-2.5 text-right font-semibold">Wholesale</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Links</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.extId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td className="px-4 py-2.5">
                  <Link href={`/catalog/${encodeURIComponent(r.skuCode)}`} className="font-bold text-primary-ink hover:underline">
                    {r.skuCode}
                  </Link>
                </td>
                <td className="px-4 py-2.5 font-medium">{r.name}</td>
                <td className="px-4 py-2.5 text-slate-500">{r.headCategory ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tnum">{inr(r.mrp)}</td>
                <td className="px-4 py-2.5 text-right tnum text-slate-500">{inr(r.wholesale)}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={statusTone(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1">
                    {r.hasBom && <Badge tone="primary">BOM</Badge>}
                    {r.inProduction && <Badge tone="ok">In production</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-faint">
        {shown.length} of {rows.length} SKUs · the commercial product master
      </p>
    </div>
  );
}
