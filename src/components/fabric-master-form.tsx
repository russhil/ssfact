"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateFabricMaster,
  addFabricSupplier,
  removeFabricSupplier,
  addFabricColor,
  setFabricColorStock,
} from "@/lib/actions";
import { Card } from "@/components/ui";
import { num } from "@/lib/format";
import { Plus, X, Check } from "lucide-react";

type Supplier = { id: number; name: string; rate: number | null };
type ColorRow = { id: number; color: string; opening: number; current: number };

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export function FabricMasterForm({
  fabricId,
  unit,
  gsm,
  rollWidth,
  form,
  ratePerUnit,
  suppliers,
  colors,
}: {
  fabricId: number;
  unit: string;
  gsm: number | null;
  rollWidth: number | null;
  form: string | null;
  ratePerUnit: number | null;
  suppliers: Supplier[];
  colors: ColorRow[];
}) {
  const router = useRouter();
  const [g, setG] = useState(gsm != null ? String(gsm) : "");
  const [w, setW] = useState(rollWidth != null ? String(rollWidth) : "");
  const [f, setF] = useState<string>(form ?? "");
  const [rate, setRate] = useState(ratePerUnit != null ? String(ratePerUnit) : "");
  const [savedMaster, setSavedMaster] = useState(false);

  const [supName, setSupName] = useState("");
  const [supRate, setSupRate] = useState("");
  const [newColor, setNewColor] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveMaster() {
    setBusy(true);
    try {
      await updateFabricMaster({
        fabricId,
        gsm: numOrNull(g),
        rollWidth: numOrNull(w),
        form: (f || null) as "OPEN" | "TUBE" | null,
        ratePerUnit: numOrNull(rate),
      });
      setSavedMaster(true);
      setTimeout(() => setSavedMaster(false), 1800);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-3.5 p-5">
      <h3 className="mb-3 text-[13px] font-bold">Fabric Master <span className="font-medium text-faint">· admin / staff</span></h3>

      {/* presets */}
      <div className="grid grid-cols-5 gap-2.5">
        <Labelled label="GSM (preset)">
          <input type="number" value={g} onChange={(e) => setG(e.target.value)} placeholder="—"
            className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] font-semibold outline-none focus:border-primary" />
        </Labelled>
        <Labelled label="Roll width (preset)">
          <input type="number" value={w} onChange={(e) => setW(e.target.value)} placeholder="—"
            className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] font-semibold outline-none focus:border-primary" />
        </Labelled>
        <Labelled label="Form">
          <select value={f} onChange={(e) => setF(e.target.value)}
            className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] font-semibold outline-none focus:border-primary">
            <option value="">—</option>
            <option value="OPEN">OPEN</option>
            <option value="TUBE">TUBE</option>
          </select>
        </Labelled>
        <Labelled label={`Est. price (/${unit.toLowerCase()})`}>
          <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="—"
            className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] font-semibold outline-none focus:border-primary" />
        </Labelled>
        <div className="flex items-end">
          <button onClick={saveMaster} disabled={busy}
            className="w-full rounded-lg bg-primary px-3 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:bg-indigo-600 disabled:opacity-40">
            {savedMaster ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>

      {/* suppliers */}
      <div className="mt-4">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">Suppliers</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {suppliers.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-slate-50 px-2.5 py-1 text-[11px] font-semibold">
              {s.name}{s.rate != null && <span className="text-faint">· {num(s.rate)}</span>}
              <button onClick={() => run(() => removeFabricSupplier({ id: s.id }))} className="text-faint hover:text-danger"><X size={12} /></button>
            </span>
          ))}
          {suppliers.length === 0 && <span className="text-[11px] text-faint">none yet</span>}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input value={supName} onChange={(e) => setSupName(e.target.value)} placeholder="Supplier name"
            className="w-52 rounded-lg border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-primary" />
          <input type="number" value={supRate} onChange={(e) => setSupRate(e.target.value)} placeholder="rate"
            className="w-24 rounded-lg border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-primary" />
          <button
            onClick={() => supName.trim() && run(async () => { await addFabricSupplier({ fabricId, name: supName, rate: numOrNull(supRate) }); setSupName(""); setSupRate(""); })}
            disabled={busy || !supName.trim()}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-semibold hover:bg-slate-50 disabled:opacity-40">
            <Plus size={13} /> Add
          </button>
        </div>
      </div>

      {/* per-colour stock editor */}
      {colors.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">Per-colour stock ({unit.toLowerCase()})</div>
          <div className="grid gap-1.5">
            {colors.map((c) => (
              <ColorStockRow key={c.id} row={c} onSave={(opening, current) => run(() => setFabricColorStock({ fabricColorId: c.id, openingStock: opening, currentStock: current }))} busy={busy} />
            ))}
          </div>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <input value={newColor} onChange={(e) => setNewColor(e.target.value)} placeholder="Add colour"
          className="w-52 rounded-lg border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-primary" />
        <button
          onClick={() => newColor.trim() && run(async () => { await addFabricColor({ fabricId, color: newColor }); setNewColor(""); })}
          disabled={busy || !newColor.trim()}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-semibold hover:bg-slate-50 disabled:opacity-40">
          <Plus size={13} /> Add colour
        </button>
      </div>
    </Card>
  );
}

function ColorStockRow({ row, onSave, busy }: { row: ColorRow; onSave: (opening: number, current: number) => void; busy: boolean }) {
  const [opening, setOpening] = useState(String(row.opening));
  const [current, setCurrent] = useState(String(row.current));
  const dirty = +opening !== row.opening || +current !== row.current;
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-32 truncate font-semibold text-slate-600">{row.color}</span>
      <input type="number" value={opening} onChange={(e) => setOpening(e.target.value)}
        className="w-28 rounded-md border border-border px-2 py-1 text-right tnum outline-none focus:border-primary" />
      <span className="text-faint">opening</span>
      <input type="number" value={current} onChange={(e) => setCurrent(e.target.value)}
        className="w-28 rounded-md border border-border px-2 py-1 text-right tnum outline-none focus:border-primary" />
      <span className="text-faint">current</span>
      <button onClick={() => onSave(+opening, +current)} disabled={busy || !dirty}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold hover:bg-slate-50 disabled:opacity-30">
        <Check size={12} /> Save
      </button>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</label>
      {children}
    </div>
  );
}
