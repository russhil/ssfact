"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addStitchAssignment, addStitchReceipt, removeStitchAssignment } from "@/lib/actions";
import { Badge } from "@/components/ui";
import { num, fmtDate } from "@/lib/format";
import { Plus, X } from "lucide-react";

export type StitchReceiptView = { id: number; date: string; qty: number; note: string | null };
export type StitchAssignmentView = {
  id: number;
  vendorName: string;
  colour: string | null;
  lotQty: number | null;
  note: string | null;
  received: number;
  balance: number | null;
  receipts: StitchReceiptView[];
};

const inp = "rounded-md border border-border px-2 py-1 text-[12px] outline-none focus:border-primary";

export function JobStitching({
  jobCardId,
  canEdit,
  vendors,
  assignments,
}: {
  jobCardId: number;
  canEdit: boolean;
  vendors: { id: number; name: string }[];
  assignments: StitchAssignmentView[];
}) {
  const router = useRouter();
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? 0);
  const [colour, setColour] = useState("");
  const [lot, setLot] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!vendorId) return;
    setBusy(true);
    try {
      await addStitchAssignment({ jobCardId, vendorId, colour: colour.trim() || null, lotQty: lot ? +lot : null, note: note.trim() || null });
      setColour(""); setLot(""); setNote("");
      router.refresh();
    } catch (e) {
      alert("Could not add vendor: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {assignments.length === 0 && !canEdit && <p className="py-6 text-center text-[12px] text-muted">No stitching vendors assigned.</p>}

      <div className="space-y-2.5">
        {assignments.map((a) => (
          <StitchRow key={a.id} a={a} canEdit={canEdit} />
        ))}
      </div>

      {canEdit && (
        <div className="mt-3 rounded-lg border border-dashed border-border p-2.5">
          <div className="mb-1.5 text-[11px] font-semibold text-slate-600">Assign a stitching vendor</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <select value={vendorId} onChange={(e) => setVendorId(+e.target.value)} className={inp}>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <input value={colour} onChange={(e) => setColour(e.target.value)} placeholder="colour (optional)" className={`${inp} w-32`} />
            <input type="number" value={lot} onChange={(e) => setLot(e.target.value)} placeholder="lot qty" className={`${inp} w-24 text-right tnum`} />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note e.g. only black in Ramanreti" className={`${inp} flex-1 min-w-[160px]`} />
            <button onClick={add} disabled={busy || !vendorId} className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-40">
              <Plus size={13} /> Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StitchRow({ a, canEdit }: { a: StitchAssignmentView; canEdit: boolean }) {
  const router = useRouter();
  const [qty, setQty] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function logReceipt() {
    if (!qty || +qty <= 0) return;
    setBusy(true);
    try {
      await addStitchReceipt({ assignmentId: a.id, qty: +qty, date: date || undefined });
      setQty(""); setDate("");
      router.refresh();
    } catch (e) {
      alert("Could not log receipt: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`Remove ${a.vendorName} from this card?`)) return;
    await removeStitchAssignment({ id: a.id });
    router.refresh();
  }

  const balNeg = a.balance != null && a.balance < 0;
  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="font-bold">{a.vendorName}</span>
          {a.colour && <Badge tone="default">{a.colour}</Badge>}
          <span className="text-faint">lot <b className="tnum text-ink">{a.lotQty != null ? num(a.lotQty) : "—"}</b></span>
          <span className="text-faint">recd <b className="tnum text-ink">{num(a.received)}</b></span>
          <span className={balNeg ? "font-semibold text-rose-600" : "text-faint"}>
            bal <b className="tnum">{a.balance != null ? num(a.balance) : "—"}</b>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {a.receipts.length > 0 && (
            <button onClick={() => setOpen((v) => !v)} className="text-[11px] font-medium text-primary-ink hover:underline">
              {open ? "hide" : `${a.receipts.length} receipt${a.receipts.length > 1 ? "s" : ""}`}
            </button>
          )}
          {canEdit && <button onClick={remove} className="text-faint hover:text-danger"><X size={13} /></button>}
        </div>
      </div>
      {a.note && <p className="mt-1 text-[11px] text-muted">{a.note}</p>}

      {open && a.receipts.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t border-slate-50 pt-2">
          {a.receipts.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-[11px] text-slate-500">
              <span className="tnum">{fmtDate(new Date(r.date))}{r.note && <span className="ml-2 text-faint">{r.note}</span>}</span>
              <span className="font-semibold tnum text-emerald-600">+{num(r.qty)}</span>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-slate-50 pt-2">
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="received qty" className={`${inp} w-28 text-right tnum`} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
          <button onClick={logReceipt} disabled={busy || !qty} className="rounded-md border border-border px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            Log receipt
          </button>
        </div>
      )}
    </div>
  );
}
