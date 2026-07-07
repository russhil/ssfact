"use client";

import { useMemoKeyboardList } from "@/components/use-keyboard-list";
import { useMemo, useState } from "react";
import { getJobDispatchData } from "@/lib/actions";
import { num } from "@/lib/format";
import { Truck } from "lucide-react";
import { LayerDispatch, type DispatchLayer, type PriorDispatch } from "@/components/layer-dispatch";
import { cn } from "@/lib/cn";

export type DispatchJob = { id: number; siNo: string; item: string; vendor: string; balance: number };

export function DispatchForm({ jobs, defaultArrangedBy = "" }: { jobs: DispatchJob[]; defaultArrangedBy?: string }) {
  const [q, setQ] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [data, setData] = useState<{ layers: DispatchLayer[]; prior: PriorDispatch[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    const base = n ? jobs.filter((j) => j.siNo.toLowerCase().includes(n) || j.item.toLowerCase().includes(n)) : jobs;
    return base.slice(0, 6);
  }, [q, jobs]);

  const job = jobs.find((j) => j.id === jobId) ?? null;

  async function pick(m: DispatchJob) {
    setJobId(m.id);
    setQ(`${m.siNo} · ${m.item}`);
    setLoading(true);
    try {
      setData(await getJobDispatchData(m.id));
    } catch (e) {
      alert("Could not load layers: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const { activeIndex, onKeyDown } = useMemoKeyboardList(matches.length, (i) => matches[i] && pick(matches[i]), () => { setJobId(null); setData(null); });

  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <h3 className="mb-4 flex items-center gap-2 text-[13px] font-bold">
        <Truck size={15} className="text-primary" /> Log Dispatch
      </h3>

      <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Job Card</label>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setJobId(null); setData(null); }}
        onKeyDown={onKeyDown}
        placeholder="Search SI or item with open balance…"
        className="mb-2 w-full rounded-lg border border-border px-3 py-2.5 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-indigo-100"
      />

      {!job && (
        <div className="mb-3 max-h-52 overflow-auto rounded-lg border border-border">
          {matches.map((m, i) => (
            <button
              key={m.id}
              onClick={() => pick(m)}
              className={cn("flex w-full items-center justify-between border-b border-slate-50 px-3 py-2 text-left text-[12px] last:border-0 hover:bg-primary-soft", i === activeIndex && "bg-primary-soft")}
            >
              <span><b className="text-primary-ink">{m.siNo}</b> <span className="ml-1 text-slate-500">{m.item}</span> <span className="text-faint">· {m.vendor}</span></span>
              <span className="font-semibold text-faint tnum">bal {num(m.balance)}</span>
            </button>
          ))}
          {matches.length === 0 && <p className="px-3 py-4 text-center text-[12px] text-muted">No open job cards.</p>}
        </div>
      )}

      {job && (
        <div className="mb-1 rounded-lg bg-primary-soft px-3 py-2 text-[12px] text-primary-ink">
          <b>{job.siNo}</b> · {job.item} — balance <b className="tnum">{num(job.balance)}</b> pcs
        </div>
      )}
      {job && loading && <p className="py-3 text-center text-[12px] text-muted">Loading layers…</p>}
      {job && data && <LayerDispatch jobCardId={job.id} layers={data.layers} prior={data.prior} defaultArrangedBy={defaultArrangedBy} />}
    </div>
  );
}
