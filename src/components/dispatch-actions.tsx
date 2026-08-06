"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { voidDispatch, editDispatch } from "@/lib/actions";
import { Badge, Button, Field, Input, Select, Sheet, useConfirm } from "@/components/ui";
import { num } from "@/lib/format";
import { Pencil, Undo2 } from "lucide-react";

/**
 * Change 22 Part B — per-event Edit + Void on every dispatch log.
 *
 * addDispatch was create-only: a wrong qty, colour, size or reason, or a double-log, was
 * permanent and could wrongly close the card. Voiding puts the pieces back on the card and
 * reopens a card that closed only because of this dispatch; editing keeps the DC- number.
 *
 * A wrong SIZE or COLOUR is a void-and-relog (the cells are the document); this editor
 * covers the far commoner case — a mis-keyed quantity or header field.
 */

export type DispatchEditable = {
  id: number;
  dispatchNo: string | null;
  date: string; // ISO
  qty: number;
  reason: string;
  note: string | null;
  challan: string | null;
  arrangedBy: string | null;
  voidedAt: string | null;
  lines: { id: number; colour: string | null; size: string; qty: number }[];
};

export function VoidedBadge() {
  return <Badge tone="danger">Void</Badge>;
}

export function DispatchActions({ event, compact = false }: { event: DispatchEditable; compact?: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(event.date.slice(0, 10));
  const [reason, setReason] = useState(event.reason);
  const [note, setNote] = useState(event.note ?? "");
  const [challan, setChallan] = useState(event.challan ?? "");
  const [arrangedBy, setArrangedBy] = useState(event.arrangedBy ?? "");
  const [lines, setLines] = useState(event.lines.map((l) => ({ ...l, qty: String(l.qty) })));

  const label = event.dispatchNo ?? `#${event.id}`;
  const newQty = lines.reduce((a, l) => a + (Number(l.qty) || 0), 0);
  const changed = Math.round((newQty - event.qty) * 100) / 100;

  async function doVoid() {
    if (
      !(await confirm({
        title: `Void dispatch ${label}?`,
        message: `This reverses the stock movement and adds these ${num(event.qty)} pieces back to the card.`,
        tone: "danger",
        confirmLabel: "Void",
      }))
    )
      return;
    setBusy(true);
    try {
      const r = await voidDispatch({ id: event.id });
      router.refresh();
      if (r && "reopened" in r && r.reopened) alert(`${label} voided — the card was reopened.`);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await editDispatch({
        id: event.id,
        // lines are only sent when this event actually has a cell breakup; a legacy
        // total-only event keeps its shape and edits the header qty instead
        ...(event.lines.length
          ? { lines: lines.map((l) => ({ colour: l.colour, size: l.size, qty: Number(l.qty) || 0 })) }
          : { qty: newQty || event.qty }),
        date,
        reason: reason as "ORDER" | "SALE" | "OTHER",
        note: note.trim() || null,
        challan: challan.trim() || null,
        arrangedBy: arrangedBy.trim() || null,
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (event.voidedAt) return <VoidedBadge />;

  const cls = compact
    ? "t-xs font-semibold text-t3 hover:text-primary-ink disabled:opacity-40"
    : "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 t-xs font-semibold text-t1 hover:bg-surface-2 disabled:opacity-40";

  return (
    <>
      <span className="inline-flex items-center gap-2 no-print">
        <button onClick={() => setOpen(true)} disabled={busy} className={cls} title={`Edit ${label}`}>
          <Pencil size={12} /> {compact ? "" : "Edit"}
        </button>
        <button
          onClick={doVoid}
          disabled={busy}
          className={compact ? "t-xs font-semibold text-t3 hover:text-danger disabled:opacity-40" : `${cls} text-danger hover:bg-danger-soft`}
          title={`Void ${label}`}
        >
          <Undo2 size={12} /> {compact ? "" : "Void"}
        </button>
      </span>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Edit ${label}`}
        
        width={440}
        footer={
          <>
            <Button variant="primary" className="flex-1" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Reason">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="ORDER">ORDER</option>
              <option value="SALE">SALE</option>
              <option value="OTHER">OTHER</option>
            </Select>
          </Field>
        </div>

        {lines.length > 0 ? (
          <div>
            <div className="mb-1.5 t-micro font-semibold uppercase tracking-wide text-faint">
              Size × colour — set a cell to 0 to drop it
            </div>
            <div className="flex flex-col gap-1.5">
              {lines.map((l, i) => (
                <div key={l.id} className="flex items-center gap-2 t-sm">
                  <span className="flex-1 truncate">
                    {l.colour ? <span className="font-medium">{l.colour} </span> : null}
                    <span className="text-t2">{l.size}</span>
                  </span>
                  <Input
                    size="sm"
                    type="number"
                    step="any"
                    value={l.qty}
                    onChange={(e) =>
                      setLines((rows) => rows.map((r, idx) => (idx === i ? { ...r, qty: e.target.value } : r)))
                    }
                    className="w-24 text-right tnum"
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Field label="Quantity">
            <Input
              type="number"
              step="any"
              value={lines.length ? "" : String(newQty || event.qty)}
              onChange={(e) => setLines([{ id: 0, colour: null, size: "", qty: e.target.value }])}
              className="text-right tnum"
            />
          </Field>
        )}

        <div className="flex items-baseline justify-between rounded-lg bg-surface-2 px-3 py-2.5 t-sm">
          <span className="text-t2">New total</span>
          <span className="flex items-baseline gap-2">
            <span className="t-head font-bold tnum">{num(newQty)}</span>
            {changed !== 0 && (
              <span className={`t-xs font-semibold tnum ${changed > 0 ? "text-ok" : "text-warn"}`}>
                {changed > 0 ? "+" : "−"}
                {num(Math.abs(changed))} vs before
              </span>
            )}
          </span>
        </div>

        <Field label="Challan ref" hint="Optional">
          <Input value={challan} onChange={(e) => setChallan(e.target.value)} placeholder="—" />
        </Field>
        <Field label="Arranged by">
          <Input value={arrangedBy} onChange={(e) => setArrangedBy(e.target.value)} placeholder="—" />
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="—" />
        </Field>
      </Sheet>
    </>
  );
}
