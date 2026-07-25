"use client";

import { inputClass } from "@/components/ui";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addChallanLine, removeChallanLine, updateChallanLine, lockChallan, voidChallan, editLockedChallan } from "@/lib/actions";
import { waLink, mailtoLink } from "@/lib/share";
import { num } from "@/lib/format";
import { Printer, MessageCircle, Mail, Plus, X, Pencil, Check } from "lucide-react";

type Opt = { id: number; name: string };
type LineView = { id: number; kind: "fabric" | "trim"; name: string; colour: string | null; qty: number; unit: string; rate?: number | null };
/** Change 18: per-line draft edits, keyed by line id. Seeded lazily on first keystroke. */
type DraftEdit = { qty: string; unit: string; rate: string; colour: string };
type EditLine = { fabricId: number | null; trimItemId: number | null; colour: string | null; qty: number; unit: string | null; rate: number | null; note: string | null };
type ELine = { kind: "fabric" | "trim"; refId: number | 0; colour: string; qty: string; unit: string; rate: string; note: string };

const inp = inputClass("sm");
const btn = "no-print inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 t-body font-semibold shadow-sm";
const emptyELine = (): ELine => ({ kind: "fabric", refId: 0, colour: "", qty: "", unit: "", rate: "", note: "" });

export function ChallanDocActions({
  challanId, status, direction, challanNo, lines, editLines = [], phone, email, summary, subject, fabrics, trims, colours,
}: {
  challanId: number; status: string; direction: "INWARD" | "OUTWARD"; challanNo: string | null;
  lines: LineView[]; editLines?: EditLine[]; phone: string | null; email: string | null; summary: string; subject: string;
  fabrics: Opt[]; trims: Opt[]; colours: { name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"fabric" | "trim">("fabric");
  const [refId, setRefId] = useState<number | 0>(0);
  const [colour, setColour] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [edits, setEdits] = useState<Record<number, DraftEdit>>({});

  // Locked-edit state (Change 17 Part C): whole-line-set replace via editLockedChallan.
  const [editing, setEditing] = useState(false);
  const [elines, setELines] = useState<ELine[]>([]);
  function openEdit() {
    const seed: ELine[] = editLines.map((l) => ({
      kind: l.fabricId ? "fabric" : "trim",
      refId: (l.fabricId ?? l.trimItemId ?? 0) as number | 0,
      colour: l.colour ?? "",
      qty: String(l.qty),
      unit: l.unit ?? "",
      rate: l.rate != null ? String(l.rate) : "",
      note: l.note ?? "",
    }));
    setELines([...seed, emptyELine()]);
    setEditing(true);
  }
  const setEL = (i: number, patch: Partial<ELine>) =>
    setELines((rows) => {
      const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      const last = next[next.length - 1];
      if (last && last.refId && +last.qty > 0) next.push(emptyELine());
      return next;
    });
  const removeEL = (i: number) => setELines((rows) => (rows.length <= 1 ? [emptyELine()] : rows.filter((_, idx) => idx !== i)));
  async function saveEdit() {
    const filled = elines.filter((l) => l.refId && +l.qty > 0);
    if (filled.length === 0) { alert("A locked challan must keep at least one line."); return; }
    if (!confirm("Re-post this challan? Old stock movements are reversed and the new lines posted.")) return;
    setBusy(true);
    try {
      await editLockedChallan({
        id: challanId,
        lines: filled.map((l) => ({
          fabricId: l.kind === "fabric" ? (l.refId as number) : null,
          colour: l.kind === "fabric" ? l.colour || null : null,
          trimItemId: l.kind === "trim" ? (l.refId as number) : null,
          qty: +l.qty, unit: l.unit || null, rate: l.rate ? +l.rate : null, note: l.note || null,
        })),
      });
      setEditing(false);
      router.refresh();
    } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  }

  async function addLine() {
    if (!refId || !qty || +qty <= 0) return;
    setBusy(true);
    try {
      await addChallanLine(challanId, {
        fabricId: kind === "fabric" ? refId : null,
        colour: kind === "fabric" ? colour || null : null,
        trimItemId: kind === "trim" ? refId : null,
        qty: +qty, unit: unit || null,
      });
      setRefId(0); setColour(""); setQty(""); setUnit("");
      router.refresh();
    } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  }
  async function del(id: number) { setBusy(true); try { await removeChallanLine({ id }); router.refresh(); } catch (e) { alert((e as Error).message); setBusy(false); } }

  // Change 18: a draft pre-filled from a PO almost never matches the real delivery, so
  // every draft line's qty / unit / rate (and colour, for fabric) is editable before lock.
  // The item itself is fixed — delete the line and add a new one to change it.
  const seedEdit = (l: LineView): DraftEdit => ({
    qty: String(l.qty),
    unit: l.unit ?? "",
    rate: l.rate != null ? String(l.rate) : "",
    colour: l.colour ?? "",
  });
  const editOf = (l: LineView) => edits[l.id] ?? seedEdit(l);
  const setEdit = (l: LineView, patch: Partial<DraftEdit>) =>
    setEdits((m) => ({ ...m, [l.id]: { ...editOf(l), ...patch } }));
  const isDirty = (l: LineView) => {
    const e = edits[l.id];
    if (!e) return false;
    const s = seedEdit(l);
    return e.qty !== s.qty || e.unit !== s.unit || e.rate !== s.rate || e.colour !== s.colour;
  };
  async function saveLine(l: LineView) {
    const e = editOf(l);
    setBusy(true);
    try {
      await updateChallanLine(l.id, {
        qty: +e.qty,
        unit: e.unit || null,
        rate: e.rate ? +e.rate : null,
        ...(l.kind === "fabric" ? { colour: e.colour || null } : {}),
      });
      setEdits((m) => { const { [l.id]: _drop, ...rest } = m; return rest; });
      router.refresh();
    } catch (err) { alert((err as Error).message); } finally { setBusy(false); }
  }
  async function lock() { if (!confirm("Lock & post to inventory? Lines become read-only.")) return; setBusy(true); try { await lockChallan({ id: challanId }); router.refresh(); } catch (e) { alert((e as Error).message); setBusy(false); } }
  async function doVoid() { if (!confirm(`Void ${challanNo} and reverse its stock movements?`)) return; setBusy(true); try { await voidChallan({ id: challanId }); router.refresh(); } catch (e) { alert((e as Error).message); setBusy(false); } }

  if (status === "DRAFT") {
    return (
      <div className="no-print mb-4 rounded-xl border border-dashed border-border bg-surface-2/50 p-3">
        <div className="mb-2 t-xs font-bold uppercase tracking-wide text-muted">
          Draft — editable <span className="font-medium normal-case tracking-normal text-faint">· correct the quantities to what physically arrived, then lock</span>
        </div>
        {lines.length > 0 && (
          <div className="mb-2 space-y-1">
            {lines.map((l) => {
              const e = editOf(l);
              const dirty = isDirty(l);
              return (
                <div key={l.id} className="flex flex-wrap items-center gap-1.5 t-sm">
                  <span className="min-w-[140px] font-semibold">{l.name}</span>
                  {l.kind === "fabric" && (
                    <input list="doc-colours" value={e.colour} onChange={(ev) => setEdit(l, { colour: ev.target.value })} placeholder="colour" className={`${inp} w-24`} />
                  )}
                  <input type="number" step="any" value={e.qty} onChange={(ev) => setEdit(l, { qty: ev.target.value })} className={`${inp} w-20 text-right tnum`} />
                  <select value={e.unit} onChange={(ev) => setEdit(l, { unit: ev.target.value })} className={inp}>
                    <option value="">unit</option><option>MTR</option><option>KG</option><option>PCS</option><option>SET</option>
                  </select>
                  <input type="number" step="any" value={e.rate} onChange={(ev) => setEdit(l, { rate: ev.target.value })} placeholder="₹ rate" className={`${inp} w-20 text-right tnum`} />
                  {dirty && (
                    <button onClick={() => saveLine(l)} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-ok/30 bg-ok-soft px-2 py-1 t-xs font-semibold text-ok hover:bg-ok-soft disabled:opacity-40"><Check size={12} /> Save</button>
                  )}
                  <button onClick={() => del(l.id)} disabled={busy} className="ml-auto text-faint hover:text-danger"><X size={13} /></button>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={kind} onChange={(e) => { setKind(e.target.value as "fabric" | "trim"); setRefId(0); }} className={inp}>
            <option value="fabric">Fabric</option><option value="trim">Trim/Acc</option>
          </select>
          <select value={refId} onChange={(e) => setRefId(+e.target.value)} className={`${inp} min-w-[150px]`}>
            <option value={0}>— pick {kind} —</option>
            {(kind === "fabric" ? fabrics : trims).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {kind === "fabric" && <input list="doc-colours" value={colour} onChange={(e) => setColour(e.target.value)} placeholder="colour" className={`${inp} w-24`} />}
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="qty" className={`${inp} w-20 text-right tnum`} />
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inp}><option value="">unit</option><option>MTR</option><option>KG</option><option>PCS</option><option>SET</option></select>
          <button onClick={addLine} disabled={busy || !refId || !qty} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 t-sm font-semibold text-t1 hover:bg-surface-2 disabled:opacity-40"><Plus size={13} /> Add line</button>
          <datalist id="doc-colours">{colours.map((c) => <option key={c.name} value={c.name} />)}</datalist>
          <button onClick={lock} disabled={busy || lines.length === 0} className="ml-auto rounded-lg bg-primary px-3.5 py-2 t-body font-semibold text-accent-on hover:opacity-90 disabled:opacity-40">Lock &amp; Post</button>
        </div>
      </div>
    );
  }

  // LOCKED / VOID
  return (
    <div className="no-print mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => window.print()} className={`${btn} bg-primary text-accent-on hover:opacity-90`}><Printer size={15} /> Print / PDF</button>
        <button onClick={() => window.open(waLink(phone, summary), "_blank")} className={`${btn} border border-border bg-surface hover:bg-surface-2`}><MessageCircle size={15} /> WhatsApp</button>
        <button onClick={() => window.open(mailtoLink(email, subject, summary), "_blank")} className={`${btn} border border-border bg-surface hover:bg-surface-2`}><Mail size={15} /> Email{email ? "" : " (no address)"}</button>
        {status === "LOCKED" && <button onClick={() => (editing ? setEditing(false) : openEdit())} disabled={busy} className={`${btn} border border-border bg-surface hover:bg-surface-2`}><Pencil size={15} /> {editing ? "Cancel edit" : "Edit"}</button>}
        {status === "LOCKED" && <button onClick={doVoid} disabled={busy} className={`${btn} border border-danger/30 bg-surface text-danger hover:bg-danger-soft`}>Void</button>}
      </div>

      {status === "LOCKED" && editing && (
        <div className="mt-3 rounded-xl border border-dashed border-border bg-surface-2/50 p-3">
          <div className="mb-2 t-xs font-bold uppercase tracking-wide text-muted">Edit {challanNo} — reverses & re-posts on save</div>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full t-sm">
              <thead>
                <tr className="border-b border-border text-left t-micro uppercase tracking-wide text-faint">
                  <th className="px-2 py-2 font-semibold">Type</th>
                  <th className="px-2 py-2 font-semibold">Item</th>
                  <th className="px-2 py-2 font-semibold">Colour</th>
                  <th className="px-2 py-2 text-right font-semibold">Qty</th>
                  <th className="px-2 py-2 font-semibold">Unit</th>
                  <th className="px-2 py-2 text-right font-semibold">Rate</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {elines.map((l, i) => (
                  <tr key={i} className="border-b border-hairline last:border-0">
                    <td className="px-2 py-1">
                      <select value={l.kind} onChange={(e) => setEL(i, { kind: e.target.value as "fabric" | "trim", refId: 0, colour: "" })} className={inp}>
                        <option value="fabric">Fabric</option><option value="trim">Trim/Acc</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select value={l.refId} onChange={(e) => setEL(i, { refId: +e.target.value })} className={`${inp} min-w-[150px]`}>
                        <option value={0}>— pick {l.kind} —</option>
                        {(l.kind === "fabric" ? fabrics : trims).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      {l.kind === "fabric"
                        ? <input list="edit-colours" value={l.colour} onChange={(e) => setEL(i, { colour: e.target.value })} placeholder="colour" className={`${inp} w-24`} />
                        : <span className="text-faint">—</span>}
                    </td>
                    <td className="px-1 py-1"><input type="number" value={l.qty} onChange={(e) => setEL(i, { qty: e.target.value })} placeholder="0" className={`${inp} w-20 text-right tnum`} /></td>
                    <td className="px-1 py-1">
                      <select value={l.unit} onChange={(e) => setEL(i, { unit: e.target.value })} className={inp}><option value="">—</option><option>MTR</option><option>KG</option><option>PCS</option><option>SET</option></select>
                    </td>
                    <td className="px-1 py-1"><input type="number" value={l.rate} onChange={(e) => setEL(i, { rate: e.target.value })} placeholder="₹" className={`${inp} w-16 text-right tnum`} /></td>
                    <td className="px-1 py-1 text-right"><button onClick={() => removeEL(i)} className="text-faint hover:text-danger"><X size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="edit-colours">{colours.map((c) => <option key={c.name} value={c.name} />)}</datalist>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={saveEdit} disabled={busy} className="rounded-lg bg-primary px-3.5 py-2 t-body font-semibold text-accent-on hover:opacity-90 disabled:opacity-40">{busy ? "Saving…" : "Save changes (re-post)"}</button>
            <span className="t-xs text-faint">Old movements reverse and the new lines post — stock stays exact.</span>
          </div>
        </div>
      )}
    </div>
  );
}
