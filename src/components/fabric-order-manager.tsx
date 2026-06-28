"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createFabricOrder, receiveFabricOrder } from "@/lib/actions";
import { Card, Badge } from "@/components/ui";
import { num, fmtDate } from "@/lib/format";
import { Plus, Check } from "lucide-react";

type Order = { id: number; fabric: string; color: string | null; supplier: string | null; qty: number; unit: string; rate: number | null; status: string; expectedDate: Date | string | null; receivedDate: Date | string | null };
type Pick = { id: number; name: string };

const STATUS_TONE: Record<string, "primary" | "warn" | "ok" | "default" | "danger"> = {
  PLANNING: "default", SAMPLE_PENDING: "warn", ORDER_PLACED: "primary", RECEIVED: "ok", DISCARDED: "danger",
};

export function FabricOrderManager({ orders, fabrics, suppliers }: { orders: Order[]; fabrics: Pick[]; suppliers: Pick[] }) {
  const router = useRouter();
  const [fabricId, setFabricId] = useState("");
  const [color, setColor] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [expected, setExpected] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!fabricId || !(+qty > 0)) return;
    setBusy(true);
    try {
      await createFabricOrder({ fabricId: +fabricId, color: color || null, supplierId: supplierId ? +supplierId : null, qty: +qty, rate: rate ? +rate : null, expectedDate: expected || null, status: "ORDER_PLACED" });
      setColor(""); setQty(""); setRate(""); setExpected("");
      router.refresh();
    } finally { setBusy(false); }
  }
  async function receive(id: number) {
    setBusy(true);
    try { await receiveFabricOrder({ id }); router.refresh(); } finally { setBusy(false); }
  }

  return (
    <>
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1.5fr_1fr_1.3fr_0.8fr_0.8fr_1fr_auto]">
          <select value={fabricId} onChange={(e) => setFabricId(e.target.value)} className="rounded-lg border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary">
            <option value="">Fabric…</option>
            {fabrics.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Colour" className="rounded-lg border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary" />
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="rounded-lg border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary">
            <option value="">Supplier…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" className="rounded-lg border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary" />
          <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Rate" className="rounded-lg border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary" />
          <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className="rounded-lg border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary" />
          <button onClick={add} disabled={busy || !fabricId || !(+qty > 0)} className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40"><Plus size={14} /> Order</button>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-semibold">Fabric</th>
              <th className="px-4 py-2.5 font-semibold">Colour</th>
              <th className="px-4 py-2.5 font-semibold">Supplier</th>
              <th className="px-4 py-2.5 text-right font-semibold">Qty</th>
              <th className="px-4 py-2.5 font-semibold">Expected</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-2.5 font-semibold">{o.fabric}</td>
                <td className="px-4 py-2.5 text-slate-500">{o.color ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-500">{o.supplier ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tnum">{num(o.qty)} {o.unit.toLowerCase()}</td>
                <td className="px-4 py-2.5 text-slate-500 tnum">{o.receivedDate ? `recv ${fmtDate(o.receivedDate)}` : fmtDate(o.expectedDate)}</td>
                <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[o.status] ?? "default"}>{o.status.replace("_", " ")}</Badge></td>
                <td className="px-4 py-2.5 text-right">
                  {o.status !== "RECEIVED" && o.status !== "DISCARDED" && (
                    <button onClick={() => receive(o.id)} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50"><Check size={12} /> Receive</button>
                  )}
                </td>
              </tr>
            ))}
            {orders.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">No fabric orders yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}
