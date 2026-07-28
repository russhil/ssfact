"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Field, Input, Select, Badge, Sheet } from "@/components/ui";
import { runAction } from "@/lib/action-result";
import { createInspection, voidInspection, sendToRework, receiveRework } from "@/lib/actions";
import { num, fmtDate } from "@/lib/format";
import { Plus } from "lucide-react";
import type { InspectionStatus } from "@/lib/quality";

export const STATUS_LABEL: Record<InspectionStatus, string> = {
  NONE: "Not inspected",
  PASS: "Passed",
  FAIL: "Failed",
  PARTIAL: "Partial",
  OPEN_REJECTS: "Rework out",
};

export const STATUS_TONE: Record<InspectionStatus, "ok" | "warn" | "danger" | "default"> = {
  NONE: "default",
  PASS: "ok",
  FAIL: "danger",
  PARTIAL: "warn",
  OPEN_REJECTS: "warn",
};

export function InspectionBadge({ status }: { status: InspectionStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

type Inspection = {
  id: number; at: Date; result: string; checkedQty: number; passQty: number;
  rejectQty: number; reworkQty: number; note: string | null; voidedAt: Date | null;
  inspectedBy: { displayName: string; username: string } | null;
  layer: { layerNo: number; label: string | null } | null;
  defects: { qty: number; defectType: { name: string; category: string } }[];
};

type ReworkRow = {
  id: number; docNo: string | null; at: Date; qty: number; qtyBack: number; status: string;
  vendor: { name: string } | null; layer: { layerNo: number; label: string | null } | null;
};

/**
 * Change 36 Part 3 — inspect, and route rejects to rework.
 *
 * ★ Nothing here blocks anything. It records what was found so the dispatch screen can
 * warn, and so the reports can say which vendor and which defect the rejects came from.
 */
export function InspectionPanel({
  jobCardId,
  layers,
  vendors,
  defectTypes,
  inspections,
  reworks,
}: {
  jobCardId: number;
  layers: { id: number; layerNo: number; label: string | null }[];
  vendors: string[];
  defectTypes: { id: number; name: string; category: string }[];
  inspections: Inspection[];
  reworks: ReworkRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rwOpen, setRwOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [layerId, setLayerId] = useState("");
  const [checked, setChecked] = useState("");
  const [pass, setPass] = useState("");
  const [reject, setReject] = useState("");
  const [rework, setRework] = useState("");
  const [note, setNote] = useState("");
  const [defects, setDefects] = useState<Record<number, string>>({});

  const [rwQty, setRwQty] = useState("");
  const [rwVendor, setRwVendor] = useState("");
  const [rwNote, setRwNote] = useState("");

  const n = (s: string) => (s.trim() === "" ? 0 : Number(s));
  const overflow = n(pass) + n(reject) + n(rework) > n(checked) && n(checked) > 0;

  async function saveInspection() {
    setBusy(true);
    const ok = await runAction(() =>
      createInspection({
        jobCardId,
        layerId: layerId ? Number(layerId) : null,
        checkedQty: n(checked), passQty: n(pass), rejectQty: n(reject), reworkQty: n(rework),
        note: note.trim() || null,
        defects: Object.entries(defects)
          .map(([id, q]) => ({ defectTypeId: Number(id), qty: n(q) }))
          .filter((d) => d.qty > 0),
      })
    );
    setBusy(false);
    if (ok) {
      setOpen(false);
      setChecked(""); setPass(""); setReject(""); setRework(""); setNote(""); setDefects({}); setLayerId("");
      router.refresh();
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="t-body font-bold">Quality</h3>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setOpen(true)}><Plus size={12} /> Inspect</Button>
          <Button size="sm" variant="ghost" onClick={() => setRwOpen(true)}>Send to rework</Button>
        </div>
      </div>

      {inspections.length === 0 && reworks.length === 0 && (
        <p className="py-6 text-center t-sm text-muted">No inspections yet</p>
      )}

      {inspections.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full t-sm">
            <thead>
              <tr className="t-micro font-bold uppercase tracking-wide text-faint">
                <th className="px-2 py-1.5 text-left">Date</th>
                <th className="px-2 py-1.5 text-left">Lay</th>
                <th className="px-2 py-1.5 text-right">Checked</th>
                <th className="px-2 py-1.5 text-right">Pass</th>
                <th className="px-2 py-1.5 text-right">Reject</th>
                <th className="px-2 py-1.5 text-right">Rework</th>
                <th className="px-2 py-1.5 text-left">Defects</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {inspections.map((i) => (
                <tr key={i.id} className={`border-t border-hairline ${i.voidedAt ? "opacity-45 line-through" : ""}`}>
                  <td className="whitespace-nowrap px-2 py-1.5 text-t2">{fmtDate(i.at)}</td>
                  <td className="px-2 py-1.5 text-t2">{i.layer ? i.layer.label || `L${i.layer.layerNo}` : "card"}</td>
                  <td className="px-2 py-1.5 text-right tnum">{num(i.checkedQty)}</td>
                  <td className="px-2 py-1.5 text-right tnum text-ok">{num(i.passQty)}</td>
                  <td className="px-2 py-1.5 text-right tnum text-danger">{num(i.rejectQty)}</td>
                  <td className="px-2 py-1.5 text-right tnum text-warn">{num(i.reworkQty)}</td>
                  <td className="px-2 py-1.5 text-t2">
                    {i.defects.length ? i.defects.map((d) => `${d.defectType.name} ${num(d.qty)}`).join(", ") : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {!i.voidedAt && (
                      <button
                        className="t-xs text-faint hover:text-danger"
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm("Void this inspection? It stops counting but stays on the record.")) return;
                          setBusy(true);
                          const ok = await runAction(() => voidInspection({ id: i.id }));
                          setBusy(false);
                          if (ok) router.refresh();
                        }}
                      >
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reworks.length > 0 && (
        <div className="mt-3 border-t border-hairline pt-3">
          <h4 className="mb-2 t-sm font-bold text-t1">Rework</h4>
          {reworks.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 border-b border-hairline py-1.5 last:border-0 t-sm">
              <span>
                <b>{r.docNo ?? `#${r.id}`}</b>
                <span className="ml-1.5 text-t3">{r.vendor?.name ?? "—"}</span>
              </span>
              <span className="tnum text-t2">{num(r.qtyBack)} / {num(r.qty)} back</span>
              {r.status === "OPEN" ? (
                <button
                  className="t-xs font-semibold text-primary-ink hover:underline"
                  disabled={busy}
                  onClick={async () => {
                    const v = prompt(`How many pieces came back on ${r.docNo}?`, String(r.qty - r.qtyBack));
                    if (!v) return;
                    setBusy(true);
                    const ok = await runAction(() => receiveRework({ id: r.id, qtyBack: Number(v) }));
                    setBusy(false);
                    if (ok) router.refresh();
                  }}
                >
                  Receive
                </button>
              ) : (
                <Badge tone="ok">Closed</Badge>
              )}
            </div>
          ))}
        </div>
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Inspect"
        subtitle="Pass, reject and rework counts"
        width={420}
        footer={
          <>
            <Button className="flex-1" onClick={saveInspection} disabled={busy || !checked || overflow}>
              {busy ? "Saving…" : "Save inspection"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          </>
        }
      >
        {layers.length > 0 && (
          <Field label="Lay (optional)">
            <Select value={layerId} onChange={(e) => setLayerId(e.target.value)}>
              <option value="">whole card</option>
              {layers.map((l) => <option key={l.id} value={l.id}>{l.label || `Layer ${l.layerNo}`}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Checked"><Input type="number" value={checked} onChange={(e) => setChecked(e.target.value)} className="text-right tnum" /></Field>
          <Field label="Pass"><Input type="number" value={pass} onChange={(e) => setPass(e.target.value)} className="text-right tnum" /></Field>
          <Field label="Reject"><Input type="number" value={reject} onChange={(e) => setReject(e.target.value)} className="text-right tnum" /></Field>
          <Field label="Rework"><Input type="number" value={rework} onChange={(e) => setRework(e.target.value)} className="text-right tnum" /></Field>
        </div>
        {overflow && <p className="t-xs text-danger">Pass + reject + rework is more than the checked quantity.</p>}

        {defectTypes.length > 0 && (
          <>
            <p className="mt-2 t-micro font-bold uppercase tracking-wide text-faint">Defects</p>
            <div className="grid grid-cols-2 gap-2">
              {defectTypes.map((d) => (
                <Field key={d.id} label={d.name}>
                  <Input
                    type="number"
                    value={defects[d.id] ?? ""}
                    onChange={(e) => setDefects((p) => ({ ...p, [d.id]: e.target.value }))}
                    className="text-right tnum"
                    placeholder="—"
                  />
                </Field>
              ))}
            </div>
          </>
        )}
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Sheet>

      <Sheet
        open={rwOpen}
        onClose={() => setRwOpen(false)}
        title="Send to rework"
        subtitle="Tracking only — no stock moves"
        width={380}
        footer={
          <>
            <Button
              className="flex-1"
              disabled={busy || !rwQty}
              onClick={async () => {
                setBusy(true);
                const ok = await runAction(() =>
                  sendToRework({ jobCardId, qty: Number(rwQty), vendorName: rwVendor || null, note: rwNote.trim() || null })
                );
                setBusy(false);
                if (ok) { setRwOpen(false); setRwQty(""); setRwVendor(""); setRwNote(""); router.refresh(); }
              }}
            >
              {busy ? "Saving…" : "Send"}
            </Button>
            <Button variant="ghost" onClick={() => setRwOpen(false)} disabled={busy}>Cancel</Button>
          </>
        }
      >
        <Field label="Pieces"><Input type="number" value={rwQty} onChange={(e) => setRwQty(e.target.value)} className="text-right tnum" /></Field>
        <Field label="Vendor">
          <Select value={rwVendor} onChange={(e) => setRwVendor(e.target.value)}>
            <option value="">—</option>
            {vendors.map((v) => <option key={v}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Note"><Input value={rwNote} onChange={(e) => setRwNote(e.target.value)} /></Field>
      </Sheet>
    </Card>
  );
}
