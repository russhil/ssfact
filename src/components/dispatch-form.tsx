"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDispatch } from "@/lib/actions";
import { num } from "@/lib/format";
import { Truck, Check } from "lucide-react";

export type DispatchJob = { id: number; siNo: string; item: string; vendor: string; balance: number };

export function DispatchForm({ jobs, defaultArrangedBy = "" }: { jobs: DispatchJob[]; defaultArrangedBy?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [qty, setQty] = useState(0);
  const [challan, setChallan] = useState("");
  const [by, setBy] = useState(defaultArrangedBy);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    const base = n ? jobs.filter((j) => j.siNo.toLowerCase().includes(n) || j.item.toLowerCase().includes(n)) : jobs;
    return base.slice(0, 6);
  }, [q, jobs]);

  const job = jobs.find((j) => j.id === jobId) ?? null;

  async function submit() {
    if (!job || qty <= 0) return;
    setSaving(true);
    try {
      const r = await addDispatch({ jobCardId: job.id, qty, challan: challan || undefined, arrangedBy: by || null });
      setDone(`Logged +${num(qty)} against ${r.siNo}${r.closed ? " — now closed ✅" : ""}`);
      setJobId(null);
      setQ("");
      setQty(0);
      setChallan("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <h3 className="mb-4 flex items-center gap-2 text-[13px] font-bold">
        <Truck size={15} className="text-primary" /> Log a Receipt
      </h3>

      <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Job Card</label>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setJobId(null); }}
        placeholder="Search SI or item with open balance…"
        className="mb-2 w-full rounded-lg border border-border px-3 py-2.5 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-indigo-100"
      />

      {!job && (
        <div className="mb-3 max-h-52 overflow-auto rounded-lg border border-border">
          {matches.map((m) => (
            <button
              key={m.id}
              onClick={() => { setJobId(m.id); setQ(`${m.siNo} · ${m.item}`); setQty(m.balance); }}
              className="flex w-full items-center justify-between border-b border-slate-50 px-3 py-2 text-left text-[12px] last:border-0 hover:bg-primary-soft"
            >
              <span><b className="text-primary-ink">{m.siNo}</b> <span className="ml-1 text-slate-500">{m.item}</span> <span className="text-faint">· {m.vendor}</span></span>
              <span className="font-semibold text-faint tnum">bal {num(m.balance)}</span>
            </button>
          ))}
          {matches.length === 0 && <p className="px-3 py-4 text-center text-[12px] text-muted">No open job cards.</p>}
        </div>
      )}

      {job && (
        <>
          <div className="mb-3 rounded-lg bg-primary-soft px-3 py-2 text-[12px] text-primary-ink">
            Balance to receive: <b className="tnum">{num(job.balance)}</b> pcs
          </div>
          <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Received Qty</label>
          <input
            type="number"
            value={qty}
            onChange={(e) => setQty(Math.min(job.balance, Math.max(0, +e.target.value)))}
            className="mb-3 w-full rounded-lg border border-border px-3 py-2.5 text-[13px] font-semibold outline-none focus:border-primary"
          />
          <div className="mb-3 grid grid-cols-2 gap-2">
            <input value={challan} onChange={(e) => setChallan(e.target.value)} placeholder="Challan #" className="rounded-lg border border-border px-3 py-2 text-[12px] outline-none focus:border-primary" />
            <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Arranged by" className="rounded-lg border border-border px-3 py-2 text-[12px] outline-none focus:border-primary" />
          </div>
        </>
      )}

      <button
        onClick={submit}
        disabled={!job || qty <= 0 || saving}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-indigo-600 disabled:opacity-40"
      >
        {saving ? "Logging…" : "Log Receipt"}
      </button>

      {done && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2 text-[12px] font-medium text-emerald-700">
          <Check size={14} /> {done}
        </div>
      )}
    </div>
  );
}
