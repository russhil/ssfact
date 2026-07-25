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
  /**
   * Change 19 B: net already taken out of stock for this card+colour (Σ ISSUE − Σ RECEIPT).
   * Saving posts whatever delta makes that net equal USED, so the preview below is the real
   * movement — not the old clamped "issued − used", which hid every over-cut.
   */
  posted: number;
};

type Draft = { avg: string; issued: string; used: string };

export function FabricActualsForm({
  jobCardId,
  unit,
  lines,
  defaultArrangedBy = "",
}: {
  jobCardId: number;
  unit: string;
  lines: ActualsLine[];
  defaultArrangedBy?: string;
}) {
  const router = useRouter();
  const u = unit.toLowerCase();
  const [by, setBy] = useState(defaultArrangedBy);
  const [challan, setChallan] = useState("");
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

  // delta > 0 → more will be deducted (over-cut); delta < 0 → leftover returns; 0 → nothing.
  const deltaOf = (i: number) => Math.round(((+drafts[i].used || 0) - lines[i].posted) * 100) / 100;
  const netDelta = lines.reduce((a, _l, i) => a + deltaOf(i), 0);

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
        arrangedBy: by || null,
        challan: challan || null,
      });
      setDone(
        [
          "Saved",
          r.returnQty > 0 ? `${num(r.returnQty)} ${u} returned to stock` : null,
          r.extraIssued > 0 ? `${num(r.extraIssued)} ${u} extra deducted` : null,
        ].filter(Boolean).join(" · ")
      );
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="mb-1.5 t-micro font-semibold uppercase tracking-wide text-faint">
        Record actuals {lines.length > 1 ? "· per colour" : ""}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full t-sm">
          <thead>
            <tr className="text-left t-micro uppercase tracking-wide text-faint">
              <th className="px-2 py-1 font-semibold">Colour</th>
              <th className="px-2 py-1 text-right font-semibold">Actual avg</th>
              <th className="px-2 py-1 text-right font-semibold">Issued ({u})</th>
              <th className="px-2 py-1 text-right font-semibold">Used ({u})</th>
              <th className="px-2 py-1 text-right font-semibold">Net posted</th>
              <th className="px-2 py-1 text-right font-semibold">Movement</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const d = deltaOf(i);
              return (
                <tr key={l.color || i} className="border-t border-hairline">
                  <td className="px-2 py-1 font-semibold text-t1">{l.color || "—"}</td>
                  <td className="px-1 py-1">
                    <Cell value={drafts[i].avg} step="0.001" onChange={(v) => set(i, "avg", v)} />
                  </td>
                  <td className="px-1 py-1">
                    <Cell value={drafts[i].issued} onChange={(v) => set(i, "issued", v)} />
                  </td>
                  <td className="px-1 py-1">
                    <Cell value={drafts[i].used} onChange={(v) => set(i, "used", v)} />
                  </td>
                  <td className="px-2 py-1 text-right tnum text-t2">{num(l.posted)}</td>
                  <td className={`px-2 py-1 text-right tnum ${d > 0 ? "text-danger" : d < 0 ? "text-ok" : "text-faint"}`}>
                    {d > 0 ? `deduct ${num(d)}` : d < 0 ? `return ${num(-d)}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="arranged by" className="w-32 rounded-md border border-border px-2 py-1 t-xs outline-none focus:border-primary" />
        <input value={challan} onChange={(e) => setChallan(e.target.value)} placeholder="challan #" className="w-28 rounded-md border border-border px-2 py-1 t-xs outline-none focus:border-primary" />
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="t-sm text-muted">
          {netDelta > 0 ? (
            <>Will deduct: <b className="text-danger tnum">{num(netDelta)} {u}</b></>
          ) : netDelta < 0 ? (
            <>Will return to stock: <b className="text-ok tnum">{num(-netDelta)} {u}</b></>
          ) : (
            <>No stock movement</>
          )}
          <span className="ml-2 t-xs text-faint">stock always settles at USED — re-saving the same figures moves nothing</span>
        </span>
        <button
          onClick={submit}
          disabled={saving}
          className="rounded-lg bg-primary px-3.5 py-1.5 t-sm font-semibold text-accent-on shadow-sm transition hover:opacity-90 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Record actuals"}
        </button>
      </div>
      {done && (
        <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2 t-sm font-medium text-ok">
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
      className="w-full min-w-[64px] rounded-md border border-border bg-surface-2 px-2 py-1 text-right t-sm font-semibold tnum outline-none focus:border-primary"
    />
  );
}
