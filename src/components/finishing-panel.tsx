"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createFinishingJob,
  receiveFinishingJob,
  deleteFinishingJob,
  type FinishingProcessName,
} from "@/lib/actions";
import { Badge, Button, Card, Field, Input, Select, Sheet } from "@/components/ui";
import { num, fmtDate } from "@/lib/format";
import { Plus, PackageCheck, Trash2 } from "lucide-react";

/**
 * Change 20 Part C.1 — the finishing job-work panel on a job card.
 *
 * The needsPrint/needsLaser/needsEmb booleans stay (quick planning, back-compat);
 * these rows are the real record — who did it, which layers went out, how much
 * came back, at what rate, against which bill.
 *
 * Using it is optional. A card that never raises a JW- behaves exactly as before,
 * and nothing here moves fabric, trims or the dispatch balance.
 */

export const PROCESSES: FinishingProcessName[] = ["PRINT", "EMBROIDERY", "WASH", "SUBLIMATION", "LASER", "OTHER"];

export type FinishingRow = {
  id: number;
  docNo: string | null;
  process: string;
  status: string;
  vendor: string;
  layers: string[];
  issuedDate: string;
  receivedDate: string | null;
  qtyOut: number;
  qtyBack: number;
  rate: number | null;
  billNo: string | null;
  note: string | null;
};

