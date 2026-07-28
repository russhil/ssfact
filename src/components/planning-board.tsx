"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Badge, Bar, Input, Button } from "@/components/ui";
import { runAction } from "@/lib/action-result";
import { setVendorCapacity } from "@/lib/actions";
import { num, fmtDate } from "@/lib/format";
import type { VendorLoad } from "@/lib/capacity";

/**
 * Change 36 Part 4 — per-vendor load, and the one entered number that makes it a
 * projection rather than a pile.
 *
 * A vendor with no capacity set shows their backlog and says "not set" — it never
 * guesses a days-to-clear, because a made-up projection is worse than none.
 */
export function PlanningBoard({ rows }: { rows: VendorLoad[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Record<number, string>>({});
  const maxOpen = Math.max(1, ...rows.map((r) => Math.max(0, r.openPcs)));

  return (
    <Card className="mt-3.5 overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] t-sm">
          <thead>
            <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
              <th className="px-5 py-2.5 font-semibold">Vendor</th>
              <th className="px-5 py-2.5 font-semibold">Load</th>
              <th className="px-5 py-2.5 text-right font-semibold">Open</th>
              <th className="px-5 py-2.5 text-right font-semibold">Cards</th>
              <th className="px-5 py-2.5 text-right font-semibold">Pcs / day</th>
              <th className="px-5 py-2.5 text-right font-semibold">Days to clear</th>
              <th className="px-5 py-2.5 font-semibold">Nearest ETD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const draft = edit[r.vendorId ?? -1];
              const dirty = draft != null && draft !== (r.capacityPcs != null ? String(r.capacityPcs) : "");
              return (
                <tr key={r.vendor} className="border-b border-hairline last:border-0">
                  <td className="px-5 py-2">
                    <Link href={`/vendors/${encodeURIComponent(r.vendor)}`} className="font-semibold text-primary-ink hover:underline">
                      {r.vendor}
                    </Link>
                    {r.overCommitted && <Badge tone="danger" className="ml-1.5">Over-committed</Badge>}
                    {r.capacityNote && <div className="t-micro text-faint">{r.capacityNote}</div>}
                  </td>
                  <td className="px-5 py-2 w-40">
                    {/* Bar takes a 0–1 fraction; scale each vendor against the busiest one. */}
                    <Bar value={Math.max(0, r.openPcs) / maxOpen} tone={r.overCommitted ? "danger" : "primary"} />
                  </td>
                  <td className={`px-5 py-2 text-right tnum ${r.openPcs < 0 ? "text-ok" : ""}`}>{num(r.openPcs)}</td>
                  <td className="px-5 py-2 text-right tnum text-t2">{num(r.cards)}</td>
                  <td className="px-5 py-2 text-right">
                    <span className="inline-flex items-center gap-1">
                      <Input
                        type="number"
                        value={draft ?? (r.capacityPcs != null ? String(r.capacityPcs) : "")}
                        placeholder="—"
                        onChange={(e) => setEdit((p) => ({ ...p, [r.vendorId ?? -1]: e.target.value }))}
                        className="w-20 text-right tnum"
                      />
                      {dirty && r.vendorId != null && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            const ok = await runAction(() =>
                              setVendorCapacity({ id: r.vendorId!, dailyCapacityPcs: draft.trim() === "" ? null : Number(draft) })
                            );
                            setBusy(false);
                            if (ok) router.refresh();
                          }}
                        >
                          Save
                        </Button>
                      )}
                    </span>
                  </td>
                  <td className="px-5 py-2 text-right tnum">
                    {r.daysToClear == null ? <span className="text-faint">—</span> : `${num(r.daysToClear)} d`}
                  </td>
                  <td className="px-5 py-2">
                    {r.nearestEtd ? (
                      <span className={r.daysToEtd != null && r.daysToEtd < 0 ? "text-danger" : "text-t2"}>
                        {fmtDate(r.nearestEtd)}
                        {r.daysToEtd != null && <span className="ml-1 t-xs">({r.daysToEtd}d)</span>}
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
