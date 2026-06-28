"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordFabricActuals } from "@/lib/actions";
import { num } from "@/lib/format";
import { Check } from "lucide-react";

export type ActualsLine = {
  color: string;
  estAvg: number | null;
  actualAvg: number | null;
  gsm: number | null;
  rollWidth: number | null;
  qtyIssued: number;
  qtyUsed: number;
  returned: number;
  locked: boolean;
};

type Draft = { avg: string; issued: string; used: string };

export function FabricActualsForm({
  jobCardId,
  unit,
  lines,
}: {
  jobCardId: number;
  unit: string;
  lines: ActualsLine[];
}) {
  const router = useRouter();
  const u = unit.toLowerCase();
  const [drafts, setDrafts] = useState<Draft[]>(
    lines.map((l) => ({
      avg: l.actualAvg != null ? String(l.actualAvg) : l.estAvg != null ? String(l.estAvg) : "",
      issued: l.qtyIssued ? String(l.qtyIssued) : "",
      used: l.qtyUsed ? String(l.qtyUsed) : "",
    }))
  );
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const set = (i: number, k: keyof Draft, v: string) =>
    setDrafts((p) => p.map((d, idx) => (idx === i ? { ...d, [k]: v } : d)));

  const previewReturn = drafts.reduce((a, d) => a + Math.max(0, (+d.issued || 0) - (+d.used || 0)), 0);
  const anyLocked = lines.some((l) => l.locked);

  async function submit() {
    setSaving(true);
    try {
      const r = await recordFabricActuals({
        jobCardId,
        lines: lines.map((l, i) => ({
          color: l.color,
          actualAvg: drafts[i].avg ? +drafts[i].avg : null,
          qtyIssued: +drafts[i].issued || 0,
          qtyUsed: +drafts[i].used || 0,
          gsm: l.gsm,
          rollWidth: l.rollWidth,
        })),
      });
      setDone(r.returnQty > 0 ? `Saved · ${num(r.returnQty)} ${u} returned to stock` : "Saved");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
        Record actuals {lines.length > 1 ? "· per colour" : ""}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-faint">
              <th className="px-2 py-1 font-semibold">Colour</th>
              <th className="px-2 py-1 text-right font-semibold">Actual avg</th>
              <th className="px-2 py-1 text-right font-semibold">Issued ({u})</th>
              <th className="px-2 py-1 text-right font-semibold">Used ({u})</th>
              <th className="px-2 py-1 text-right font-semibold">Return</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const ret = Math.max(0, (+drafts[i].issued || 0) - (+drafts[i].used || 0));
              return (
                <tr key={l.color || i} className="border-t border-slate-50">
                  <td className="px-2 py-1 font-semibold text-slate-600">{l.color || "—"}</td>
                  <td className="px-1 py-1">
                    <Cell value={drafts[i].avg} step="0.001" onChange={(v) => set(i, "avg", v)} />
                  </td>
                  <td className="px-1 py-1">
                    <Cell value={drafts[i].issued} onChange={(v) => set(i, "issued", v)} />
                  </td>
                  <td className="px-1 py-1">
                    <Cell value={drafts[i].used} onChange={(v) => set(i, "used", v)} />
                  </td>
                  <td className="px-2 py-1 text-right tnum text-emerald-600">
                    {l.locked ? <span className="text-faint">locked</span> : ret > 0 ? num(ret) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-[12px] text-muted">
          Return to stock: <b className="text-emerald-600 tnum">{num(previewReturn)} {u}</b>
          {anyLocked && <span className="ml-2 text-[11px] text-faint">(some colours already returned — re-saving won&apos;t double-count)</span>}
        </span>
        <button
          onClick={submit}
          disabled={saving}
          className="rounded-lg bg-primary px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-indigo-600 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Record actuals"}
        </button>
      </div>
      {done && (
        <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2 text-[12px] font-medium text-emerald-700">
          <Check size={14} /> {done}
        </div>
      )}
    </div>
  );
}

function Cell({ value, onChange, step }: { value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <input
      type="number"
      step={step}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full min-w-[64px] rounded-md border border-border bg-slate-50 px-2 py-1 text-right text-[12px] font-semibold tnum outline-none focus:border-primary"
    />
  );
}
