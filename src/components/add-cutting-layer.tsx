"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addCuttingLayer } from "@/lib/actions";
import { num } from "@/lib/format";
import { Plus } from "lucide-react";

const inp = "rounded-md border border-border bg-white px-1.5 py-1 text-[11px] tnum outline-none focus:border-primary";
const cellKey = (s: string, c: string) => `${s}|||${c}`;

export function AddCuttingLayer({
  jobCardId,
  sizes,
  colours,
  masters,
}: {
  jobCardId: number;
  sizes: string[];
  colours: string[];
  masters: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cells, setCells] = useState<Record<string, number>>({});
  const [avg, setAvg] = useState("");
  const [rolls, setRolls] = useState("");
  const [mtr, setMtr] = useState("");
  const [balance, setBalance] = useState("");
  const [date, setDate] = useState("");
  const [master, setMaster] = useState("");
  const [busy, setBusy] = useState(false);

  const cols = colours.length > 0 ? colours : [""];
  const total = Object.values(cells).reduce((a, q) => a + (q > 0 ? q : 0), 0);

  async function save() {
    const payloadCells = Object.entries(cells)
      .filter(([, q]) => q > 0)
      .map(([k, q]) => { const i = k.indexOf("|||"); return { size: k.slice(0, i), colour: k.slice(i + 3), qty: q }; });
    if (!payloadCells.length) return;
    setBusy(true);
    try {
      await addCuttingLayer({
        jobCardId,
        cutDate: date || null,
        cuttingMaster: master || null,
        avgConsumption: avg ? +avg : null,
        rolls: rolls ? Math.round(+rolls) : null,
        fabricMtr: mtr ? +mtr : null,
        fabricBalance: balance ? +balance : null,
        cells: payloadCells,
      });
      setCells({}); setAvg(""); setRolls(""); setMtr(""); setBalance(""); setDate(""); setMaster("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      alert("Could not add layer: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-primary/40 px-3 py-2 text-[12px] font-semibold text-primary-ink hover:bg-primary-soft">
        <Plus size={13} /> Add layer
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-slate-50/40 p-3.5">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-primary-ink">New layer · {num(total)} pcs</div>
      <div className="overflow-x-auto">
        <table className="w-full text-center text-[12px]">
          <thead>
            <tr className="text-[10px] font-bold text-faint">
              <th className="px-2 py-1 text-left">Colour \ Size</th>
              {sizes.map((s) => <th key={s} className="px-2 py-1">{s}</th>)}
            </tr>
          </thead>
          <tbody>
            {cols.map((c) => (
              <tr key={c || "—"}>
                <td className="px-2 py-1 text-left font-semibold text-slate-600">{c || "—"}</td>
                {sizes.map((s) => (
                  <td key={s} className="px-1 py-1">
                    <input
                      type="number"
                      value={cells[cellKey(s, c)] || ""}
                      placeholder="0"
                      onChange={(e) => setCells((p) => ({ ...p, [cellKey(s, c)]: Math.max(0, Math.round(+e.target.value)) }))}
                      className={`${inp} w-full min-w-[44px] text-center`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-6">
        <input type="number" step="0.001" value={avg} onChange={(e) => setAvg(e.target.value)} placeholder="avg m/pc" className={inp} />
        <input type="number" value={rolls} onChange={(e) => setRolls(e.target.value)} placeholder="rolls" className={inp} />
        <input type="number" step="0.01" value={mtr} onChange={(e) => setMtr(e.target.value)} placeholder="fabric mtr" className={inp} />
        <input type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="balance" className={inp} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
        <select value={master} onChange={(e) => setMaster(e.target.value)} className={inp}><option value="">master</option>{masters.map((m) => <option key={m}>{m}</option>)}</select>
      </div>
      <div className="mt-2 flex gap-1.5">
        <button onClick={save} disabled={busy || total <= 0} className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-40">Save layer</button>
        <button onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
      </div>
    </div>
  );
}
