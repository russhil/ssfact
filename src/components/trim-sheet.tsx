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
      <div className="border-b border-border px-5 py-3 text-[13px] font-bold">
        Trim Sheet <span className="font-medium text-faint">· required vs issued · frozen at job creation</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-semibold">Material</th>
              <th className="px-3 py-2.5 font-semibold">Applies to</th>
              <th className="px-3 py-2.5 font-semibold">Colour</th>
              <th className="px-3 py-2.5 text-right font-semibold">Required</th>
              <th className="px-3 py-2.5 text-right font-semibold">Issued</th>
              <th className="px-3 py-2.5 text-right font-semibold">Balance</th>
              <th className="px-3 py-2.5 font-semibold">Arranged by</th>
              <th className="px-3 py-2.5 text-right font-semibold">In store</th>
              {canEdit && <th className="px-3 py-2.5"></th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const required = l.requiredQty ?? 0;
              const issuedV = l.issuedQty ?? 0;
              const balance = required - issuedV;
              const short = l.trimCurrent != null && required > l.trimCurrent && balance > 0;
              const isEditing = editing === l.id;
              return (
                <tr key={l.id} className="border-b border-slate-50 last:border-0 align-top">
                  <td className="px-4 py-2 font-medium">{l.trimName ?? l.material}</td>
                  <td className="px-3 py-2 text-faint">{DIM_LABEL[l.dimension] ?? "flat"}</td>
                  <td className="px-3 py-2 text-slate-500">{l.color || "—"}</td>
                  <td className="px-3 py-2 text-right tnum font-semibold">{num(required)}</td>
                  <td className="px-3 py-2 text-right tnum">
                    {isEditing ? (
                      <input type="number" value={issued} onChange={(e) => setIssued(e.target.value)} className="w-20 rounded-md border border-border px-2 py-1 text-right text-[12px] tnum outline-none focus:border-primary" />
                    ) : (
                      num(issuedV)
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right tnum font-bold ${balance > 0 ? "text-amber-600" : "text-emerald-600"}`}>{num(balance)}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {isEditing ? (
                      <div className="flex flex-col gap-1">
                        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="arranged by" className="w-28 rounded-md border border-border px-2 py-1 text-[11px] outline-none focus:border-primary" />
                        <input value={challan} onChange={(e) => setChallan(e.target.value)} placeholder="challan #" className="w-28 rounded-md border border-border px-2 py-1 text-[11px] outline-none focus:border-primary" />
                      </div>
                    ) : (
                      <span>
                        {l.arrangedBy || "—"}
                        {l.issueDate && <span className="ml-1 text-[10px] text-faint">{fmtDate(l.issueDate)}</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {l.trimCurrent != null ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`tnum ${short ? "text-danger font-semibold" : "text-slate-500"}`}>{num(l.trimCurrent)}</span>
                        {short && <Badge tone="danger">Short</Badge>}
                      </span>
                    ) : (
                      <span className="text-[11px] text-faint">untracked</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <button onClick={() => save(l.id)} disabled={saving} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"><Check size={12} /> Save</button>
                          <button onClick={() => setEditing(null)} className="rounded-md border border-border px-2 py-1 text-[11px] text-slate-500">×</button>
                        </div>
                      ) : (
                        <button onClick={() => open(l)} className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">Issue</button>
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
