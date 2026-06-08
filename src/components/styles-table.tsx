"use client";

import { useMemo, useState } from "react";
import type { StyleOption } from "@/lib/inventory";
import { inr, num } from "@/lib/format";
import { Search } from "lucide-react";

export function StylesTable({ styles }: { styles: StyleOption[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return styles;
    return styles.filter((s) => s.styleNo.toLowerCase().includes(n) || s.itemDesc.toLowerCase().includes(n) || (s.fabricName ?? "").toLowerCase().includes(n));
  }, [q, styles]);

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <div className="relative w-72">
          <Search size={14} className="absolute left-3 top-2.5 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search style, item, fabric…"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-[12px] outline-none focus:border-primary focus:ring-2 focus:ring-indigo-100"
          />
        </div>
      </div>
      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-semibold">Style No</th>
              <th className="px-4 py-2.5 font-semibold">Item</th>
              <th className="px-4 py-2.5 text-right font-semibold">MRP</th>
              <th className="px-4 py-2.5 font-semibold">Fabric</th>
              <th className="px-4 py-2.5 text-right font-semibold">Avg / pc</th>
              <th className="px-4 py-2.5 text-right font-semibold">Fabric Stock</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td className="px-4 py-2.5 font-bold text-primary-ink">{s.styleNo}</td>
                <td className="px-4 py-2.5 font-medium">{s.itemDesc}</td>
                <td className="px-4 py-2.5 text-right tnum">{inr(s.mrp)}</td>
                <td className="px-4 py-2.5 text-slate-500">{s.fabricName ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tnum">{s.avgConsumption ? `${s.avgConsumption} ${s.unit.toLowerCase()}` : "—"}</td>
                <td className="px-4 py-2.5 text-right tnum">{s.fabricAvailable != null ? num(s.fabricAvailable) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-faint">{shown.length} of {styles.length} styles · the single source autofilled into every job card</p>
    </div>
  );
}
