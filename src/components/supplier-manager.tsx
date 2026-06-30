"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupplier, updateSupplier } from "@/lib/actions";
import { Card, Badge } from "@/components/ui";
import { LookupSelect } from "@/components/masters/lookup-select";
import { Plus } from "lucide-react";
import type { LookupRow } from "@/lib/masters";

type Supplier = { id: number; name: string; type: string | null; city: string | null; phone: string | null; address?: string | null; email?: string | null; active: boolean; trims: number; orders: number };

export function SupplierManager({ suppliers, types = [] }: { suppliers: Supplier[]; types?: LookupRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createSupplier({ name, type: type || null, city: city || null, phone: phone || null, address: address || null, email: email || null });
      setName(""); setType(""); setCity(""); setPhone(""); setAddress(""); setEmail("");
      router.refresh();
    } finally { setBusy(false); }
  }
  async function toggle(s: Supplier) {
    setBusy(true);
    try { await updateSupplier({ id: s.id, active: !s.active }); router.refresh(); } finally { setBusy(false); }
  }

  return (
    <>
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Supplier name" className="rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-primary" />
          <LookupSelect kind="SUPPLIER_TYPE" options={types} value={type} onChange={setType} placeholder="Type…" className="rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-primary" />
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-primary" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-primary" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (for PO)" className="rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-primary" />
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address (for PO)" className="rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-primary" />
          <button onClick={add} disabled={busy || !name.trim()} className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40 md:col-span-3"><Plus size={14} /> Add supplier</button>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-semibold">Supplier</th>
              <th className="px-4 py-2.5 font-semibold">Type</th>
              <th className="px-4 py-2.5 font-semibold">City</th>
              <th className="px-4 py-2.5 font-semibold">Phone</th>
              <th className="px-4 py-2.5 text-right font-semibold">Trims</th>
              <th className="px-4 py-2.5 text-right font-semibold">Orders</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id} className={`border-b border-slate-50 last:border-0 ${s.active ? "" : "opacity-50"}`}>
                <td className="px-4 py-2.5 font-semibold">{s.name}</td>
                <td className="px-4 py-2.5 text-slate-500">{s.type ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-500">{s.city ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-500">{s.phone ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tnum text-slate-500">{s.trims}</td>
                <td className="px-4 py-2.5 text-right tnum text-slate-500">{s.orders}</td>
                <td className="px-4 py-2.5">
                  <button onClick={() => toggle(s)} disabled={busy}>
                    {s.active ? <Badge tone="ok">Active</Badge> : <Badge tone="default">Inactive</Badge>}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
