"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setJobCardOpen, updateJobCard, deleteJobCard } from "@/lib/actions";
import { Button, Field, Input, Sheet } from "@/components/ui";
import { Lock, LockOpen, Pencil, Trash2 } from "lucide-react";

/**
 * Change 22 Part C — the job card stops being a one-way door.
 *
 * Until now only createJobCard existed: a card raised by mistake was permanent, its header
 * fields couldn't be corrected, and a card closed by over-dispatch had no way back.
 *
 * Deliberately NOT here: the cut matrix and the product. Changing those changes fabric and
 * trim needs, and quantity changes already have a home in "Add split / re-cut". A metadata
 * edit must never silently re-post stock.
 */

export type JobCardEditable = {
  id: number;
  siNo: string;
  status: string;
  hasProduct: boolean;
  plannedEtd: string | null; // yyyy-mm-dd
  merchandiser: string | null;
  remark: string | null;
  needsPrint: boolean;
  needsLaser: boolean;
  needsEmb: boolean;
  customItem: string | null;
  customSku: string | null;
  customStyle: string | null;
  mrp: number | null;
  customMrp: number | null;
  /** live (non-voided) dispatch count — a card with these can't be deleted */
  liveDispatches: number;
  /** locked, non-voided challans raised against the card */
  lockedChallans: number;
};

export function JobCardActions({ job, canSeeCost }: { job: JobCardEditable; canSeeCost: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [siNo, setSiNo] = useState(job.siNo);
  const [etd, setEtd] = useState(job.plannedEtd ?? "");
  const [merch, setMerch] = useState(job.merchandiser ?? "");
  const [remark, setRemark] = useState(job.remark ?? "");
  const [flags, setFlags] = useState({ print: job.needsPrint, laser: job.needsLaser, emb: job.needsEmb });
  const [item, setItem] = useState(job.customItem ?? "");
  const [sku, setSku] = useState(job.customSku ?? "");
  const [style, setStyle] = useState(job.customStyle ?? "");
  const [mrp, setMrp] = useState(job.mrp != null ? String(job.mrp) : "");
  const [customMrp, setCustomMrp] = useState(job.customMrp != null ? String(job.customMrp) : "");

  const closed = job.status === "CLOSED";
  const blocked = job.liveDispatches > 0 || job.lockedChallans > 0;

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    try {
      await fn();
      after?.();
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
    await run(
      () =>
        updateJobCard({
          id: job.id,
          siNo: siNo.trim(),
          plannedEtd: etd || null,
          merchandiser: merch.trim() || null,
          remark: remark.trim() || null,
          needsPrint: flags.print,
          needsLaser: flags.laser,
          needsEmb: flags.emb,
          ...(job.hasProduct ? {} : { customItem: item.trim() || null, customSku: sku.trim() || null, customStyle: style.trim() || null }),
          ...(canSeeCost ? { mrp: numOrNull(mrp), ...(job.hasProduct ? {} : { customMrp: numOrNull(customMrp) }) } : {}),
        }),
      () => setOpen(false)
    );
  }

  async function remove() {
    const warning = [
      `Delete job card ${job.siNo}?`,
      "",
      "This will reverse every stock movement the card posted — the fabric it issued for cutting goes back to that colour's stock — and remove its layers, fabric lines, BOM snapshot and any draft trim challan.",
      "",
      "This cannot be undone.",
    ].join("\n");
    if (!confirm(warning)) return;
    setBusy(true);
    try {
      await deleteJobCard({ id: job.id });
      router.push("/job-cards");
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <span className="inline-flex items-center gap-1.5 no-print">
        {/* Change 22 B.3: explicit reopen/close, for the card that closed on over-dispatch
            while work remains. */}
        <button
          onClick={() => run(() => setJobCardOpen({ id: job.id, open: closed }))}
          disabled={busy}
          title={closed ? "Reopen this card" : "Close this card"}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 t-xs font-semibold text-t2 hover:bg-surface-2 disabled:opacity-40"
        >
          {closed ? <LockOpen size={12} /> : <Lock size={12} />}
          {closed ? "Reopen" : "Close"}
        </button>
        <button
          onClick={() => setOpen(true)}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 t-xs font-semibold text-t2 hover:bg-surface-2 disabled:opacity-40"
        >
          <Pencil size={12} /> Edit details
        </button>
      </span>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Edit ${job.siNo}`}
        subtitle="Header details"
        width={440}
        footer={
          <>
            <Button variant="primary" className="flex-1" onClick={save} disabled={busy || !siNo.trim()}>
              {busy ? "Saving…" : "Save details"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="SI" required>
            <Input value={siNo} onChange={(e) => setSiNo(e.target.value)} />
          </Field>
          <Field label="Planned ETD">
            <Input type="date" value={etd} onChange={(e) => setEtd(e.target.value)} />
          </Field>
        </div>

        <Field label="Merchandiser">
          <Input value={merch} onChange={(e) => setMerch(e.target.value)} placeholder="—" />
        </Field>

        <Field label="Remark">
          <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="—" />
        </Field>

        <div>
          <div className="mb-1.5 t-xs font-semibold text-t2">Process</div>
          <div className="flex flex-wrap gap-1.5">
            {([["print", "PRINT"], ["laser", "LASER"], ["emb", "EMB"]] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFlags((f) => ({ ...f, [k]: !f[k] }))}
                className={`rounded-full border px-2.5 py-1 t-xs font-bold transition ${
                  flags[k]
                    ? "border-accent bg-accent text-accent-on"
                    : "border-border bg-surface text-t3 line-through decoration-t3"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {!job.hasProduct && (
          <>
            <Field label="Item">
              <Input value={item} onChange={(e) => setItem(e.target.value)} placeholder="e.g. JHARKHAND TRACKSUIT" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SKU">
                <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="ORDER / TBC" />
              </Field>
              <Field label="Style">
                <Input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="#1202" />
              </Field>
            </div>
          </>
        )}

        {canSeeCost && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="MRP" hint="Owner only.">
              <Input type="number" step="any" value={mrp} onChange={(e) => setMrp(e.target.value)} placeholder="—" className="text-right tnum" />
            </Field>
            {!job.hasProduct && (
              <Field label="Custom MRP">
                <Input type="number" step="any" value={customMrp} onChange={(e) => setCustomMrp(e.target.value)} placeholder="—" className="text-right tnum" />
              </Field>
            )}
          </div>
        )}

        {/* Change 22 C.1 — deleting is a stock event, so it lives behind the same panel that
            explains what it will reverse, and is refused outright while goods have moved. */}
        <div className="mt-2 rounded-lg border border-danger/30 bg-danger-soft/40 p-3">
          <div className="t-xs font-bold uppercase tracking-wide text-danger">Delete this card</div>
          <p className="mt-1 t-xs text-t2">
            {blocked ? (
              <>
                Blocked:{" "}
                {[
                  job.liveDispatches > 0 && `${job.liveDispatches} live dispatch${job.liveDispatches === 1 ? "" : "es"}`,
                  job.lockedChallans > 0 && `${job.lockedChallans} locked challan${job.lockedChallans === 1 ? "" : "s"}`,
                ]
                  .filter(Boolean)
                  .join(" and ")}{" "}
                against this card. Void {job.liveDispatches > 0 && job.lockedChallans > 0 ? "them" : "it"} first.
              </>
            ) : (
              <>Reverses the fabric this card issued and removes its layers, lines and draft challan.</>
            )}
          </p>
          <Button variant="danger" size="sm" className="mt-2" onClick={remove} disabled={busy || blocked}>
            <Trash2 size={13} /> Delete {job.siNo}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
