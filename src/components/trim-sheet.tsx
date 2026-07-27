"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordTrimIssue } from "@/lib/actions";
import { Card, Badge } from "@/components/ui";
import { num, fmtDate } from "@/lib/format";
import { Check } from "lucide-react";

export type TrimSheetLine = {
  id: number;
  material: string;
  color: string | null;
  dimension: string;
  requiredQty: number | null;
  issuedQty: number | null;
  arrangedBy: string | null;
  issueDate: string | null;
  challan: string | null;
  trimName: string | null;
  trimCurrent: number | null;
  // Change 19 A.4: trims that have actually left the store, from the OUTWARD challan
  // ledger. `issuedFromChallans` = locked (posted to stock); `pendingFromDrafts` = drafted
  // but not yet issued. Optional so free-text lines (no trim master) keep the legacy path.
  trimItemId?: number | null;
  issuedFromChallans?: number;
  pendingFromDrafts?: number;
};

const DIM_LABEL: Record<string, string> = { COLOR: "colour", SIZE: "size", FLAT: "flat" };

export function TrimSheet({
  lines,
  canEdit,
  defaultArrangedBy,
}: {
  lines: TrimSheetLine[];
  canEdit: boolean;
  defaultArrangedBy: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const [issued, setIssued] = useState("");
  const [by, setBy] = useState(defaultArrangedBy);
  const [challan, setChallan] = useState("");
  const [saving, setSaving] = useState(false);

  function open(l: TrimSheetLine) {
    setEditing(l.id);
    setIssued(l.issuedQty != null ? String(l.issuedQty) : l.requiredQty != null ? String(l.requiredQty) : "");
    setBy(l.arrangedBy || defaultArrangedBy);
    setChallan(l.challan || "");
  }
  async function save(id: number) {
    setSaving(true);
    try {
      await recordTrimIssue({ jobBomLineId: id, issuedQty: +issued || 0, arrangedBy: by || null, challan: challan || null });
      setEditing(null);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-3.5 overflow-hidden p-0">
      <div className="border-b border-border px-5 py-3 t-body font-bold">
        Trim Sheet <span className="font-medium text-faint">· required vs issued</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full t-sm">
          <thead>
            <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-semibold">Material</th>
              <th className="px-3 py-2.5 font-semibold">Applies to</th>
              <th className="px-3 py-2.5 font-semibold">Colour</th>
              <th className="px-3 py-2.5 text-right font-semibold">Required</th>
              <th className="px-3 py-2.5 text-right font-semibold">Issued</th>
              <th className="px-3 py-2.5 text-right font-semibold">Balance</th>
              <th className="px-3 py-2.5 font-semibold">Pending issue</th>
              <th className="px-3 py-2.5 font-semibold">Arranged by</th>
              <th className="px-3 py-2.5 text-right font-semibold">In store</th>
              {canEdit && <th className="px-3 py-2.5"></th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const required = l.requiredQty ?? 0;
              // Tracked trims read the locked challan ledger; free-text lines keep the
              // legacy hand-entered number (they never had stock to move).
              const tracked = l.trimItemId != null;
              const issuedV = tracked ? l.issuedFromChallans ?? 0 : l.issuedQty ?? 0;
              const pending = l.pendingFromDrafts ?? 0;
              // Balance may go negative — over-issuing is real and must be visible.
              const balance = Math.round((required - issuedV) * 100) / 100;
              const logged = l.issuedQty ?? 0;
              const divergent = tracked && logged > 0 && Math.abs(logged - issuedV) > 0.005;
              const short = l.trimCurrent != null && required > l.trimCurrent && balance > 0;
              const isEditing = editing === l.id;
              return (
                <tr key={l.id} className="border-b border-hairline last:border-0 align-top">
                  <td className="px-4 py-2 font-medium">{l.trimName ?? l.material}</td>
                  <td className="px-3 py-2 text-faint">{DIM_LABEL[l.dimension] ?? "flat"}</td>
                  <td className="px-3 py-2 text-t2">{l.color || "—"}</td>
                  <td className="px-3 py-2 text-right tnum font-semibold">{num(required)}</td>
                  <td className="px-3 py-2 text-right tnum">
                    {isEditing ? (
                      <input type="number" value={issued} onChange={(e) => setIssued(e.target.value)} className="w-20 rounded-md border border-border px-2 py-1 text-right t-sm tnum outline-none focus:border-primary" />
                    ) : (
                      <span>
                        {num(issuedV)}
                        {divergent && <span className="ml-1 block t-micro text-faint">logged: {num(logged)}</span>}
                      </span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right tnum font-bold ${balance < 0 ? "text-danger" : balance > 0 ? "text-warn" : "text-ok"}`}>{num(balance)}</td>
                  <td className="px-3 py-2">
                    {pending > 0 ? <Badge tone="warn">{num(pending)} drafted</Badge> : <span className="text-faint">—</span>}
                  </td>
                  <td className="px-3 py-2 text-t2">
                    {isEditing ? (
                      <div className="flex flex-col gap-1">
                        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="arranged by" className="w-28 rounded-md border border-border px-2 py-1 t-xs outline-none focus:border-primary" />
                        <input value={challan} onChange={(e) => setChallan(e.target.value)} placeholder="challan #" className="w-28 rounded-md border border-border px-2 py-1 t-xs outline-none focus:border-primary" />
                      </div>
                    ) : (
                      <span>
                        {l.arrangedBy || "—"}
                        {l.issueDate && <span className="ml-1 t-micro text-faint">{fmtDate(l.issueDate)}</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {l.trimCurrent != null ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`tnum ${short ? "text-danger font-semibold" : "text-t2"}`}>{num(l.trimCurrent)}</span>
                        {short && <Badge tone="danger">Short</Badge>}
                      </span>
                    ) : (
                      <span className="t-xs text-faint">untracked</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <button onClick={() => save(l.id)} disabled={saving} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 t-xs font-semibold text-accent-on disabled:opacity-40"><Check size={12} /> Save</button>
                          <button onClick={() => setEditing(null)} className="rounded-md border border-border px-2 py-1 t-xs text-t2">×</button>
                        </div>
                      ) : (
                        <button onClick={() => open(l)} className="rounded-md border border-border px-2 py-1 t-xs font-semibold text-t1 hover:bg-surface-2">Issue</button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
