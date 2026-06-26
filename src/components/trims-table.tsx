"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { TrimStock } from "@/lib/trims";
import { Badge } from "@/components/ui";
import { num, pct } from "@/lib/format";

export function TrimsTable({ rows, families }: { rows: TrimStock[]; families: string[] }) {
  const [q, setQ] = useState("");
  const [fam, setFam] = useState("ALL");

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (fam !== "ALL" && (r.family ?? "—") !== fam) return false;
      if (!n) return true;
      return r.name.toLowerCase().includes(n) || (r.family ?? "").toLowerCase().includes(n);
    });
  }, [q, fam, rows]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search size={14} className="absolute left-3 top-2.5 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search trim, family…"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-[12px] outline-none focus:border-primary focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <select
          value={fam}
          onChange={(e) => setFam(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] outline-none focus:border-primary focus:ring-2 focus:ring-indigo-100"
        >
          <option value="ALL">All families</option>
          {families.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-semibold">Trim Item</th>
              <th className="px-4 py-2.5 font-semibold">Family</th>
              <th className="px-4 py-2.5 text-right font-semibold">Opening</th>
              <th className="px-4 py-2.5 text-right font-semibold">Current</th>
              <th className="px-4 py-2.5 font-semibold">Utilisation</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 400).map((s) => {
              const w = Math.min(100, Math.max(0, s.usedPct * 100));
              return (
                <tr key={s.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-2.5">
                    <Link href={`/trims/${s.id}`} className="font-semibold text-primary-ink hover:underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{s.family ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500 tnum">{num(s.opening)}</td>
                  <td className={`px-4 py-2.5 text-right font-bold tnum ${s.current <= 0 ? "text-danger" : ""}`}>{num(s.current)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${s.status === "short" ? "bg-rose-500" : s.status === "low" ? "bg-amber-400" : "bg-primary"}`}
                          style={{ width: `${w}%` }}
                        />
                      </div>
                      <span className="tnum text-[11px] font-semibold">{pct(s.usedPct)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {s.status === "short" ? <Badge tone="danger">Indent</Badge> : s.status === "low" ? <Badge tone="warn">Low</Badge> : <Badge tone="ok">OK</Badge>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-faint">
        {Math.min(shown.length, 400)} of {shown.length} shown{shown.length > 400 ? " · refine your search to see more" : ""} · trims/accessories store
      </p>
    </div>
  );
}
