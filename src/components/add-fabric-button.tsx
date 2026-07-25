"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createFabric } from "@/lib/actions";
import { Card } from "@/components/ui";
import { Plus, X, Check } from "lucide-react";

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

/** Change 17 Part F: first-class "Add Fabric" entry on the fabric list (ADMIN/STAFF). */
export function AddFabricButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("MTR");
  const [gsm, setGsm] = useState("");
  const [width, setWidth] = useState("");
  const [form, setForm] = useState("");
  const [rate, setRate] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const { id } = await createFabric({
        name,
        unit: unit as "KG" | "MTR",
        gsm: numOrNull(gsm),
        rollWidth: numOrNull(width),
        form: (form || null) as "OPEN" | "TUBE" | null,
        ratePerUnit: numOrNull(rate),
      });
      setOpen(false);
      setName(""); setGsm(""); setWidth(""); setForm(""); setRate(""); setUnit("MTR");
      router.push(`/inventory/${id}`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add fabric");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 t-sm font-semibold text-accent-on shadow-sm transition hover:opacity-90">
          <Plus size={14} /> Add Fabric
        </button>
      </div>
    );
  }

  return (
    <Card className="w-full p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="t-body font-bold">New Fabric</h3>
        <button onClick={() => setOpen(false)} className="text-faint hover:text-danger"><X size={15} /></button>
      </div>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-6">
        <Labelled label="Name" wide>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Fabric name" className={inp} />
        </Labelled>
        <Labelled label="Unit">
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inp}>
            <option value="MTR">MTR</option>
            <option value="KG">KG</option>
          </select>
        </Labelled>
        <Labelled label="GSM"><input type="number" value={gsm} onChange={(e) => setGsm(e.target.value)} placeholder="—" className={inp} /></Labelled>
        <Labelled label="Roll width"><input type="number" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="—" className={inp} /></Labelled>
        <Labelled label="Form">
          <select value={form} onChange={(e) => setForm(e.target.value)} className={inp}>
            <option value="">—</option>
            <option value="OPEN">OPEN</option>
            <option value="TUBE">TUBE</option>
          </select>
        </Labelled>
        <Labelled label={`Est. price (₹/${unit.toLowerCase()})`}>
          <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="—" className={inp} />
        </Labelled>
      </div>
      {err && <p className="mt-2 t-sm text-danger">{err}</p>}
      <div className="mt-3 flex justify-end">
        <button onClick={save} disabled={busy || !name.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 t-body font-semibold text-accent-on disabled:opacity-40">
          <Check size={14} /> {busy ? "Saving…" : "Create fabric"}
        </button>
      </div>
    </Card>
  );
}

const inp = "w-full rounded-lg border border-border px-2.5 py-2 t-body outline-none focus:border-primary";

function Labelled({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <label className="mb-1 block t-micro font-semibold uppercase tracking-wide text-faint">{label}</label>
      {children}
    </div>
  );
}
