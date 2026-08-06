"use client";

/**
 * Change 39 Part E2 — the shortage table with a client-side SI filter. Typing a job-card
 * number narrows the table to trims that card is waiting on. Pure filter over the already-
 * loaded rows — no new query.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, Badge, MobileCardList } from "@/components/ui";
import { num } from "@/lib/format";
import type { PendingTrim } from "@/lib/insights";

export function PendingTrimsTable({ rows }: { rows: PendingTrim[] }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return rows;
    return rows
      .map((r) => ({ ...r, cards: r.cards.filter((c) => c.siNo.toLowerCase().includes(query)) }))
      .filter((r) => r.cards.length > 0);
  }, [rows, query]);

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by job-card / SI number…"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 t-sm outline-none focus:border-primary sm:max-w-xs"
        />
      </div>
      {filtered.length === 0 ? (
        <div className="p-8 text-center t-body text-muted">No trims short for “{q}”.</div>
      ) : (
        <>
          {/* phones: a card per short trim */}
          <MobileCardList
            className="flex flex-col gap-2 p-3 md:hidden"
            rows={filtered}
            keyOf={(r) => r.trimId}
            renderCard={(r) => (
              <div className="rounded-card bg-surface p-4 elev">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="t-body font-bold text-ink">{r.trimName}</span>
                  <Badge tone="danger">−{num(r.shortfall)}</Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 t-sm">
                  <span className="tnum">
                    req <b>{num(r.required)}</b>
                  </span>
                  <span className={`tnum ${r.inStore <= 0 ? "text-danger" : "text-t2"}`}>store {num(r.inStore)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.cards.map((c) => (
                    <Link key={c.slug} href={`/job-cards/${c.slug}`} className="rounded-md border border-border px-1.5 py-0.5 t-xs font-medium text-primary-ink active:bg-surface-2">
                      {c.siNo} <span className="text-faint">·{num(c.need)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          />

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 font-semibold">Trim</th>
                <th className="px-4 py-2.5 text-right font-semibold">Required</th>
                <th className="px-4 py-2.5 text-right font-semibold">In store</th>
                <th className="px-4 py-2.5 text-right font-semibold">Shortfall</th>
                <th className="px-4 py-2.5 font-semibold">Needed by</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.trimId} className="border-b border-hairline last:border-0 align-top">
                  <td className="px-4 py-2.5 font-semibold text-ink">{r.trimName}</td>
                  <td className="px-4 py-2.5 text-right tnum">{num(r.required)}</td>
                  <td className={`px-4 py-2.5 text-right tnum ${r.inStore <= 0 ? "text-danger" : "text-t2"}`}>{num(r.inStore)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Badge tone="danger">−{num(r.shortfall)}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {r.cards.map((c) => (
                        <Link key={c.slug} href={`/job-cards/${c.slug}`} className="rounded-md border border-border px-1.5 py-0.5 t-xs font-medium text-primary-ink hover:bg-surface-2">
                          {c.siNo} <span className="text-faint">·{num(c.need)}</span>
                        </Link>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </Card>
  );
}