export function FinishingPanel({
  jobCardId,
  siNo,
  rows,
  vendors,
  layers,
  canEdit,
  canSeeCost,
}: {
  jobCardId: number;
  siNo: string;
  rows: FinishingRow[];
  vendors: string[];
  layers: { id: number; label: string }[];
  canEdit: boolean;
  canSeeCost: boolean;
}) {
  const router = useRouter();
  const [give, setGive] = useState(false);
  const [receiving, setReceiving] = useState<FinishingRow | null>(null);
  const [busy, setBusy] = useState(false);

  const totalOut = rows.reduce((a, r) => a + r.qtyOut, 0);
  const totalBack = rows.reduce((a, r) => a + r.qtyBack, 0);
  const open = rows.filter((r) => r.status === "OPEN").length;

  async function remove(r: FinishingRow) {
    if (!confirm(`Delete ${r.docNo ?? "this job-work"}? Nothing has come back yet, so nothing is reversed.`)) return;
    setBusy(true);
    try {
      await deleteFinishingJob({ id: r.id });
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-3.5 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="t-body font-bold">
          Finishing job-work{" "}
          <span className="font-medium text-faint">
            · {rows.length} document{rows.length === 1 ? "" : "s"}
            {rows.length > 0 && ` · ${num(totalOut)} out · ${num(totalBack)} back`}
            {open > 0 && ` · ${open} open`}
          </span>
        </h3>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setGive(true)}>
            <Plus size={13} /> Give for finishing
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-center t-sm text-muted">
          No finishing given out for this card.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-micro uppercase tracking-wide text-faint">
                <th className="px-2 py-2 font-semibold">JW no</th>
                <th className="px-2 py-2 font-semibold">Process</th>
                <th className="px-2 py-2 font-semibold">Vendor</th>
                <th className="px-2 py-2 font-semibold">Layers</th>
                <th className="px-2 py-2 font-semibold">Issued</th>
                <th className="px-2 py-2 text-right font-semibold">Out</th>
                <th className="px-2 py-2 text-right font-semibold">Back</th>
                <th className="px-2 py-2 text-right font-semibold">Balance</th>
                {canSeeCost && <th className="px-2 py-2 text-right font-semibold">Rate</th>}
                <th className="px-2 py-2 font-semibold">Bill</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                {canEdit && <th className="px-2 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const bal = Math.round((r.qtyOut - r.qtyBack) * 100) / 100;
                return (
                  <tr key={r.id} className="border-b border-hairline last:border-0">
                    <td className="px-2 py-2 font-semibold text-primary-ink tnum">{r.docNo ?? `#${r.id}`}</td>
                    <td className="px-2 py-2 text-t2">{r.process}</td>
                    <td className="px-2 py-2">{r.vendor}</td>
                    <td className="px-2 py-2 text-faint">{r.layers.join(" + ") || "—"}</td>
                    <td className="px-2 py-2 text-t2 tnum">{fmtDate(r.issuedDate)}</td>
                    <td className="px-2 py-2 text-right font-semibold tnum">{num(r.qtyOut)}</td>
                    <td className="px-2 py-2 text-right tnum">{num(r.qtyBack)}</td>
                    {/* negative balance = more came back than went out; real, never clamped */}
                    <td className={`px-2 py-2 text-right font-bold tnum ${bal < 0 ? "text-ok" : bal > 0 ? "text-warn" : ""}`}>
                      {num(bal)}
                    </td>
                    {canSeeCost && <td className="px-2 py-2 text-right text-t2 tnum">{r.rate != null ? `₹${num(r.rate, 2)}` : "—"}</td>}
                    <td className="px-2 py-2 text-t2">{r.billNo ?? "—"}</td>
                    <td className="px-2 py-2">
                      <Badge tone={r.status === "CLOSED" ? "ok" : "warn"}>{r.status}</Badge>
                    </td>
                    {canEdit && (
                      <td className="px-2 py-2 text-right">
                        <span className="inline-flex items-center gap-2 no-print">
                          {r.status === "OPEN" && (
                            <button
                              onClick={() => setReceiving(r)}
                              className="inline-flex items-center gap-1 t-xs font-semibold text-primary-ink hover:underline"
                            >
                              <PackageCheck size={12} /> Receive back
                            </button>
                          )}
                          {r.qtyBack === 0 && (
                            <button
                              onClick={() => remove(r)}
                              disabled={busy}
                              title="Delete this job-work"
                              className="text-t3 hover:text-danger disabled:opacity-40"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <>
          <GiveSheet
            open={give}
            onClose={() => setGive(false)}
            jobCardId={jobCardId}
            siNo={siNo}
            vendors={vendors}
            layers={layers}
            canSeeCost={canSeeCost}
          />
          <ReceiveSheet job={receiving} onClose={() => setReceiving(null)} />
        </>
      )}
    </Card>
  );
}

function GiveSheet({
  open,
  onClose,
  jobCardId,
  siNo,
  vendors,
  layers,
  canSeeCost,
}: {
  open: boolean;
  onClose: () => void;
  jobCardId: number;
  siNo: string;
  vendors: string[];
  layers: { id: number; label: string }[];
  canSeeCost: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [process, setProcess] = useState<FinishingProcessName>("PRINT");
  const [vendor, setVendor] = useState(vendors[0] ?? "");
  const [qty, setQty] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [rate, setRate] = useState("");
  const [billNo, setBillNo] = useState("");
  const [issued, setIssued] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  async function save() {
    setBusy(true);
    try {
      const r = await createFinishingJob({
        jobCardId,
        vendorName: vendor,
        process,
        layerIds: picked,
        qtyOut: Number(qty) || 0,
        rate: canSeeCost && rate.trim() ? Number(rate) : null,
        billNo: billNo.trim() || null,
        issuedDate: issued,
        note: note.trim() || null,
      });
      onClose();
      setQty("");
      setPicked([]);
      setRate("");
      setBillNo("");
      setNote("");
      router.refresh();
      alert(`${r.docNo} raised.`);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Give for finishing"
      subtitle={siNo}
      width={440}
      footer={
        <>
          <Button variant="primary" className="flex-1" onClick={save} disabled={busy || !vendor || !(Number(qty) > 0)}>
            {busy ? "Raising…" : "Raise JW document"}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Process">
          <Select value={process} onChange={(e) => setProcess(e.target.value as FinishingProcessName)}>
            {PROCESSES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Issued date">
          <Input type="date" value={issued} onChange={(e) => setIssued(e.target.value)} />
        </Field>
      </div>

      <Field label="Vendor" required>
        <Select value={vendor} onChange={(e) => setVendor(e.target.value)}>
          {vendors.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      </Field>

      {layers.length > 0 && (
        <div>
          <div className="mb-1.5 t-xs font-semibold text-t2">Layers going out</div>
          <div className="flex flex-wrap gap-1.5">
            {layers.map((l) => {
              const on = picked.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setPicked((p) => (on ? p.filter((x) => x !== l.id) : [...p, l.id]))}
                  className={`rounded-full border px-2.5 py-1 t-xs font-semibold transition ${
                    on ? "border-accent bg-accent text-accent-on" : "border-border bg-surface text-t2 hover:bg-surface-2"
                  }`}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
          
        </div>
      )}

      <Field label="Pieces out" required>
        <Input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" className="text-right tnum" />
      </Field>

      {canSeeCost && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate (₹/pc)" hint="Owner only.">
            <Input type="number" step="any" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="—" className="text-right tnum" />
          </Field>
          <Field label="Bill no">
            <Input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="—" />
          </Field>
        </div>
      )}
      {!canSeeCost && (
        <Field label="Bill no">
          <Input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="—" />
        </Field>
      )}

      <Field label="Note">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="—" />
      </Field>

      <p className="t-xs text-t3">
        
      </p>
    </Sheet>
  );
}

function ReceiveSheet({ job, onClose }: { job: FinishingRow | null; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState("");
  const [billNo, setBillNo] = useState("");
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 10));

  const outstanding = job ? Math.round((job.qtyOut - job.qtyBack) * 100) / 100 : 0;
  const entered = Number(qty) || 0;
  const after = job ? Math.round((job.qtyBack + entered) * 100) / 100 : 0;

  async function save() {
    if (!job || !entered) return;
    setBusy(true);
    try {
      const r = await receiveFinishingJob({
        id: job.id,
        qtyBack: entered,
        receivedDate: when,
        billNo: billNo.trim() || undefined,
      });
      onClose();
      setQty("");
      setBillNo("");
      router.refresh();
      if (r.closed) alert(`${r.docNo} fully received — closed.`);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={!!job}
      onClose={onClose}
      title={`Receive back ${job?.docNo ?? ""}`}
      subtitle={job ? `${job.process} · ${job.vendor}` : undefined}
      width={400}
      footer={
        <>
          <Button variant="primary" className="flex-1" onClick={save} disabled={busy || !entered}>
            {busy ? "Saving…" : "Log receipt"}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="flex items-baseline justify-between rounded-lg bg-surface-2 px-3 py-2.5 t-sm">
        <span className="text-t2">Still out</span>
        <span className="t-head font-bold tnum">{num(outstanding)}</span>
      </div>

      <Field label="Pieces received now">
        <Input
          type="number"
          step="any"
          autoFocus
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder={String(outstanding)}
          className="text-right tnum"
        />
      </Field>

      <Field label="Received on">
        <Input type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>

      <Field label="Bill no">
        <Input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder={job?.billNo ?? "—"} />
      </Field>

      {job && entered > 0 && (
        <div className="rounded-lg border border-border px-3 py-2.5 t-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-t2">Total back after this</span>
            <span className="font-bold tnum">
              {num(after)} of {num(job.qtyOut)}
            </span>
          </div>
          {after > job.qtyOut && (
            <p className="mt-1 t-xs text-warn">
              More back than went out.
            </p>
          )}
          {after >= job.qtyOut && after <= job.qtyOut && (
            <p className="mt-1 t-xs text-ok">This closes the job-work.</p>
          )}
        </div>
      )}
    </Sheet>
  );
}
