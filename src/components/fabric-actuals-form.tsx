"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordFabricActuals } from "@/lib/actions";
import { num } from "@/lib/format";
import { Check } from "lucide-react";

export function FabricActualsForm({
  jobCardId,
  unit,
  estAvg,
  estFabric,
  actualAvg,
  fabricDispatched,
  fabricUsed,
  hasReturn,
}: {
  jobCardId: number;
  unit: string;
  estAvg: number | null;
  estFabric: number | null;
  actualAvg: number | null;
  fabricDispatched: number | null;
  fabricUsed: number | null;
  hasReturn: boolean;
}) {
  const router = useRouter();
  const [avg, setAvg] = useState<string>(actualAvg != null ? String(actualAvg) : estAvg != null ? String(estAvg) : "");
  const [disp, setDisp] = useState<string>(fabricDispatched != null ? String(fabricDispatched) : estFabric != null ? String(estFabric) : "");
  const [used, setUsed] = useState<string>(fabricUsed != null ? String(fabricUsed) : "");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const dispNum = +disp || 0;
  const usedNum = +used || 0;
  const previewReturn = Math.max(0, dispNum - usedNum);

  async function submit() {
    if (dispNum <= 0) return;
    setSaving(true);
    try {
      const r = await recordFabricActuals({
        jobCardId,
        actualAvg: avg ? +avg : undefined,
        fabricDispatched: dispNum,
        fabricUsed: usedNum,
      });
      setDone(r.returnQty > 0 ? `Saved · ${num(r.returnQty)} ${unit.toLowerCase()} returned to stock` : "Saved");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="grid grid-cols-3 gap-2.5">
        <FieldNum label={`Actual avg (${unit.toLowerCase()}/pc)`} value={avg} onChange={setAvg} />
        <FieldNum label={`Dispatched (${unit.toLowerCase()})`} value={disp} onChange={setDisp} />
        <FieldNum label={`Used (${unit.toLowerCase()})`} value={used} onChange={setUsed} />
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-[12px] text-muted">
          Return to stock:{" "}
          <b className="text-emerald-600 tnum">{num(previewReturn)} {unit.toLowerCase()}</b>
          {hasReturn && <span className="ml-2 text-[11px] text-faint">(already returned — re-saving won&apos;t double-count)</span>}
        </span>
        <button
          onClick={submit}
          disabled={dispNum <= 0 || saving}
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

function FieldNum({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border px-3 py-2 text-[13px] font-semibold outline-none focus:border-primary"
      />
    </div>
  );
}
