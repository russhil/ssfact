"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateProduct, addProductColor, removeProductColor } from "@/lib/actions";
import { Card, Badge } from "@/components/ui";
import { LookupSelect } from "@/components/masters/lookup-select";
import { Plus, X, Check } from "lucide-react";

const STATUS = ["ACTIVE", "NEW_ARTICLE", "FUTURE_PLAN", "DISCONTINUED", "IN_PROCESS"];
const SAMPLING = ["", "PLANNING", "DESIGN_FABRIC_PENDING", "SAMPLE_ORDERED", "READY"];
const LOTS = ["", "OLD_CUT_SIZE", "NEW_LOT"];

type P = {
  id: number; name: string; headCategory: string | null; status: string;
  samplingStatus: string | null; productionLot: string | null; fabricRemarks: string | null; otherRemarks: string | null;
  avgConsumption: number | null; mrp: number | null; customWsRate: number | null;
  colors: { id: number; name: string; hex: string | null }[];
};

export function ProductMasterForm({ product, canSeeCost, headCategories = [] }: { product: P; canSeeCost: boolean; headCategories?: { id: number; code: string; label: string; hex: string | null; parentId: number | null; sortOrder: number; active: boolean }[] }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: product.name, headCategory: product.headCategory ?? "", status: product.status,
    samplingStatus: product.samplingStatus ?? "", productionLot: product.productionLot ?? "",
    fabricRemarks: product.fabricRemarks ?? "", otherRemarks: product.otherRemarks ?? "",
    avgConsumption: product.avgConsumption != null ? String(product.avgConsumption) : "",
    mrp: product.mrp != null ? String(product.mrp) : "", customWsRate: product.customWsRate != null ? String(product.customWsRate) : "",
  });
  const [newColor, setNewColor] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      await updateProduct({
        id: product.id, name: f.name, headCategory: f.headCategory || null, status: f.status,
        samplingStatus: f.samplingStatus || null, productionLot: f.productionLot || null,
        fabricRemarks: f.fabricRemarks || null, otherRemarks: f.otherRemarks || null,
        avgConsumption: f.avgConsumption ? +f.avgConsumption : null,
        ...(canSeeCost ? { mrp: f.mrp ? +f.mrp : null, customWsRate: f.customWsRate ? +f.customWsRate : null } : {}),
      });
      setSaved(true); setTimeout(() => setSaved(false), 1800);
      router.refresh();
    } finally { setBusy(false); }
  }
  async function addColor() {
    if (!newColor.trim()) return;
    setBusy(true);
    try { await addProductColor({ productId: product.id, name: newColor }); setNewColor(""); router.refresh(); } finally { setBusy(false); }
  }
  async function delColor(id: number) {
    setBusy(true);
    try { await removeProductColor({ id }); router.refresh(); } finally { setBusy(false); }
  }

  return (
    <Card className="p-5">
      <h3 className="mb-3 text-[13px] font-bold">Edit Product <span className="font-medium text-faint">· admin / staff</span></h3>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
        <Field label="Name"><input value={f.name} onChange={(e) => set("name", e.target.value)} className={inp} /></Field>
        <Field label="Head category">
          <LookupSelect kind="HEAD_CATEGORY" options={headCategories} value={f.headCategory} onChange={(v) => set("headCategory", v)} placeholder="Category…" className={inp} />
        </Field>
        <Field label="Status"><Sel v={f.status} on={(v) => set("status", v)} opts={STATUS} /></Field>
        <Field label="Sampling status"><Sel v={f.samplingStatus} on={(v) => set("samplingStatus", v)} opts={SAMPLING} /></Field>
        <Field label="Production lot"><Sel v={f.productionLot} on={(v) => set("productionLot", v)} opts={LOTS} /></Field>
        <Field label="Avg consumption"><input type="number" step="0.001" value={f.avgConsumption} onChange={(e) => set("avgConsumption", e.target.value)} className={inp} /></Field>
        {canSeeCost && <Field label="MRP"><input type="number" value={f.mrp} onChange={(e) => set("mrp", e.target.value)} className={inp} /></Field>}
        {canSeeCost && <Field label="WS rate"><input type="number" value={f.customWsRate} onChange={(e) => set("customWsRate", e.target.value)} className={inp} /></Field>}
        <Field label="Fabric remarks"><input value={f.fabricRemarks} onChange={(e) => set("fabricRemarks", e.target.value)} className={inp} /></Field>
        <Field label="Other remarks"><input value={f.otherRemarks} onChange={(e) => set("otherRemarks", e.target.value)} className={inp} /></Field>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">Colours</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {product.colors.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-slate-50 px-2.5 py-1 text-[11px] font-semibold">
              {c.hex && <span className="h-2.5 w-2.5 rounded-full border border-black/10" style={{ background: c.hex }} />}
              {c.name}
              <button onClick={() => delColor(c.id)} className="text-faint hover:text-danger"><X size={11} /></button>
            </span>
          ))}
          <input value={newColor} onChange={(e) => setNewColor(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addColor()} placeholder="+ colour" className="w-24 rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] outline-none focus:border-primary" />
          <button onClick={addColor} disabled={busy || !newColor.trim()} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] font-semibold hover:bg-slate-50 disabled:opacity-40"><Plus size={11} /> Add</button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button onClick={save} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">Save</button>
        {saved && <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-600"><Check size={14} /> Saved</span>}
        {!canSeeCost && <Badge tone="default">Cost fields hidden — owner only</Badge>}
      </div>
    </Card>
  );
}

const inp = "w-full rounded-lg border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</label>{children}</div>;
}
function Sel({ v, on, opts }: { v: string; on: (v: string) => void; opts: string[] }) {
  return <select value={v} onChange={(e) => on(e.target.value)} className={inp}>{opts.map((o) => <option key={o} value={o}>{o ? o.replace(/_/g, " ") : "—"}</option>)}</select>;
}
