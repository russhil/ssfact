"use client";

import { inputClass } from "@/components/ui";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addCuttingLayer } from "@/lib/actions";
import { num } from "@/lib/format";
import { splitByRatio, orderSizes, sizeKey } from "@/lib/job-labels";
import { Plus, X } from "lucide-react";

const inp = inputClass("sm", "px-1.5 py-1 t-xs tnum");
const cellKey = (s: string, c: string) => `${s}|||${c}`;
const numOrNull = (s: string): number | null => (s.trim() === "" || Number.isNaN(+s) ? null : +s);
// Change 26 B: fill every colour at once, by the colour ratio.
const ALL_COLOURS = " ALL";

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
  const [mtr, setMtr] = useState(""); // Fabric USED
  const [balance, setBalance] = useState("");
  const [issued, setIssued] = useState(""); // Change 17 A: Fabric ISSUED
  const [date, setDate] = useState("");
  const [master, setMaster] = useState("");
  const [busy, setBusy] = useState(false);

  // Change 17 B: this lay's own size ratio (weights per size). Only sent when touched.
  const [ratio, setRatio] = useState<Record<string, number>>({});
  const [ratioTouched, setRatioTouched] = useState(false);
  const [fillColour, setFillColour] = useState((colours.length > 0 ? colours : [""])[0] ?? "");
  const [fillQty, setFillQty] = useState("");
  // Change 26 C: this lay's OWN size list — the card's sizes are only the seed, because a
  // later lay may drop a size or cut one the card has never carried.
  const [laySizes, setLaySizes] = useState<string[]>(sizes);
  const [newSize, setNewSize] = useState("");
  // Change 26 A/B: per-colour weights so "All colours" has a ratio to split on.
  const [colourWeight, setColourWeight] = useState<Record<string, number>>({});

  const cols = colours.length > 0 ? colours : [""];
  const total = Object.values(cells).reduce((a, q) => a + (q > 0 ? q : 0), 0);
  const issuedV = numOrNull(issued);
  const usedV = numOrNull(mtr);
  const extra = issuedV != null ? Math.round((issuedV - (usedV ?? 0)) * 100) / 100 : null;

  const ratioPairs = (): [string, number][] => laySizes.map((s) => [s, ratio[s] ?? 1]);
  const colourPairs = (): [string, number][] => cols.map((c) => [c, colourWeight[c] ?? 1]);

  function addSize(raw: string) {
    const s = sizeKey(raw);
    setNewSize("");
    if (!s || laySizes.includes(s)) return;
    setLaySizes((p) => [...p, s].sort(orderSizes));
  }
  function removeSize(s: string) {
    setLaySizes((p) => p.filter((x) => x !== s));
    // drop the column's cells too — a hidden size must never reach the payload
    setCells((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k.slice(0, k.indexOf("|||")) !== s)));
    setRatio(({ [s]: _drop, ...rest }) => rest);
  }

  function applyRatio() {
    const qty = numOrNull(fillQty);
    if (qty == null || qty <= 0) return;
    // Change 26 B: "All colours" splits the total by colour ratio first, then each colour's
    // share across sizes. A single colour behaves exactly as before.
    const targets: [string, number][] =
      fillColour === ALL_COLOURS
        ? cols.map((c) => [c, splitByRatio(qty, colourPairs()).get(c) ?? 0])
        : [[fillColour, qty]];
    setCells((p) => {
      const next = { ...p };
      for (const [colour, colourQty] of targets) {
        const split = splitByRatio(colourQty, ratioPairs());
        for (const s of laySizes) next[cellKey(s, colour)] = split.get(s) ?? 0;
      }
      return next;
    });
  }

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
        fabricMtr: mtr ? +mtr : null, // Fabric USED
        fabricBalance: balance ? +balance : null,
        fabricIssued: issued ? +issued : null, // Change 17 A
        sizeRatio: ratioTouched ? JSON.stringify(ratioPairs()) : null, // Change 17 B
        cells: payloadCells,
      });
      setCells({}); setAvg(""); setRolls(""); setMtr(""); setBalance(""); setIssued(""); setDate(""); setMaster("");
      setRatio({}); setRatioTouched(false); setFillQty("");
      setLaySizes(sizes); setNewSize(""); setColourWeight({}); // Change 26: back to the card's sizes
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
      <button onClick={() => setOpen(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-primary/40 px-3 py-2 t-sm font-semibold text-primary-ink hover:bg-primary-soft">
        <Plus size={13} /> Add layer
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface-2 p-3.5">
      <div className="mb-2 t-xs font-bold uppercase tracking-wide text-primary-ink">New layer · {num(total)} pcs</div>

      {/* Change 26 C: this lay's own sizes — seeded from the card, editable per lay */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="t-micro font-semibold uppercase tracking-wide text-faint">Sizes</span>
        {laySizes.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 t-xs font-semibold text-t1">
            {s}
            <button type="button" onClick={() => removeSize(s)} className="text-faint hover:text-danger"><X size={11} /></button>
          </span>
        ))}
        <input
          value={newSize}
          onChange={(e) => setNewSize(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSize(newSize); } }}
          onBlur={() => addSize(newSize)}
          placeholder="+ size"
          className={`${inp} w-20 border-dashed uppercase`}
        />
      </div>

      {/* Change 17 B: optional per-lay size ratio — fill the grid by this lay's own curve */}
      <div className="mb-2 rounded-md border border-dashed border-border bg-surface/60 p-2">
        <div className="mb-1 flex flex-wrap items-center gap-1.5 t-xs">
          <span className="t-micro font-semibold uppercase tracking-wide text-faint">This lay&apos;s size ratio</span>
          <span className="text-t2">fill</span>
          <select value={fillColour} onChange={(e) => setFillColour(e.target.value)} className={inp}>
            {/* Change 26 B */}
            {cols.length > 1 && <option value={ALL_COLOURS}>All colours</option>}
            {cols.map((c) => <option key={c || "—"} value={c}>{c || "—"}</option>)}
          </select>
          <span className="text-t2">with</span>
          <input type="number" value={fillQty} placeholder="pcs" onChange={(e) => setFillQty(e.target.value)} className={`${inp} w-20 text-right`} />
          <button type="button" onClick={applyRatio} className="rounded-md border border-border bg-surface px-2 py-1 font-semibold text-t1 hover:bg-surface-2">apply ratio</button>
        </div>
        <div className="grid gap-1 text-center" style={{ gridTemplateColumns: `repeat(${laySizes.length}, minmax(0, 1fr))` }}>
          {laySizes.map((s) => (
            <div key={s}>
              <div className="t-micro font-bold text-faint">{s}</div>
              <input
                type="number"
                step="0.01"
                value={ratio[s] ?? 1}
                onChange={(e) => { setRatioTouched(true); setRatio((p) => ({ ...p, [s]: Math.max(0, +e.target.value) })); }}
                className={`${inp} mt-0.5 w-full text-center`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Change 26 A: colour ratio — what "All colours" splits on */}
      {cols.length > 1 && (
        <div className="mb-2 rounded-md border border-dashed border-border bg-surface/60 p-2">
          <div className="mb-1 t-micro font-semibold uppercase tracking-wide text-faint">Colour ratio</div>
          <div className="grid gap-1 text-center" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
            {cols.map((c) => (
              <div key={c || "—"}>
                <div className="t-micro font-bold text-faint">{c || "—"}</div>
                <input
                  type="number"
                  step="0.01"
                  value={colourWeight[c] ?? 1}
                  onChange={(e) => setColourWeight((p) => ({ ...p, [c]: Math.max(0, +e.target.value) }))}
                  className={`${inp} mt-0.5 w-full text-center`}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-center t-sm">
          <thead>
            <tr className="t-micro font-bold text-faint">
              <th className="px-2 py-1 text-left">Colour \ Size</th>
              {laySizes.map((s) => <th key={s} className="px-2 py-1">{s}</th>)}
            </tr>
          </thead>
          <tbody>
            {cols.map((c) => (
              <tr key={c || "—"}>
                <td className="px-2 py-1 text-left font-semibold text-t1">{c || "—"}</td>
                {laySizes.map((s) => (
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
      {/* Change 17 A: Issued / Used / Extra reconciliation (Extra = issued − used, may be negative) */}
      <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-8">
        <input type="number" step="0.001" value={avg} onChange={(e) => setAvg(e.target.value)} placeholder="avg m/pc (est)" className={`${inp} bg-surface-2 text-faint`} />
        <input type="number" value={rolls} onChange={(e) => setRolls(e.target.value)} placeholder="rolls" className={`${inp} bg-surface-2 text-faint`} />
        <input type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="balance" className={`${inp} bg-surface-2 text-faint`} />
        <input type="number" step="0.01" value={issued} onChange={(e) => setIssued(e.target.value)} placeholder="fabric issued" className={inp} />
        <input type="number" step="0.01" value={mtr} onChange={(e) => setMtr(e.target.value)} placeholder="fabric used" className={inp} />
        <div className={`rounded-md border border-border bg-surface-2 px-1.5 py-1 t-xs font-semibold tnum ${extra != null && extra < 0 ? "text-danger" : "text-t1"}`} title="Extra = issued − used">
          {extra != null ? num(extra) : "—"}
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
        <select value={master} onChange={(e) => setMaster(e.target.value)} className={inp}><option value="">master</option>{masters.map((m) => <option key={m}>{m}</option>)}</select>
      </div>
      <div className="mt-2 flex gap-1.5">
        <button onClick={save} disabled={busy || total <= 0} className="rounded-md bg-primary px-3 py-1.5 t-sm font-semibold text-accent-on hover:opacity-90 disabled:opacity-40">Save layer</button>
        <button onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-1.5 t-sm font-semibold text-t1 hover:bg-surface-2">Cancel</button>
      </div>
    </div>
  );
}
