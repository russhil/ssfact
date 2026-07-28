"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Field, Input, Select, Badge, StatCard } from "@/components/ui";
import { runAction } from "@/lib/action-result";
import {
  setSampleStatus, nextSampleRound,
  upsertSampleCostLine, deleteSampleCostLine,
  upsertSampleMeasurement, deleteSampleMeasurement,
} from "@/lib/actions";
import { inr, num, pct } from "@/lib/format";
import { SAMPLE_TONE } from "@/components/sample-manager";
import { Plus, X } from "lucide-react";

const FLOW = ["REQUESTED", "IN_PROGRESS", "SUBMITTED", "APPROVED", "REJECTED"] as const;
const LABEL = (s: string) => s.toLowerCase().replace("_", " ");
const KINDS = ["FABRIC", "TRIM", "CUTTING", "STITCHING", "FINISHING", "OVERHEAD", "OTHER"] as const;

export function SampleDetail({
  sample,
  costLines,
  measurements,
  owner,
  canStartBulk,
}: {
  sample: {
    id: number; code: string; name: string; round: number; status: string;
    notes: string | null; remark: string | null; targetMrp: number | null;
    vendor: string | null; cost: number; margin: number | null;
  };
  costLines: { id: number; kind: string; description: string; qty: number; rate: number }[];
  measurements: { id: number; pom: string; size: string; valueCm: number; tolerance: number | null }[];
  owner: boolean;
  canStartBulk: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [remark, setRemark] = useState("");

  // cost line draft
  const [kind, setKind] = useState<string>("FABRIC");
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("1");
  const [rate, setRate] = useState("");

  // measurement draft
  const [pom, setPom] = useState("");
  const [size, setSize] = useState("");
  const [cm, setCm] = useState("");
  const [tol, setTol] = useState("");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    const ok = await runAction(fn);
    setBusy(false);
    if (ok) router.refresh();
  };

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="t-body font-bold">Status</h3>
          <Badge tone={SAMPLE_TONE[sample.status] ?? "default"}>{LABEL(sample.status)}</Badge>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FLOW.map((st) => (
            <button
              key={st}
              disabled={busy || st === sample.status}
              onClick={() => {
                if (st === "REJECTED" && !remark.trim()) {
                  alert("Say why it was rejected first.");
                  return;
                }
                run(() => setSampleStatus({ id: sample.id, status: st, remark: remark.trim() || null }));
              }}
              className={`rounded-full border px-2.5 py-1 t-xs font-semibold ${
                st === sample.status ? "border-primary text-primary-ink" : "border-border text-t2 hover:bg-surface-2"
              } disabled:opacity-40`}
            >
              {LABEL(st)}
            </button>
          ))}
        </div>

        <Field label="Remark" className="mt-3">
          <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder={sample.remark ?? "why approved / rejected"} />
        </Field>
        {sample.remark && <p className="mt-1 t-xs text-t3">Last: {sample.remark}</p>}

        <Button className="mt-3" size="sm" variant="ghost" disabled={busy} onClick={() => run(() => nextSampleRound({ id: sample.id }))}>
          Start round {sample.round + 1}
        </Button>

        {canStartBulk && (
          <p className="mt-3 t-xs text-t3">
            Approved — “Start bulk” above opens a new job card pre-filled from this sample.
          </p>
        )}
      </Card>

      {owner && (
        <Card className="p-4">
          <h3 className="mb-3 t-body font-bold">Cost sheet</h3>
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="Cost" value={inr(sample.cost)} />
            <StatCard label="Target MRP" value={sample.targetMrp ? inr(sample.targetMrp) : "—"} />
            <StatCard
              label="Margin"
              value={sample.margin == null ? "—" : pct(sample.margin, 1)}
              tone={sample.margin != null && sample.margin < 0.15 ? "warn" : undefined}
            />
          </div>

          <div className="mt-3">
            {costLines.map((l) => (
              <div key={l.id} className="flex items-center gap-2 border-b border-hairline py-1.5 last:border-0 t-sm">
                <Badge tone="default">{LABEL(l.kind)}</Badge>
                <span className="min-w-0 flex-1 truncate">{l.description}</span>
                <span className="tnum text-t2">{num(l.qty, 2)} × {inr(l.rate)}</span>
                <span className="tnum font-semibold">{inr(l.qty * l.rate)}</span>
                <button className="text-faint hover:text-danger" disabled={busy} onClick={() => run(() => deleteSampleCostLine({ id: l.id, sampleId: sample.id }))}>
                  <X size={13} />
                </button>
              </div>
            ))}
            {costLines.length === 0 && <p className="py-3 text-center t-sm text-muted">No cost lines yet</p>}
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => <option key={k} value={k}>{LABEL(k)}</option>)}
            </Select>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="description" />
            <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="qty" className="text-right tnum" />
            <Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="rate" className="text-right tnum" />
          </div>
          <Button
            className="mt-2"
            size="sm"
            disabled={busy || !desc.trim()}
            onClick={() =>
              run(async () => {
                await upsertSampleCostLine({ sampleId: sample.id, kind, description: desc, qty: Number(qty) || 0, rate: Number(rate) || 0 });
                setDesc(""); setRate(""); setQty("1");
              })
            }
          >
            <Plus size={12} /> Add line
          </Button>
        </Card>
      )}

      <Card className={`p-4 ${owner ? "" : "lg:col-span-2"}`}>
        <h3 className="mb-3 t-body font-bold">Measurements</h3>
        <div className="max-h-64 overflow-y-auto">
          {measurements.map((m) => (
            <div key={m.id} className="flex items-center gap-2 border-b border-hairline py-1.5 last:border-0 t-sm">
              <span className="min-w-0 flex-1 truncate">{m.pom}</span>
              <Badge tone="default">{m.size}</Badge>
              <span className="tnum">{num(m.valueCm, 1)} cm</span>
              {m.tolerance != null && <span className="t-xs text-faint">±{num(m.tolerance, 1)}</span>}
              <button className="text-faint hover:text-danger" disabled={busy} onClick={() => run(() => deleteSampleMeasurement({ id: m.id, sampleId: sample.id }))}>
                <X size={13} />
              </button>
            </div>
          ))}
          {measurements.length === 0 && <p className="py-3 text-center t-sm text-muted">No measurements yet</p>}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <Input value={pom} onChange={(e) => setPom(e.target.value)} placeholder="point (e.g. Chest)" />
          <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="size" />
          <Input type="number" value={cm} onChange={(e) => setCm(e.target.value)} placeholder="cm" className="text-right tnum" />
          <Input type="number" value={tol} onChange={(e) => setTol(e.target.value)} placeholder="± tol" className="text-right tnum" />
        </div>
        <Button
          className="mt-2"
          size="sm"
          disabled={busy || !pom.trim() || !size.trim()}
          onClick={() =>
            run(async () => {
              await upsertSampleMeasurement({
                sampleId: sample.id, pom, size, valueCm: Number(cm) || 0,
                tolerance: tol.trim() === "" ? null : Number(tol),
              });
              setPom(""); setSize(""); setCm(""); setTol("");
            })
          }
        >
          <Plus size={12} /> Add measurement
        </Button>
      </Card>
    </div>
  );
}
