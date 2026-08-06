"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { TrimStock } from "@/lib/trims";
import { Badge, MobileCardList } from "@/components/ui";
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
            className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 t-sm outline-none focus:border-primary focus:ring-2 focus:ring-accent/15"
          />
        </div>
        <select
          value={fam}
          onChange={(e) => setFam(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 t-sm outline-none focus:border-primary focus:ring-2 focus:ring-accent/15"
        >
          <option value="ALL">All families</option>
          {families.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {/* phones: a card per trim */}
      <MobileCardList
        className="md:hidden"
        rows={shown.slice(0, 400)}
        keyOf={(s) => s.id}
        empty={<p className="px-2 py-10 text-center t-sm text-muted">{rows.length === 0 ? "No trims" : "No trims match your search"}</p>}
        renderCard={(s) => {
          const w = Math.min(100, Math.max(0, s.usedPct * 100));
          return (
            <div className="rounded-card bg-surface p-4 elev">
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/trims/${s.id}`} className="t-body font-bold text-primary-ink">
                  {s.name}
                  {s.family && <span className="ml-1.5 t-micro font-normal text-faint">{s.family}</span>}
                </Link>
                {s.status === "short" ? <Badge tone="danger">Indent</Badge> : s.status === "low" ? <Badge tone="warn">Low</Badge> : <Badge tone="ok">OK</Badge>}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className={`h-full rounded-full ${s.status === "short" ? "bg-danger" : s.status === "low" ? "bg-warn" : "bg-primary"}`} style={{ width: `${w}%` }} />
                </div>
                <span className="tnum t-xs font-semibold">{pct(s.usedPct)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 t-sm">
                <span className={`tnum ${s.current <= 0 ? "font-semibold text-danger" : ""}`}>
                  <b>{num(s.current)}</b> current
                </span>
                <span className="tnum text-t3">opening {num(s.opening)}</span>
              </div>
            </div>
          );
        }}
      />

      <div className="hidden overflow-hidden rounded-card border border-border bg-surface md:block">
        <div className="overflow-x-auto">
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
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
                  <tr key={s.id} className="border-b border-hairline last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/trims/${s.id}`} className="font-semibold text-primary-ink hover:underline">
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-t2">{s.family ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right text-t2 tnum">{num(s.opening)}</td>
                    <td className={`px-4 py-2.5 text-right font-bold tnum ${s.current <= 0 ? "text-danger" : ""}`}>{num(s.current)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className={`h-full rounded-full ${s.status === "short" ? "bg-danger" : s.status === "low" ? "bg-warn" : "bg-primary"}`}
                            style={{ width: `${w}%` }}
                          />
                        </div>
                        <span className="tnum t-xs font-semibold">{pct(s.usedPct)}</span>
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
      </div>
      <p className="mt-2 t-xs text-faint">
        {Math.min(shown.length, 400)} of {shown.length} shown
      </p>
    </div>
  );
}
