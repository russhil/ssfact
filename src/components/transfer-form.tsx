"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { inputClass } from "@/components/ui";
import { createTransferChallan } from "@/lib/actions";
import { X, Plus } from "lucide-react";

const inp = inputClass("sm");
type Opt = { id: number; name: string };
type Firm = { id: number; name: string };
type Line = { kind: "fabric" | "trim"; refId: number | 0; colour: string; qty: string };

const empty = (): Line => ({ kind: "fabric", refId: 0, colour: "", qty: "" });

/**
 * Change 40 Part L8 — move material between the two firm-factories. Posts an atomic OUT@from +
 * IN@to pair; the all-firms total is unchanged, only the firm balances move.
 */
export function TransferForm({ fabrics, trims, firms, colours }: { fabrics: Opt[]; trims: Opt[]; firms: Firm[]; colours: { name: string }[] }) {
  const router = useRouter();
  const [fromId, setFromId] = useState<number | 0>(0);
  const [toId, setToId] = useState<number | 0>(0);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([empty()]);
  const [busy, setBusy] = useState(false);

  if (firms.length < 2) return null; // a transfer needs two firms

  const filled = lines.filter((l) => l.refId && +l.qty > 0);
  const setLine = (i: number, patch: Partial<Line>) => setLines((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function save() {
    if (!fromId || !toId || filled.length === 0) return;
    setBusy(true);
    try {
      await createTransferChallan({
        fromBuyerId: fromId, toBuyerId: toId, note: note.trim() || null,
        lines: filled.map((l) => ({ kind: l.kind, refId: l.refId as number, colour: l.kind === "fabric" ? l.colour || null : null, qty: +l.qty })),
      });
      setLines([empty()]); setNote("");
      router.refresh();
    } catch (e) { alert("Could not transfer: " + (e as Error).message); setBusy(false); }
  }

  return (
    <Card className="mt-3.5 p-5">
      <h3 className="mb-3 t-body font-bold">Firm → firm transfer</h3>
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="t-micro font-semibold uppercase tracking-wide text-faint">From</span>
          <select value={fromId} onChange={(e) => setFromId(+e.target.value)} className={inp}>
            <option value={0}>— firm —</option>
            {firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <span className="pb-2 text-faint">→</span>
        <label className="flex flex-col gap-1">
          <span className="t-micro font-semibold uppercase tracking-wide text-faint">To</span>
          <select value={toId} onChange={(e) => setToId(+e.target.value)} className={inp}>
            <option value={0}>— firm —</option>
            {firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="t-micro font-semibold uppercase tracking-wide text-faint">Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className={`${inp} w-40`} />
        </label>
      </div>

      <div className="mt-3 space-y-1.5">
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <select value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value as "fabric" | "trim", refId: 0, colour: "" })} className={inp}>
              <option value="fabric">Fabric</option>
              <option value="trim">Trim</option>
            </select>
            <select value={l.refId} onChange={(e) => setLine(i, { refId: +e.target.value })} className={`${inp} min-w-[150px]`}>
              <option value={0}>— pick {l.kind} —</option>
              {(l.kind === "fabric" ? fabrics : trims).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {l.kind === "fabric" && <input list="transfer-colours" value={l.colour} onChange={(e) => setLine(i, { colour: e.target.value })} placeholder="colour" className={`${inp} w-28`} />}
            <input type="number" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder="qty" className={`${inp} w-24 text-right tnum`} />
            {lines.length > 1 && <button onClick={() => setLines((r) => r.filter((_, idx) => idx !== i))} className="text-faint hover:text-danger"><X size={13} /></button>}
          </div>
        ))}
        <datalist id="transfer-colours">{colours.map((c) => <option key={c.name} value={c.name} />)}</datalist>
        <button onClick={() => setLines((r) => [...r, empty()])} className="inline-flex items-center gap-1 t-xs font-semibold text-primary-ink hover:underline"><Plus size={12} /> Add line</button>
      </div>

      <div className="mt-3">
        <button onClick={save} disabled={busy || !fromId || !toId || filled.length === 0} className="rounded-lg bg-primary px-4 py-2 t-sm font-semibold text-accent-on hover:opacity-90 disabled:opacity-40">
          {busy ? "Posting…" : "Post transfer"}
        </button>
      </div>
    </Card>
  );
}
