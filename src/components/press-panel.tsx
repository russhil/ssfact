"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Badge } from "@/components/ui";
import { num, fmtDate } from "@/lib/format";
import { createPressOutward, createPressInward, voidPressChallan } from "@/lib/actions";
import type { JobPress } from "@/lib/press";
import { Printer } from "lucide-react";

/**
 * Change 40 Part K — the Pressing section inside a job card. Outward: pick a vendor's unused
 * layers, see the pooled pieces, type how many are actually going, print and hand over. Inward:
 * answer an outward with one total. A layer sits on only one live outward; used ones are shown
 * disabled. Moves no stock — a tracking document only.
 */
export function PressPanel({ jobCardId, press }: { jobCardId: number; press: JobPress }) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "out" | "in">("none");

  const openOutwards = press.docs.filter((d) => d.direction === "OUT" && !d.voidedAt);

  return (
    <Card className="mt-3.5 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="t-body font-bold">Pressing</h3>
        <div className="flex gap-1.5">
          <button onClick={() => setMode(mode === "out" ? "none" : "out")} className="rounded-md bg-primary px-2.5 py-1 t-xs font-semibold text-accent-on hover:opacity-90">Log outward</button>
          <button onClick={() => setMode(mode === "in" ? "none" : "in")} disabled={openOutwards.length === 0} className="rounded-md border border-border px-2.5 py-1 t-xs font-semibold text-t1 hover:bg-surface-2 disabled:opacity-40">Log return</button>
        </div>
      </div>

      {press.totalOpenShortfall > 0 && (
        <div className="mb-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 t-xs font-medium text-warn">
          Pressing: {num(press.totalOpenShortfall)} pcs still open across this card&apos;s press outwards.
        </div>
      )}

      {mode === "out" && <OutwardForm jobCardId={jobCardId} press={press} onDone={() => { setMode("none"); router.refresh(); }} />}
      {mode === "in" && <InwardForm outwards={openOutwards} onDone={() => { setMode("none"); router.refresh(); }} />}

      {press.docs.length === 0 ? (
        <p className="py-3 text-center t-sm text-muted">No press documents yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-micro uppercase tracking-wide text-faint">
                <th className="px-2 py-2 font-semibold">Doc</th>
                <th className="px-2 py-2 font-semibold">Vendor</th>
                <th className="px-2 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 text-right font-semibold">Qty</th>
                <th className="px-2 py-2 text-right font-semibold">Open</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {press.docs.map((d) => (
                <PressRow key={d.id} d={d} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function PressRow({ d }: { d: JobPress["docs"][number] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const dead = !!d.voidedAt;
  async function doVoid() {
    if (!confirm(`Void ${d.docNo}? ${d.direction === "OUT" ? "Its layers become selectable again." : ""}`)) return;
    setBusy(true);
    try { await voidPressChallan({ id: d.id }); router.refresh(); } catch (e) { alert((e as Error).message); setBusy(false); }
  }
  return (
    <tr className={`border-b border-hairline last:border-0 ${dead ? "opacity-55" : ""}`}>
      <td className="px-2 py-1.5">
        <Link href={`/press-doc/${d.id}`} className="font-semibold text-primary-ink hover:underline">{d.docNo}</Link>{" "}
        <Badge tone={d.direction === "OUT" ? "warn" : "ok"}>{d.direction}</Badge>
        {d.direction === "OUT" && d.shortfall > 0 && !dead && <Badge tone="danger" className="ml-1">short {num(d.shortfall)}</Badge>}
      </td>
      <td className="px-2 py-1.5 text-t2">{d.vendorName}</td>
      <td className="px-2 py-1.5 text-t2 tnum">{fmtDate(d.date)}</td>
      <td className={`px-2 py-1.5 text-right font-semibold tnum ${dead ? "line-through" : ""}`}>{num(d.qty)}</td>
      <td className="px-2 py-1.5 text-right tnum text-t2">{d.direction === "OUT" && !dead ? num(d.openReturn) : "—"}</td>
      <td className="px-2 py-1.5 text-right">
        <div className="flex items-center justify-end gap-2">
          {!dead && <button onClick={doVoid} disabled={busy} className="t-xs font-semibold text-danger disabled:opacity-40">Void</button>}
          <Link href={`/press-doc/${d.id}`} className="inline-flex items-center gap-1 t-xs font-medium text-t2"><Printer size={12} /> open</Link>
        </div>
      </td>
    </tr>
  );
}

function OutwardForm({ jobCardId, press, onDone }: { jobCardId: number; press: JobPress; onDone: () => void }) {
  const [vendorId, setVendorId] = useState<number | null>(press.vendors.length === 1 ? press.vendors[0].vendorId : null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);

  const vendor = useMemo(() => press.vendors.find((v) => v.vendorId === vendorId) ?? null, [press.vendors, vendorId]);
  const selectable = vendor?.layers ?? [];
  const selectedLayers = selectable.filter((l) => picked.has(l.id));
  const pooled = selectedLayers.reduce((a, l) => a + l.pieces, 0);

  function toggle(id: number) {
    setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function save() {
    if (!vendorId || selectedLayers.length === 0 || !qty || +qty <= 0) return;
    setBusy(true);
    try {
      await createPressOutward({ jobCardId, vendorId, layerIds: [...picked], qty: +qty });
      onDone();
    } catch (e) { alert((e as Error).message); setBusy(false); }
  }

  return (
    <div className="mb-3 rounded-lg border border-dashed border-border p-3">
      <div className="mb-2 t-xs font-semibold text-t1">Log garments for pressing</div>
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="t-micro font-semibold uppercase tracking-wide text-faint">Vendor (stitcher)</span>
          <select value={vendorId ?? ""} onChange={(e) => { setVendorId(e.target.value ? +e.target.value : null); setPicked(new Set()); }} className="rounded-lg border border-border px-2.5 py-1.5 t-sm outline-none focus:border-primary">
            <option value="">— pick vendor —</option>
            {press.vendors.map((v) => <option key={v.vendorId} value={v.vendorId}>{v.vendorName}</option>)}
          </select>
        </label>
        <div className="flex items-end gap-4 rounded-lg border border-border bg-surface-2 px-3 py-1.5">
          <div><div className="t-micro text-faint">Layers</div><div className="font-bold tnum">{selectedLayers.length}</div></div>
          <div><div className="t-micro text-faint">Pieces (cut)</div><div className="font-bold tnum">{num(pooled)}</div></div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="t-micro font-semibold uppercase tracking-wide text-faint">Sending</span>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="pieces" className="w-28 rounded-lg border border-border px-2.5 py-1.5 text-right t-sm tnum outline-none focus:border-primary" />
        </label>
        <button onClick={save} disabled={busy || !vendorId || selectedLayers.length === 0 || !qty} className="ml-auto rounded-md bg-primary px-3 py-2 t-sm font-semibold text-accent-on disabled:opacity-40">{busy ? "Saving…" : "Create & print"}</button>
      </div>

      {vendor && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {selectable.map((l) => {
            const used = l.usedByDocNo != null;
            return (
              <button
                key={l.id}
                type="button"
                disabled={used}
                onClick={() => toggle(l.id)}
                title={used ? `on ${l.usedByDocNo}` : ""}
                className={`rounded-md border px-2 py-1 t-xs font-medium ${used ? "cursor-not-allowed border-border bg-surface-2 text-faint line-through" : picked.has(l.id) ? "border-primary bg-primary-soft text-primary-ink" : "border-border text-t1 hover:bg-surface-2"}`}
              >
                {l.label || `Layer ${l.layerNo}`} · {num(l.pieces)}{used ? ` · ${l.usedByDocNo}` : ""}
              </button>
            );
          })}
          {selectable.length === 0 && <span className="t-xs text-faint">This vendor has no layers on this card.</span>}
        </div>
      )}
      {pooled > 0 && +qty > 0 && +qty !== pooled && (
        <p className="mt-2 t-xs text-warn">Selected {num(pooled)} cut · sending {num(+qty)} · {(+qty < pooled ? `short ${num(pooled - +qty)}` : `over ${num(+qty - pooled)}`)} — shown, never blocked.</p>
      )}
    </div>
  );
}

function InwardForm({ outwards, onDone }: { outwards: JobPress["docs"]; onDone: () => void }) {
  const [outId, setOutId] = useState<number | null>(outwards.length === 1 ? outwards[0].id : null);
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = outwards.find((o) => o.id === outId) ?? null;

  async function save() {
    if (!outId || !qty || +qty <= 0) return;
    setBusy(true);
    try { await createPressInward({ pressOutId: outId, qty: +qty }); onDone(); } catch (e) { alert((e as Error).message); setBusy(false); }
  }

  return (
    <div className="mb-3 rounded-lg border border-dashed border-border p-3">
      <div className="mb-2 t-xs font-semibold text-t1">Log return from pressing</div>
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="t-micro font-semibold uppercase tracking-wide text-faint">Answers outward</span>
          <select value={outId ?? ""} onChange={(e) => setOutId(e.target.value ? +e.target.value : null)} className="rounded-lg border border-border px-2.5 py-1.5 t-sm outline-none focus:border-primary">
            <option value="">— pick outward —</option>
            {outwards.map((o) => <option key={o.id} value={o.id}>{o.docNo} · {o.vendorName} · sent {num(o.qty)} · open {num(o.openReturn)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="t-micro font-semibold uppercase tracking-wide text-faint">Received back</span>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="pieces" className="w-28 rounded-lg border border-border px-2.5 py-1.5 text-right t-sm tnum outline-none focus:border-primary" />
        </label>
        <button onClick={save} disabled={busy || !outId || !qty} className="ml-auto rounded-md bg-primary px-3 py-2 t-sm font-semibold text-accent-on disabled:opacity-40">{busy ? "Saving…" : "Log return"}</button>
      </div>
      {chosen && <p className="mt-2 t-xs text-faint">Prints an empty size×colour sheet for the pressing staff to fill by hand.</p>}
    </div>
  );
}
