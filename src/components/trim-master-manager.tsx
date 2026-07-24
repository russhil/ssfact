"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createTrim, updateTrim } from "@/lib/actions";
import { Card, Badge } from "@/components/ui";
import { LookupSelect } from "@/components/masters/lookup-select";
import { num } from "@/lib/format";
import { Plus, Settings2, Check } from "lucide-react";
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
const DIMS = ["FLAT", "COLOR", "SIZE"];
const DIM_LABEL: Record<string, string> = { COLOR: "colour", SIZE: "size", FLAT: "flat" };

type Pick = { id: number; name: string };

/** Change 17 Part H: a trim is low when it has hit its reorder level (fallback ≤ 0). */
function isLow(t: TrimMasterRow): boolean {
  return t.reorderLevel != null ? t.current <= t.reorderLevel : t.current <= 0;
}

export function TrimMasterManager({
  trims,
  suppliers,
  categories = [],
  units = [],
}: {
  trims: TrimMasterRow[];
  suppliers: Pick[];
  categories?: LookupRow[];
  units?: LookupRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<string>("ALL");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ category: "BUTTON", unit: "pcs", dimension: "FLAT" });

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const rows = useMemo(() => {
    if (tab === "REORDER") return trims.filter(isLow);
    if (tab === "ALL") return trims;
    return trims.filter((t) => (t.category ?? "OTHER") === tab);
  }, [tab, trims]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trims) m.set(t.category ?? "OTHER", (m.get(t.category ?? "OTHER") ?? 0) + 1);
    return m;
  }, [trims]);
  const lowCount = useMemo(() => trims.filter(isLow).length, [trims]);

  async function add() {
    if (!f.name?.trim()) return;
    setBusy(true);
    try {
      await createTrim({
        name: f.name, category: f.category || null, supplierId: f.supplierId ? +f.supplierId : null,
        ratePerUnit: f.rate ? +f.rate : null, unit: f.unit || "pcs", openingStock: f.opening ? +f.opening : 0,
        size: f.size || null, material: f.material || null, color: f.color || null, weight: f.weight || null, shape: f.shape || null,
        // Change 17: master single-source (Part D) + reorder trigger (Part H)
        dimension: f.dimension || null, perPieceAvg: f.perPiece ? +f.perPiece : null, reorderLevel: f.reorder ? +f.reorder : null,
      });
      setF({ category: f.category, unit: "pcs", dimension: "FLAT" });
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
        <button onClick={() => setTab("REORDER")} className={`rounded-full px-3 py-1 text-[12px] font-semibold transition ${tab === "REORDER" ? "bg-amber-500 text-white" : "border border-amber-300 text-amber-600 hover:bg-amber-50"}`}>
          Reorder list<span className="ml-1 text-[10px] opacity-80">{lowCount}</span>
        </button>
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
            <Labelled label="Rate (₹)"><In v={f.rate} on={(v) => set("rate", v)} type="number" /></Labelled>
            <Labelled label="Unit">
              <LookupSelect kind="UNIT" options={units} value={f.unit ?? ""} onChange={(v) => set("unit", v)} placeholder="Unit…" className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary" />
            </Labelled>
            <Labelled label="Applies to">
              <select value={f.dimension ?? "FLAT"} onChange={(e) => set("dimension", e.target.value)} className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary">
                {DIMS.map((d) => <option key={d} value={d}>{DIM_LABEL[d]}</option>)}
              </select>
            </Labelled>
            <Labelled label="Per-piece avg"><In v={f.perPiece} on={(v) => set("perPiece", v)} type="number" /></Labelled>
            <Labelled label="Reorder level"><In v={f.reorder} on={(v) => set("reorder", v)} type="number" /></Labelled>
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
              <th className="px-4 py-2.5 text-right font-semibold">Reorder</th>
              <th className="px-4 py-2.5 text-right font-semibold">Current</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 500).map((t) => (
              <TrimRow key={t.id} t={t} units={units} onSaved={() => router.refresh()} />
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function TrimRow({ t, units, onSaved }: { t: TrimMasterRow; units: LookupRow[]; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dimension, setDimension] = useState(t.dimension ?? "FLAT");
  const [perPiece, setPerPiece] = useState(t.perPieceAvg != null ? String(t.perPieceAvg) : "");
  const [reorder, setReorder] = useState(t.reorderLevel != null ? String(t.reorderLevel) : "");
  const [unit, setUnit] = useState(t.unit ?? "pcs");
  const low = isLow(t);

  async function save() {
    setBusy(true);
    try {
      await updateTrim({
        id: t.id,
        dimension: dimension || null,
        perPieceAvg: perPiece.trim() === "" ? null : +perPiece,
        reorderLevel: reorder.trim() === "" ? null : +reorder,
        unit: unit || null,
      });
      setEditing(false);
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <>
      <tr className={`border-b border-slate-50 last:border-0 ${t.status === "DISCONTINUED" ? "opacity-50" : ""}`}>
        <td className="px-4 py-2.5"><Link href={`/trims/${t.id}`} className="font-semibold text-primary-ink hover:underline">{t.name}</Link></td>
        <td className="px-4 py-2.5 text-slate-500">{t.category ?? t.family ?? "—"}</td>
        <td className="px-4 py-2.5 text-slate-500">{t.supplier ?? "—"}</td>
        <td className="px-4 py-2.5 text-right tnum text-slate-500">{t.ratePerUnit != null ? `₹${num(t.ratePerUnit, 2)}` : "—"}</td>
        <td className="px-4 py-2.5 text-right tnum text-slate-500">{t.reorderLevel != null ? num(t.reorderLevel) : "—"}</td>
        <td className={`px-4 py-2.5 text-right tnum font-semibold ${t.current <= 0 ? "text-danger" : low ? "text-amber-600" : ""}`}>{num(t.current)}</td>
        <td className="px-4 py-2.5">{t.current <= 0 ? <Badge tone="danger">Indent</Badge> : low ? <Badge tone="warn">Low</Badge> : <Badge tone="ok">OK</Badge>}</td>
        <td className="px-4 py-2.5 text-right">
          <button onClick={() => setEditing((v) => !v)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"><Settings2 size={12} /> Edit</button>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td colSpan={8} className="px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <Labelled label="Applies to">
                <select value={dimension} onChange={(e) => setDimension(e.target.value)} className="rounded-lg border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-primary">
                  {DIMS.map((d) => <option key={d} value={d}>{DIM_LABEL[d]}</option>)}
                </select>
              </Labelled>
              <Labelled label="Per-piece avg">
                <input type="number" value={perPiece} onChange={(e) => setPerPiece(e.target.value)} placeholder="—" className="w-28 rounded-lg border border-border px-2.5 py-1.5 text-[12px] tnum outline-none focus:border-primary" />
              </Labelled>
              <Labelled label="Reorder level">
                <input type="number" value={reorder} onChange={(e) => setReorder(e.target.value)} placeholder="—" className="w-28 rounded-lg border border-border px-2.5 py-1.5 text-[12px] tnum outline-none focus:border-primary" />
              </Labelled>
              <Labelled label="Unit">
                <LookupSelect kind="UNIT" options={units} value={unit} onChange={setUnit} placeholder="Unit…" className="w-32 rounded-lg border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-primary" />
              </Labelled>
              <button onClick={save} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"><Check size={13} /> Save</button>
              <button onClick={() => setEditing(false)} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-slate-500">Cancel</button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</label>{children}</div>;
}
function In({ v, on, type = "text" }: { v?: string; on: (v: string) => void; type?: string }) {
  return <input type={type} value={v ?? ""} onChange={(e) => on(e.target.value)} className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary" />;
}
