"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { Sheet, Button, Field, Select, Textarea, inputClass } from "@/components/ui";
import { createPurchaseReturn, type ReturnReason } from "@/lib/actions";
import { runAction } from "@/lib/action-result";
import { num } from "@/lib/format";

/**
 * Change 25 Part D — return accepted goods to the supplier.
 *
 * Distinct from "Reverse receipt" (Change 22), and both are offered on a received PO:
 *   Reverse receipt   — this receipt was a mistake. Voids the challan, PO goes back
 *                       to ORDER_PLACED.
 *   Return to supplier — we received it, kept it, and later sent it back. New
 *                       CH-RET- document, PO stays RECEIVED.
 */

export type ReturnableLine = {
  id: number;
  name: string;
  colour: string | null;
  qty: number;
  unit: string;
};

const REASONS: { value: ReturnReason; label: string }[] = [
  { value: "DEFECT", label: "Defective" },
  { value: "WRONG_ITEM", label: "Wrong item" },
  { value: "EXCESS", label: "Excess supplied" },
  { value: "OTHER", label: "Other" },
];

export function PurchaseReturnButton({
  challanId,
  challanNo,
  supplier,
  lines,
}: {
  challanId: number;
  challanNo: string | null;
  supplier: string | null;
  lines: ReturnableLine[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<ReturnReason>("DEFECT");
  const [note, setNote] = useState("");
  // Blank rather than pre-filled with the full receipt: a full return is rarer than a
  // partial one, and a pre-filled figure invites returning more than was inspected.
  const [qty, setQty] = useState<Record<number, string>>({});

  const total = lines.reduce((a, l) => a + (Number(qty[l.id]) || 0), 0);

  async function submit() {
    const picked = lines
      .map((l) => ({ lineId: l.id, qty: Number(qty[l.id]) || 0 }))
      .filter((r) => r.qty > 0);
    if (picked.length === 0) return;
    setBusy(true);
    const ok = await runAction(async () => {
      const { id } = await createPurchaseReturn({
        inwardChallanId: challanId,
        lines: picked,
        reason,
        note: note.trim() || null,
      });
      router.push(`/challan-doc/${id}`);
    });
    if (ok) setOpen(false);
    setBusy(false);
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Undo2 size={13} /> Return to supplier
      </Button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Return to supplier"
        subtitle={[challanNo, supplier].filter(Boolean).join(" · ")}
        width={460}
        footer={
          <>
            <Button variant="primary" onClick={submit} disabled={busy || total <= 0}>
              Create return
            </Button>
            <Button onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        }
      >
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value as ReturnReason)}>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>

        <div>
          <div className="mb-2 t-xs font-semibold uppercase tracking-wide text-t3">
            Quantity returned
          </div>
          <div className="space-y-1.5">
            {lines.map((l) => (
              <div key={l.id} className="flex items-center gap-2 t-sm">
                <span className="min-w-0 flex-1 truncate">
                  {l.name}
                  {l.colour && <span className="text-t3"> · {l.colour}</span>}
                </span>
                <span className="shrink-0 t-xs text-t3 tnum">
                  of {num(l.qty, 2)} {l.unit}
                </span>
                <input
                  type="number"
                  step="any"
                  min={0}
                  max={l.qty}
                  value={qty[l.id] ?? ""}
                  onChange={(e) => setQty((m) => ({ ...m, [l.id]: e.target.value }))}
                  className={inputClass("sm", "w-24 text-right tnum")}
                />
              </div>
            ))}
          </div>
        </div>

        <Field label="Note">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Sheet>
    </>
  );
}
