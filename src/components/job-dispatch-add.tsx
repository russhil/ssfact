"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addDispatch } from "@/lib/actions";

const inp = "rounded-md border border-border px-2 py-1.5 text-[12px] outline-none focus:border-primary";
const REASONS: ("ORDER" | "SALE" | "OTHER")[] = ["ORDER", "SALE", "OTHER"];

export function JobDispatchAdd({ jobCardId, defaultArrangedBy }: { jobCardId: number; defaultArrangedBy: string }) {
  const router = useRouter();
  const [qty, setQty] = useState("");
  const [date, setDate] = useState("");
  const [challan, setChallan] = useState("");
  const [reason, setReason] = useState<"ORDER" | "SALE" | "OTHER">("ORDER");
  const [busy, setBusy] = useState(false);

  async function log() {
    if (!qty || +qty === 0) return;
    setBusy(true);
    try {
      await addDispatch({ jobCardId, qty: +qty, date: date || undefined, challan: challan.trim() || undefined, reason, arrangedBy: defaultArrangedBy || null });
      setQty(""); setChallan(""); setDate("");
      router.refresh();
    } catch (e) {
      alert("Could not log: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-border p-2.5">
      <div className="mb-1.5 text-[11px] font-semibold text-slate-600">Log dispatch / production out</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="qty" className={`${inp} w-24 text-right tnum`} />
        <div className="flex rounded-md border border-border p-0.5">
          {REASONS.map((r) => (
            <button key={r} onClick={() => setReason(r)} className={`rounded px-2 py-1 text-[11px] font-semibold ${reason === r ? "bg-primary text-white" : "text-slate-500 hover:text-ink"}`}>{r}</button>
          ))}
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
        <input value={challan} onChange={(e) => setChallan(e.target.value)} placeholder="challan #" className={`${inp} w-28`} />
        <button onClick={log} disabled={busy || !qty} className="rounded-md bg-primary px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-40">
          Log
        </button>
      </div>
    </div>
  );
}
