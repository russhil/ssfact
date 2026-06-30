"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createTrim } from "@/lib/actions";
import { Card, Badge } from "@/components/ui";
import { LookupSelect } from "@/components/masters/lookup-select";
import { num } from "@/lib/format";
import { Plus } from "lucide-react";
import type { TrimMasterRow, LookupRow } from "@/lib/masters";

const CATEGORIES = ["BUTTON", "ZIP", "TAG", "CARDBOARD", "MASTERPACK", "LABEL", "POLYBAG", "OTHER"];
// Which optional spec fields surface per category (never forced).
const CATEGORY_FIELDS: Record<string, ("size" | "material" | "color" | "weight" | "shape")[]> = {
  BUTTON: ["size", "material", "color"],
  ZIP: ["size", "color", "material"],
  TAG: ["material"],
  LABEL: ["material"],
  CARDBOARD: ["size", "shape"],
  MASTERPACK: ["size"],
  POLYBAG: ["size", "weight", "material"],
  OTHER: [],
};

type Pick = { id: number; name: string };

export function TrimMasterManager({ trims, suppliers, categories = [] }: { trims: TrimMasterRow[]; suppliers: Pick[]; categories?: LookupRow[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<string>("ALL");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ category: "BUTTON", unit: "pcs" });

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const rows = useMemo(() => (tab === "ALL" ? trims : trims.filter((t) => (t.category ?? "OTHER") === tab)), [tab, trims]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trims) m.set(t.category ?? "OTHER", (m.get(t.category ?? "OTHER") ?? 0) + 1);
    return m;
  }, [trims]);

  async function add() {
    if (!f.name?.trim()) return;
    setBusy(true);
    try {
      await createTrim({
        name: f.name, category: f.category || null, supplierId: f.supplierId ? +f.supplierId : null,
        ratePerUnit: f.rate ? +f.rate : null, unit: f.unit || "pcs", openingStock: f.opening ? +f.opening : 0,
        size: f.size || null, material: f.material || null, color: f.color || null, weight: f.weight || null, shape: f.shape || null,
      });
      setF({ category: f.category, unit: "pcs" });
      setAdding(false);
      router.refresh();
    } finally { setBusy(false); }
  }

  const specFields = CATEGORY_FIELDS[f.category ?? "OTHER"] ?? [];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {["ALL", ...CATEGORIES].map((c) => (
          <button key={c} onClick={() => setTab(c)} className={`rounded-full px-3 py-1 text-[12px] font-semibold transition ${tab === c ? "bg-primary text-white" : "border border-border text-slate-500 hover:bg-slate-50"}`}>
            {c === "ALL" ? "All" : c.charAt(0) + c.slice(1).toLowerCase()}
            <span className="ml-1 text-[10px] opacity-70">{c === "ALL" ? trims.length : counts.get(c) ?? 0}</span>
          </button>
        ))}
        <button onClick={() => setAdding((v) => !v)} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-white"><Plus size={13} /> Add trim</button>
      </div>

      {adding && (
        <Card className="mb-4 p-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Labelled label="Category">
              <LookupSelect kind="TRIM_CATEGORY" options={categories} value={f.category ?? ""} onChange={(v) => set("category", v)} placeholder="Category…" className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary" />
            </Labelled>
            <Labelled label="Name"><In v={f.name} on={(v) => set("name", v)} /></Labelled>
            <Labelled label="Supplier">
              <select value={f.supplierId ?? ""} onChange={(e) => set("supplierId", e.target.value)} className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary">
                <option value="">—</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Labelled>
            <Labelled label="Rate"><In v={f.rate} on={(v) => set("rate", v)} type="number" /></Labelled>
            <Labelled label="Unit"><In v={f.unit} on={(v) => set("unit", v)} /></Labelled>
            <Labelled label="Opening stock"><In v={f.opening} on={(v) => set("opening", v)} type="number" /></Labelled>
            {specFields.map((sf) => (
              <Labelled key={sf} label={sf.charAt(0).toUpperCase() + sf.slice(1)}><In v={f[sf]} on={(v) => set(sf, v)} /></Labelled>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <button onClick={add} disabled={busy || !f.name?.trim()} className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">Save trim</button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-semibold">Trim</th>
              <th className="px-4 py-2.5 font-semibold">Category</th>
              <th className="px-4 py-2.5 font-semibold">Supplier</th>
              <th className="px-4 py-2.5 text-right font-semibold">Rate</th>
              <th className="px-4 py-2.5 text-right font-semibold">Current</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 500).map((t) => (
              <tr key={t.id} className={`border-b border-slate-50 last:border-0 ${t.status === "DISCONTINUED" ? "opacity-50" : ""}`}>
                <td className="px-4 py-2.5"><Link href={`/trims/${t.id}`} className="font-semibold text-primary-ink hover:underline">{t.name}</Link></td>
                <td className="px-4 py-2.5 text-slate-500">{t.category ?? t.family ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-500">{t.supplier ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tnum text-slate-500">{t.ratePerUnit != null ? num(t.ratePerUnit, 2) : "—"}</td>
                <td className={`px-4 py-2.5 text-right tnum font-semibold ${t.current <= 0 ? "text-danger" : ""}`}>{num(t.current)}</td>
                <td className="px-4 py-2.5">{t.current <= 0 ? <Badge tone="danger">Indent</Badge> : <Badge tone="ok">OK</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</label>{children}</div>;
}
function In({ v, on, type = "text" }: { v?: string; on: (v: string) => void; type?: string }) {
  return <input type={type} value={v ?? ""} onChange={(e) => on(e.target.value)} className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary" />;
}
