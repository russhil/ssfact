"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adjustFabricStock, adjustTrimStock, type AdjustReason } from "@/lib/actions";
import { Button, Field, Input, Select, Sheet } from "@/components/ui";
import { num } from "@/lib/format";
import { SlidersHorizontal } from "lucide-react";

/**
 * Change 22 Part E — the one honest stock-correction door, for fabric AND trims.
 *
 * The boxman counts racks daily and needs to write off damage, set an opening figure, or
 * fix a miscount. This never overwrites a balance: it computes the delta to the counted
 * figure and POSTS it through the shared ledger with a reason, so the movement is recorded
 * and is itself reversible. Negatives are allowed — a real over-issue is real.
 *
 * Replaces the UI callers of setFabricColorStock (a silent overwrite with no movement) and
 * gives trims the correction path they never had.
 */

const REASONS: { value: AdjustReason; label: string }[] = [
  { value: "COUNT", label: "Physical count" },
  { value: "DAMAGE", label: "Damage" },
  { value: "WASTAGE", label: "Wastage" },
  { value: "OPENING", label: "Opening stock" },
  { value: "OTHER", label: "Other" },
];

type Target =
  | { kind: "fabric"; fabricId: number; colour: string }
  | { kind: "trim"; trimItemId: number };

export function StockAdjust({
  target,
  name,
  current,
  unit,
  size = "sm",
}: {
  target: Target;
  /** what's being adjusted, for the sheet title, e.g. "Interlock · BLACK" */
  name: string;
  current: number;
  unit?: string | null;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"set" | "delta">("set");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<AdjustReason>("COUNT");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const entered = qty.trim() === "" ? null : Number(qty);
  const valid = entered != null && Number.isFinite(entered);
  // Preview the movement before it is posted — the staffer should see the delta and the
  // resulting balance, not discover them afterwards.
  const delta = !valid ? 0 : mode === "set" ? Math.round((entered - current) * 100) / 100 : entered;
  const after = Math.round((current + delta) * 100) / 100;

  function reset() {
    setQty("");
    setNote("");
    setReason("COUNT");
    setMode("set");
  }

  async function save() {
    if (!valid || Math.abs(delta) < 0.005) return;
    setBusy(true);
    try {
      const payload = mode === "set" ? { newQty: entered! } : { delta: entered! };
      if (target.kind === "fabric") {
        await adjustFabricStock({ fabricId: target.fabricId, colour: target.colour, reason, note: note.trim() || null, ...payload });
      } else {
        await adjustTrimStock({ trimItemId: target.trimItemId, reason, note: note.trim() || null, ...payload });
      }
      setOpen(false);
      reset();
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const u = unit ? ` ${unit.toLowerCase()}` : "";

  return (
    <>
      <Button variant="ghost" size={size} onClick={() => setOpen(true)} title="Adjust stock">
        <SlidersHorizontal size={13} /> Adjust
      </Button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Adjust stock"
        subtitle={name}
        footer={
          <>
            <Button
              variant="primary"
              className="flex-1"
              onClick={save}
              disabled={busy || !valid || Math.abs(delta) < 0.005}
            >
              {busy ? "Posting…" : "Post adjustment"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="flex items-baseline justify-between rounded-lg bg-surface-2 px-3 py-2.5">
          <span className="t-sm text-t2">In stock now</span>
          <span className={`t-head font-bold tnum ${current <= 0 ? "text-danger" : ""}`}>
            {num(current)}
            {u}
          </span>
        </div>

        <Field label="Correction type">
          <Select value={mode} onChange={(e) => setMode(e.target.value as "set" | "delta")}>
            <option value="set">Set to the counted figure</option>
            <option value="delta">Add / remove a quantity</option>
          </Select>
        </Field>

        <Field label={mode === "set" ? "Counted quantity" : "Change (negative removes)"}>
          <Input
            type="number"
            step="any"
            autoFocus
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder={mode === "set" ? String(current) : "0"}
            className="text-right tnum"
          />
        </Field>

        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value as AdjustReason)}>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Note" hint="Optional">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="—" />
        </Field>

        {valid && Math.abs(delta) >= 0.005 && (
          <div className="rounded-lg border border-border px-3 py-2.5 t-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-t2">Movement posted</span>
              <span className={`font-bold tnum ${delta > 0 ? "text-ok" : "text-warn"}`}>
                {delta > 0 ? "+" : "−"}
                {num(Math.abs(delta))}
                {u}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-t2">Stock after</span>
              <span className={`font-bold tnum ${after < 0 ? "text-danger" : ""}`}>
                {num(after)}
                {u}
              </span>
            </div>
            {after < 0 && (
              <p className="mt-1.5 t-xs text-danger">
                This leaves a negative balance.
              </p>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
