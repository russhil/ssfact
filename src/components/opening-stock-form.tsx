"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, PageHeader, inputClass } from "@/components/ui";
import { recordOpeningStock } from "@/lib/actions";
import { X, Plus } from "lucide-react";

const inp = inputClass("sm");
type FabricColorOpt = { id: number; label: string };
type TrimOpt = { id: number; name: string };
type Firm = { id: number; name: string };
type Line = { kind: "fabric" | "trim"; refId: number | 0; qty: string };

const empty = (): Line => ({ kind: "fabric", refId: 0, qty: "" });

/**
 * Change 40 Part L10 — enter opening stock firm-wise (owner: "like the two firms that I might
 * have, 2 or 3"). Each line posts an OPENING movement for the chosen firm; legacy movements are
 * untouched. Run once per firm at go-live.
 */
export function OpeningStockForm({ firms, fabricColors, trims }: { firms: Firm[]; fabricColors: FabricColorOpt[]; trims: TrimOpt[] }) {
  const router = useRouter();
  const [firmId, setFirmId] = useState<number | 0>(firms.length === 1 ? firms[0].id : 0);
  const [lines, setLines] = useState<Line[]>([empty()]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const filled = lines.filter((l) => l.refId && +l.qty > 0);
  const setLine = (i: number, patch: Partial<Line>) => setLines((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function save() {
    if (!firmId || filled.length === 0) return;
    setBusy(true);
    try {
      await recordOpeningStock({
        buyerId: firmId,
        fabric: filled.filter((l) => l.kind === "fabric").map((l) => ({ fabricColorId: l.refId as number, qty: +l.qty })),
        trim: filled.filter((l) => l.kind === "trim").map((l) => ({ trimItemId: l.refId as number, qty: +l.qty })),
      });
      setLines([empty()]); setDone(true);
      router.refresh();
    } catch (e) { alert("Could not save: " + (e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="p-6">
      <PageHeader title="Opening stock" subtitle="Enter the counted quantity per firm at go-live" />
      {firms.length === 0 ? (
        <Card className="p-5"><p className="t-sm text-muted">No stock-holding firms yet — mark a Buyer as a firm-factory first.</p></Card>
      ) : (
        <Card className="p-5">
          {done && <div className="mb-3 rounded-md border border-ok/30 bg-ok-soft px-3 py-2 t-xs font-semibold text-ok">Opening stock saved. Add more or switch firm.</div>}
          <label className="mb-3 flex flex-col gap-1">
            <span className="t-micro font-semibold uppercase tracking-wide text-faint">Firm</span>
            <select value={firmId} onChange={(e) => { setFirmId(+e.target.value); setDone(false); }} className={`${inp} w-56`}>
              <option value={0}>— pick firm —</option>
              {firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>

          <div className="space-y-1.5">
            {lines.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5">
                <select value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value as "fabric" | "trim", refId: 0 })} className={inp}>
                  <option value="fabric">Fabric</option>
                  <option value="trim">Trim</option>
                </select>
                <select value={l.refId} onChange={(e) => setLine(i, { refId: +e.target.value })} className={`${inp} min-w-[220px]`}>
                  <option value={0}>— pick {l.kind} —</option>
                  {(l.kind === "fabric" ? fabricColors.map((f) => ({ id: f.id, name: f.label })) : trims).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <input type="number" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder="counted qty" className={`${inp} w-32 text-right tnum`} />
                {lines.length > 1 && <button onClick={() => setLines((r) => r.filter((_, idx) => idx !== i))} className="text-faint hover:text-danger"><X size={13} /></button>}
              </div>
            ))}
            <button onClick={() => setLines((r) => [...r, empty()])} className="inline-flex items-center gap-1 t-xs font-semibold text-primary-ink hover:underline"><Plus size={12} /> Add item</button>
          </div>

          <div className="mt-4">
            <button onClick={save} disabled={busy || !firmId || filled.length === 0} className="rounded-lg bg-primary px-4 py-2 t-sm font-semibold text-accent-on hover:opacity-90 disabled:opacity-40">{busy ? "Saving…" : "Post opening stock"}</button>
          </div>
        </Card>
      )}
    </div>
  );
}
