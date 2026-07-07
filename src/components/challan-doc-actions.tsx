"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addChallanLine, removeChallanLine, lockChallan, voidChallan } from "@/lib/actions";
import { waLink, mailtoLink } from "@/lib/share";
import { num } from "@/lib/format";
import { Printer, MessageCircle, Mail, Plus, X } from "lucide-react";

type Opt = { id: number; name: string };
type LineView = { id: number; kind: "fabric" | "trim"; name: string; colour: string | null; qty: number; unit: string };

const inp = "rounded-md border border-border px-2 py-1.5 text-[12px] outline-none focus:border-primary";
const btn = "no-print inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold shadow-sm";

export function ChallanDocActions({
  challanId, status, direction, challanNo, lines, phone, email, summary, subject, fabrics, trims, colours,
}: {
  challanId: number; status: string; direction: "INWARD" | "OUTWARD"; challanNo: string | null;
  lines: LineView[]; phone: string | null; email: string | null; summary: string; subject: string;
  fabrics: Opt[]; trims: Opt[]; colours: { name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"fabric" | "trim">("fabric");
  const [refId, setRefId] = useState<number | 0>(0);
  const [colour, setColour] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");

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
  async function lock() { if (!confirm("Lock & post to inventory? Lines become read-only.")) return; setBusy(true); try { await lockChallan({ id: challanId }); router.refresh(); } catch (e) { alert((e as Error).message); setBusy(false); } }
  async function doVoid() { if (!confirm(`Void ${challanNo} and reverse its stock movements?`)) return; setBusy(true); try { await voidChallan({ id: challanId }); router.refresh(); } catch (e) { alert((e as Error).message); setBusy(false); } }

  if (status === "DRAFT") {
    return (
      <div className="no-print mb-4 rounded-xl border border-dashed border-border bg-slate-50/50 p-3">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">Draft — editable</div>
        {lines.length > 0 && (
          <div className="mb-2 space-y-1">
            {lines.map((l) => (
              <div key={l.id} className="flex items-center justify-between text-[12px]">
                <span>{l.name}{l.colour ? ` · ${l.colour}` : ""} — <b className="tnum">{num(l.qty)}</b> {l.unit}</span>
                <button onClick={() => del(l.id)} disabled={busy} className="text-faint hover:text-danger"><X size={13} /></button>
              </div>
            ))}
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
          <button onClick={addLine} disabled={busy || !refId || !qty} className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"><Plus size={13} /> Add line</button>
          <datalist id="doc-colours">{colours.map((c) => <option key={c.name} value={c.name} />)}</datalist>
          <button onClick={lock} disabled={busy || lines.length === 0} className="ml-auto rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-40">Lock &amp; Post</button>
        </div>
      </div>
    );
  }

  // LOCKED / VOID
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2">
      <button onClick={() => window.print()} className={`${btn} bg-primary text-white hover:bg-indigo-600`}><Printer size={15} /> Print / PDF</button>
      <button onClick={() => window.open(waLink(phone, summary), "_blank")} className={`${btn} border border-border bg-white hover:bg-slate-50`}><MessageCircle size={15} /> WhatsApp</button>
      <button onClick={() => window.open(mailtoLink(email, subject, summary), "_blank")} className={`${btn} border border-border bg-white hover:bg-slate-50`}><Mail size={15} /> Email{email ? "" : " (no address)"}</button>
      {status === "LOCKED" && <button onClick={doVoid} disabled={busy} className={`${btn} border border-rose-200 bg-white text-rose-600 hover:bg-rose-50`}>Void</button>}
    </div>
  );
}
