"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createJobCard } from "@/lib/actions";
import type { JobProductOption } from "@/lib/inventory";
import { colorKey } from "@/lib/colour";
import { STAGES, STAGE_LABEL, splitByRatio, type Stage } from "@/lib/job-labels";
import { Badge } from "@/components/ui";
import { num, inr } from "@/lib/format";
import { Zap, Check, AlertTriangle, ArrowLeft, Plus, X } from "lucide-react";

const COLORLESS = "—";
const cellKey = (size: string, color: string) => `${size}|||${color}`;

type CutMode = "ratio" | "manual";
type ColorMode = "ratio" | "manual";
type BomDim = "COLOR" | "SIZE" | "FLAT";
type BomRow = { trimItemId: number | null; material: string; color: string; dimension: BomDim; perPieceQty: number };

export function NewJobCardForm({
  products,
  vendors,
  masters,
}: {
  products: JobProductOption[];
  vendors: string[];
  masters: string[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<JobProductOption | null>(null);
  const [open, setOpen] = useState(false);
  const [vendor, setVendor] = useState(
    vendors.find((v) => v === "Pebble") ?? vendors.find((v) => v !== "Unassigned") ?? vendors[0] ?? ""
  );
  const [master, setMaster] = useState(masters.find((m) => m.includes("Attri")) ?? masters[0] ?? "");
  const [etd, setEtd] = useState("");
  const [stage, setStage] = useState<Stage>("CUTTING");
  const [remark, setRemark] = useState("");
  const [newSize, setNewSize] = useState("");
  const [saving, setSaving] = useState(false);

  // cut sizing
  const [cutMode, setCutMode] = useState<CutMode>("ratio");
  const [cutQtyInput, setCutQtyInput] = useState(1200);
  const [sizeRatio, setSizeRatio] = useState<[string, number][]>([]); // editable, from product
  const [manualSizeQty, setManualSizeQty] = useState<Record<string, number>>({});

  // color split
  const [colorMode, setColorMode] = useState<ColorMode>("ratio");
  const [activeColors, setActiveColors] = useState<string[]>([]);
  const [manualCell, setManualCell] = useState<Record<string, number>>({});

  // per-colour fabric overrides (keyed by colourKey); blank ⇒ inherit defaults
  const [colorAvg, setColorAvg] = useState<Record<string, number>>({});
  const [colorGsm, setColorGsm] = useState<Record<string, number>>({});
  const [colorWidth, setColorWidth] = useState<Record<string, number>>({});

  // editable trim sheet (Change 02)
  const [bomRows, setBomRows] = useState<BomRow[]>([]);

  const sizes = useMemo(() => sizeRatio.map(([s]) => s), [sizeRatio]);
  const colors = picked?.colors ?? [];
  const hasColors = colors.length > 0 && activeColors.length > 0;

  // per-size totals
  const sizeQty = useMemo<Record<string, number>>(() => {
    if (cutMode === "manual") {
      const out: Record<string, number> = {};
      for (const s of sizes) out[s] = Math.max(0, Math.round(manualSizeQty[s] ?? 0));
      return out;
    }
    const split = splitByRatio(cutQtyInput, sizeRatio);
    const out: Record<string, number> = {};
    for (const s of sizes) out[s] = split.get(s) ?? 0;
    return out;
  }, [cutMode, manualSizeQty, cutQtyInput, sizeRatio, sizes]);

  // matrix = single source of truth {size,color,qty}[]
  const matrix = useMemo(() => {
    const rows: { size: string; color: string; qty: number }[] = [];
    if (!hasColors) {
      for (const s of sizes) rows.push({ size: s, color: "", qty: sizeQty[s] ?? 0 });
      return rows;
    }
    const ratio = (picked?.colorRatio ?? []).filter(([c]) => activeColors.includes(c));
    const ratioForSplit: [string, number][] =
      ratio.length > 0 ? ratio : activeColors.map((c) => [c, 1] as [string, number]);
    for (const s of sizes) {
      if (colorMode === "manual") {
        for (const c of activeColors) rows.push({ size: s, color: c, qty: Math.max(0, Math.round(manualCell[cellKey(s, c)] ?? 0)) });
      } else {
        const split = splitByRatio(sizeQty[s] ?? 0, ratioForSplit);
        for (const c of activeColors) rows.push({ size: s, color: c, qty: split.get(c) ?? 0 });
      }
    }
    return rows;
  }, [hasColors, sizes, sizeQty, picked, activeColors, colorMode, manualCell]);

  const cutQty = matrix.reduce((a, m) => a + m.qty, 0);
  const matrixByCell = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of matrix) m.set(cellKey(r.size, r.color || COLORLESS), r.qty);
    return m;
  }, [matrix]);
  const colTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const s of sizes) t[s] = 0;
    for (const r of matrix) t[r.size] = (t[r.size] ?? 0) + r.qty;
    return t;
  }, [matrix, sizes]);

  // per-colour fabric estimate — each colour draws from that colour's stock
  const fabricRows = useMemo(() => {
    if (!picked) return [];
    const byColour = new Map<string, { display: string; qty: number }>();
    for (const r of matrix) {
      if (r.qty <= 0) continue;
      const disp = r.color || COLORLESS;
      const key = disp === COLORLESS ? "" : colorKey(disp);
      const e = byColour.get(key) ?? { display: disp, qty: 0 };
      e.qty += r.qty;
      byColour.set(key, e);
    }
    const defAvg = picked.avgConsumption ?? null;
    return [...byColour.entries()].map(([key, { display, qty }]) => {
      const avg = colorAvg[key] ?? defAvg ?? null;
      const required = avg != null ? Math.round(qty * avg * 100) / 100 : null;
      const available = display === COLORLESS ? picked.fabricAvailable : picked.fabricByColor[key] ?? 0;
      const enough = required != null && available != null ? available >= required : null;
      return {
        key, display, qty, avg, required, available, enough,
        gsm: colorGsm[key] ?? picked.fabricGsm ?? null,
        width: colorWidth[key] ?? picked.fabricRollWidth ?? null,
      };
    });
  }, [picked, matrix, colorAvg, colorGsm, colorWidth]);

  const totalRequired = fabricRows.reduce((a, r) => a + (r.required ?? 0), 0);
  const anyShort = fabricRows.some((r) => r.enough === false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(
        (p) =>
          p.sku.toLowerCase().includes(q) ||
          p.itemDesc.toLowerCase().includes(q) ||
          p.styleNo.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [query, products]);

  // per-colour cut quantities (for COLOUR-dimension trim explosion)
  const cutByColour = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of matrix) if (r.qty > 0) { const k = colorKey(r.color); m.set(k, (m.get(k) ?? 0) + r.qty); }
    return m;
  }, [matrix]);
  const trimById = useMemo(() => {
    const m = new Map<number, { name: string; currentStock: number }>();
    for (const g of picked?.trimMaster ?? []) for (const it of g.items) m.set(it.id, { name: it.name, currentStock: it.currentStock });
    return m;
  }, [picked]);
  function bomRequired(r: BomRow): number {
    if (r.dimension === "COLOR" && r.color) return (r.perPieceQty || 0) * (cutByColour.get(colorKey(r.color)) ?? 0);
    return (r.perPieceQty || 0) * cutQty;
  }
  function presetRows(p: JobProductOption): BomRow[] {
    return (p.bom ?? []).map((b) => ({
      trimItemId: b.trimItemId,
      material: b.material,
      color: b.color ?? "",
      dimension: ((b.dimension as BomDim) ?? "FLAT"),
      perPieceQty: b.perPieceQty ?? 0,
    }));
  }
  const setBomRow = (i: number, patch: Partial<BomRow>) =>
    setBomRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  function pick(p: JobProductOption) {
    setPicked(p);
    setQuery(p.styleNo);
    setOpen(false);
    setSizeRatio(p.sizeRatio);
    setManualSizeQty({});
    setManualCell({});
    setColorAvg({});
    setColorGsm({});
    setColorWidth({});
    setBomRows(presetRows(p));
    setActiveColors(p.colors.map((c) => c.name)); // default: all colors in play
  }

  function toggleColor(name: string) {
    setActiveColors((prev) => (prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]));
  }

  async function save() {
    if (!picked || cutQty <= 0) return;
    setSaving(true);
    try {
      const { slug } = await createJobCard({
        productId: picked.id,
        vendorName: vendor,
        cuttingMaster: master,
        matrix: matrix.filter((m) => m.qty > 0),
        fabricLines: fabricRows
          .filter((r) => r.display !== COLORLESS)
          .map((r) => ({
            color: r.display,
            estAvg: colorAvg[r.key] ?? null,
            gsm: colorGsm[r.key] ?? null,
            rollWidth: colorWidth[r.key] ?? null,
          })),
        bomLines: bomRows
          .filter((r) => r.trimItemId != null || r.material.trim())
          .map((r) => ({
            trimItemId: r.trimItemId,
            material: r.material.trim() || (r.trimItemId ? trimById.get(r.trimItemId)?.name ?? "" : ""),
            color: r.color || null,
            dimension: r.dimension,
            perPieceQty: r.perPieceQty || 0,
          })),
        remark: remark.trim() || undefined,
        stage,
        plannedEtd: etd || undefined,
      });
      router.push(`/job-cards/${slug}`);
    } catch (e) {
      setSaving(false);
      alert("Could not save: " + (e as Error).message);
    }
  }

  return (
    <div>
      <Link href="/job-cards" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Job Cards
      </Link>

      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-[19px] font-bold tracking-tight">New Job Card</h1>
          <p className="mt-0.5 text-[12px] text-muted">Auto-assigned SI · {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</p>
        </div>
        <button
          onClick={save}
          disabled={!picked || cutQty <= 0 || saving}
          className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-indigo-600 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save Job Card"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[1.25fr_1fr]">
        {/* form */}
        <div className="rounded-card border border-border bg-surface p-5">
          <h3 className="mb-4 text-[11px] font-bold uppercase tracking-wide text-muted">Order details</h3>

          {/* product autocomplete */}
          <div className="relative mb-3.5">
            <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">
              Product <span className="text-primary">— start typing SKU, style or item</span>
            </label>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPicked(null);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="e.g. TP-TRUMP"
              className="w-full rounded-lg border border-primary px-3 py-2.5 text-[13px] font-semibold outline-none ring-2 ring-indigo-100"
            />
            {open && matches.length > 0 && (
              <div className="absolute left-0 right-0 top-[68px] z-10 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                {matches.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => pick(m)}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[12px] hover:bg-primary-soft"
                  >
                    <span>
                      <span className="font-bold">{m.styleNo}</span>
                      <span className="ml-2 text-faint">{m.itemDesc}</span>
                    </span>
                    <span className="font-bold text-emerald-600">{inr(m.mrp)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* autofilled fields */}
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Item Description" value={picked?.itemDesc ?? ""} auto={!!picked} />
            <Field label="MRP" value={picked ? inr(picked.mrp) : ""} auto={!!picked} />
            <Field label="Fabric" value={picked?.fabricName ?? ""} auto={!!picked} />
            <Field
              label="Avg Consumption"
              value={picked?.avgConsumption ? `${picked.avgConsumption} ${picked.unit.toLowerCase()}/pc` : picked ? "not set" : ""}
              auto={!!picked}
            />
          </div>

          {/* manual fields */}
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Vendor</label>
              <select value={vendor} onChange={(e) => setVendor(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2.5 text-[13px] outline-none focus:border-primary">
                {vendors.map((v) => <option key={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Cutting Master</label>
              <select value={master} onChange={(e) => setMaster(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2.5 text-[13px] outline-none focus:border-primary">
                {masters.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Planned ETD</label>
              <input type="date" value={etd} onChange={(e) => setEtd(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2.5 text-[13px] outline-none focus:border-primary" />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Stage</label>
              <div className="flex rounded-lg border border-border p-0.5">
                {STAGES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStage(s)}
                    className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${
                      stage === s ? "bg-primary text-white shadow-sm" : "text-slate-500 hover:text-ink"
                    }`}
                  >
                    {STAGE_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* remark (optional — fast capture) */}
          <div className="mt-2.5">
            <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Remark <span className="font-normal text-faint">(optional)</span></label>
            <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="e.g. urgent, colour pending from party…" className="w-full rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-primary" />
          </div>

          {picked && (
            <>
              {/* cut sizing */}
              <div className="mt-4 flex items-center justify-between">
                <label className="text-[11px] font-semibold text-slate-600">
                  Cut sizing · Total <span className="font-bold text-primary-ink">{num(cutQty)} pcs</span>
                </label>
                <Toggle value={cutMode} onChange={setCutMode} options={[["ratio", "By ratio"], ["manual", "Manual"]]} />
              </div>

              {/* flexible size set — add/remove a size column for this card only */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {sizes.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 rounded-full border border-border bg-slate-50 px-2 py-0.5 text-[11px] font-semibold">
                    {s}
                    <button type="button" onClick={() => setSizeRatio((r) => r.filter(([n]) => n !== s))} className="text-faint hover:text-danger"><X size={11} /></button>
                  </span>
                ))}
                <input
                  value={newSize}
                  onChange={(e) => setNewSize(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newSize.trim()) {
                      const n = newSize.trim().toUpperCase();
                      setSizeRatio((r) => (r.some(([x]) => x === n) ? r : [...r, [n, 0.1]]));
                      setNewSize("");
                    }
                  }}
                  placeholder="+ size"
                  className="w-16 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] outline-none focus:border-primary"
                />
              </div>

              {cutMode === "ratio" && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-slate-600">Cut Qty</span>
                  <input
                    type="number"
                    value={cutQtyInput}
                    onChange={(e) => setCutQtyInput(Math.max(0, +e.target.value))}
                    className="w-28 rounded-lg border border-border px-3 py-2 text-[13px] font-semibold outline-none focus:border-primary"
                  />
                  {sizeRatio.length <= 2 && sizeRatio.length > 0 && (
                    <span className="text-[10px] text-faint">edit per-size ratio below</span>
                  )}
                </div>
              )}

              {/* per-size split / inputs */}
              <div className="mt-3 grid gap-1.5 text-center" style={{ gridTemplateColumns: `repeat(${sizes.length + 1}, minmax(0, 1fr))` }}>
                {sizes.map((s, i) => (
                  <div key={s}>
                    <div className="text-[10px] font-bold text-faint">{s}</div>
                    {cutMode === "manual" ? (
                      <input
                        type="number"
                        value={manualSizeQty[s] || ""}
                        placeholder="0"
                        onChange={(e) => setManualSizeQty((p) => ({ ...p, [s]: Math.max(0, +e.target.value) }))}
                        className="mt-1 w-full rounded-md border border-border bg-slate-50 py-1.5 text-center text-[12px] font-bold tnum outline-none focus:border-primary"
                      />
                    ) : sizeRatio.length <= 2 ? (
                      <input
                        type="number"
                        step="0.01"
                        value={sizeRatio[i]?.[1] ?? 0}
                        onChange={(e) =>
                          setSizeRatio((prev) => prev.map((row, idx) => (idx === i ? [row[0], Math.max(0, +e.target.value)] : row)))
                        }
                        className="mt-1 w-full rounded-md border border-border bg-slate-50 py-1.5 text-center text-[12px] font-bold tnum outline-none focus:border-primary"
                      />
                    ) : (
                      <div className="mt-1 rounded-md border border-border bg-slate-50 py-1.5 text-[12px] font-bold tnum">{num(sizeQty[s] ?? 0)}</div>
                    )}
                  </div>
                ))}
                <div>
                  <div className="text-[10px] font-bold text-primary-ink">Total</div>
                  <div className="mt-1 rounded-md bg-primary-soft py-1.5 text-[12px] font-bold text-primary-ink tnum">{num(cutQty)}</div>
                </div>
              </div>

              {/* colors */}
              {colors.length > 0 && (
                <>
                  <div className="mt-4 flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-slate-600">Colours</label>
                    <Toggle value={colorMode} onChange={setColorMode} options={[["ratio", "By ratio"], ["manual", "Manual grid"]]} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {colors.map((c) => {
                      const on = activeColors.includes(c.name);
                      return (
                        <button
                          key={c.name}
                          type="button"
                          onClick={() => toggleColor(c.name)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                            on ? "border-primary bg-primary-soft text-primary-ink" : "border-border text-slate-500 hover:text-ink"
                          }`}
                        >
                          {c.hex && <span className="h-2.5 w-2.5 rounded-full border border-black/10" style={{ background: c.hex }} />}
                          {c.name}
                        </button>
                      );
                    })}
                  </div>

                  {/* size×color matrix */}
                  {hasColors && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-center text-[12px]">
                        <thead>
                          <tr className="text-[10px] font-bold text-faint">
                            <th className="px-2 py-1 text-left">Colour \ Size</th>
                            {sizes.map((s) => <th key={s} className="px-2 py-1">{s}</th>)}
                            <th className="px-2 py-1 text-primary-ink">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeColors.map((c) => {
                            const rowTotal = sizes.reduce((a, s) => a + (matrixByCell.get(cellKey(s, c)) ?? 0), 0);
                            return (
                              <tr key={c}>
                                <td className="px-2 py-1 text-left font-semibold text-slate-600">{c}</td>
                                {sizes.map((s) => (
                                  <td key={s} className="px-1 py-1">
                                    {colorMode === "manual" ? (
                                      <input
                                        type="number"
                                        value={manualCell[cellKey(s, c)] || ""}
                                        placeholder="0"
                                        onChange={(e) => setManualCell((p) => ({ ...p, [cellKey(s, c)]: Math.max(0, +e.target.value) }))}
                                        className="w-full min-w-[44px] rounded-md border border-border bg-slate-50 py-1 text-center text-[11px] font-bold tnum outline-none focus:border-primary"
                                      />
                                    ) : (
                                      <div className="rounded-md bg-slate-50 py-1 text-[11px] font-bold tnum">{num(matrixByCell.get(cellKey(s, c)) ?? 0)}</div>
                                    )}
                                  </td>
                                ))}
                                <td className="px-2 py-1 font-bold text-primary-ink tnum">{num(rowTotal)}</td>
                              </tr>
                            );
                          })}
                          <tr className="border-t border-border">
                            <td className="px-2 py-1 text-left text-[10px] font-bold text-primary-ink">Total</td>
                            {sizes.map((s) => <td key={s} className="px-2 py-1 font-bold tnum">{num(colTotals[s] ?? 0)}</td>)}
                            <td className="px-2 py-1 font-extrabold text-primary-ink tnum">{num(cutQty)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {/* editable trim sheet (BOM) */}
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted">Trim sheet · ×{num(cutQty)} pcs</h4>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setBomRows(presetRows(picked))} className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                      Load preset
                    </button>
                    <button type="button" onClick={() => setBomRows((r) => [...r, { trimItemId: null, material: "", color: "", dimension: "FLAT", perPieceQty: 0 }])} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                      <Plus size={12} /> Add row
                    </button>
                  </div>
                </div>
                {bomRows.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border py-3 text-center text-[11px] text-faint">No trims — load the preset or add rows.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-faint">
                          <th className="px-2 py-2 font-semibold">Trim (from master)</th>
                          <th className="px-2 py-2 font-semibold">Dim</th>
                          <th className="px-2 py-2 font-semibold">Colour</th>
                          <th className="px-2 py-2 text-right font-semibold">Per pc</th>
                          <th className="px-2 py-2 text-right font-semibold">Required</th>
                          <th className="px-2 py-2 text-right font-semibold">In store</th>
                          <th className="px-2 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {bomRows.map((r, i) => {
                          const required = bomRequired(r);
                          const stock = r.trimItemId != null ? trimById.get(r.trimItemId)?.currentStock ?? null : null;
                          const short = stock != null && required > stock;
                          return (
                            <tr key={i} className="border-b border-slate-50 last:border-0">
                              <td className="px-2 py-1">
                                <select
                                  value={r.trimItemId ?? ""}
                                  onChange={(e) => {
                                    const id = e.target.value ? +e.target.value : null;
                                    setBomRow(i, { trimItemId: id, material: id ? trimById.get(id)?.name ?? r.material : r.material });
                                  }}
                                  className="w-full min-w-[150px] rounded-md border border-border bg-white px-1.5 py-1 text-[11px] outline-none focus:border-primary"
                                >
                                  <option value="">{r.material || "— pick trim —"}</option>
                                  {(picked.trimMaster ?? []).map((g) => (
                                    <optgroup key={g.group} label={g.group}>
                                      {g.items.map((it) => (
                                        <option key={it.id} value={it.id}>{it.name} ({num(it.currentStock)})</option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </select>
                              </td>
                              <td className="px-2 py-1">
                                <select value={r.dimension} onChange={(e) => setBomRow(i, { dimension: e.target.value as BomDim })} className="rounded-md border border-border bg-white px-1 py-1 text-[11px] outline-none focus:border-primary">
                                  <option value="FLAT">Flat</option>
                                  <option value="COLOR">Colour</option>
                                  <option value="SIZE">Size</option>
                                </select>
                              </td>
                              <td className="px-2 py-1">
                                <input value={r.color} onChange={(e) => setBomRow(i, { color: e.target.value })} placeholder="—" className="w-20 rounded-md border border-border px-1.5 py-1 text-[11px] outline-none focus:border-primary" />
                              </td>
                              <td className="px-1 py-1">
                                <input type="number" step="0.001" value={r.perPieceQty || ""} onChange={(e) => setBomRow(i, { perPieceQty: +e.target.value })} className="w-16 rounded-md border border-border px-1.5 py-1 text-right text-[11px] tnum outline-none focus:border-primary" />
                              </td>
                              <td className={`px-2 py-1 text-right font-bold tnum ${short ? "text-danger" : ""}`}>{num(required)}</td>
                              <td className="px-2 py-1 text-right">
                                {stock != null ? (
                                  <span className="inline-flex items-center gap-1">
                                    <span className={`tnum ${short ? "text-danger font-semibold" : "text-slate-500"}`}>{num(stock)}</span>
                                    {short && <Badge tone="danger">Short</Badge>}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-faint">untracked</span>
                                )}
                              </td>
                              <td className="px-1 py-1 text-right">
                                <button type="button" onClick={() => setBomRows((rows) => rows.filter((_, idx) => idx !== i))} className="text-faint hover:text-danger"><X size={13} /></button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {bomRows.some((r) => { const s = r.trimItemId != null ? trimById.get(r.trimItemId)?.currentStock ?? null : null; return s != null && bomRequired(r) > s; }) && (
                  <p className="mt-1.5 text-[11px] text-danger">Some trims are short — the card still saves and is flagged in Pending Trims.</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* live calc panel */}
        <div className="rounded-card border border-slate-800 bg-gradient-to-b from-[#0f1226] to-[#1b1f3b] p-5 text-indigo-50">
          <h3 className="mb-4 text-[11px] font-bold uppercase tracking-wide text-indigo-300">Live fabric requirement</h3>

          {!picked ? (
            <div className="flex h-56 flex-col items-center justify-center text-center text-[12px] text-indigo-300/70">
              <Zap size={22} className="mb-2 opacity-60" />
              Pick a product — we&apos;ll split fabric per colour and check each colour&apos;s live stock.
            </div>
          ) : fabricRows.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center text-center text-[12px] text-indigo-300/70">
              Enter cut quantities to see the per-colour fabric requirement.
            </div>
          ) : (
            <>
              <div className="flex items-end justify-between border-b border-white/10 pb-2.5">
                <span className="text-[13px] text-indigo-200">Total fabric required</span>
                <span className="text-[26px] font-extrabold text-white tnum">
                  {num(totalRequired, 0)} <span className="text-[13px]">{picked.unit.toLowerCase()}</span>
                </span>
              </div>

              <div className="mt-3 max-h-[420px] space-y-2.5 overflow-y-auto pr-0.5">
                {fabricRows.map((r) => {
                  const usedAfter =
                    r.required != null && r.available != null && r.available > 0 ? r.required / r.available : null;
                  return (
                    <div key={r.key} className="rounded-lg border border-white/10 bg-white/5 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-bold text-white">{r.display}</span>
                        <span className="text-[11px] text-indigo-200/80">{num(r.qty)} pc</span>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        <MiniInput label={`avg ${picked.unit.toLowerCase()}/pc`} value={colorAvg[r.key]} placeholder={picked.avgConsumption ?? undefined} onChange={(v) => setColorAvg((p) => upd(p, r.key, v))} />
                        <MiniInput label="gsm" value={colorGsm[r.key]} placeholder={picked.fabricGsm ?? undefined} onChange={(v) => setColorGsm((p) => upd(p, r.key, v))} />
                        <MiniInput label="width" value={colorWidth[r.key]} placeholder={picked.fabricRollWidth ?? undefined} onChange={(v) => setColorWidth((p) => upd(p, r.key, v))} />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px]">
                        <span className="text-indigo-200/80">
                          need <b className="text-white tnum">{r.required != null ? num(r.required) : "—"}</b>
                          {" · "}stock <b className="tnum">{r.available != null ? num(r.available) : "—"}</b>
                        </span>
                        {r.enough == null ? (
                          <span className="text-indigo-300">—</span>
                        ) : r.enough ? (
                          <span className="flex items-center gap-1 font-bold text-emerald-300"><Check size={13} /> ok</span>
                        ) : (
                          <span className="flex items-center gap-1 font-bold text-rose-300"><AlertTriangle size={13} /> short</span>
                        )}
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full rounded-full ${r.enough === false ? "bg-gradient-to-r from-rose-400 to-rose-500" : "bg-gradient-to-r from-emerald-400 to-cyan-400"}`}
                          style={{ width: `${Math.min(100, (usedAfter ?? 0) * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-[13px]">
                <span className="text-indigo-200">Stock check</span>
                {anyShort ? (
                  <span className="flex items-center gap-1.5 font-bold text-rose-300"><AlertTriangle size={15} /> Some colours short — raise indent</span>
                ) : (
                  <span className="flex items-center gap-1.5 font-bold text-emerald-300"><Check size={15} /> All colours covered</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* magic callout */}
      <div className="mt-3.5 flex items-center gap-3 rounded-card border border-emerald-200 bg-ok-soft px-4 py-3 text-[12.5px] text-emerald-800">
        <Zap size={18} className="shrink-0 text-emerald-600" />
        <span>
          In the Excel, this job card meant retyping style, item, MRP, fabric &amp; average across <b>4 different sheets</b> by hand —
          and trims were tallied separately. Here you typed a few characters, the size×colour grid and BOM filled themselves,
          and fabric &amp; trim stock auto-checked <b>before</b> you committed a single metre.
        </span>
      </div>
    </div>
  );
}

function Toggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="flex rounded-lg border border-border p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
            value === v ? "bg-primary text-white shadow-sm" : "text-slate-500 hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, value, auto }: { label: string; value: string; auto: boolean }) {
  return (
    <div className="relative">
      <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">{label}</label>
      <input
        readOnly
        value={value}
        placeholder="—"
        className={`w-full rounded-lg border px-3 py-2.5 text-[13px] font-semibold outline-none ${
          auto ? "border-indigo-200 bg-primary-soft" : "border-border bg-slate-50 text-faint"
        }`}
      />
      {auto && (
        <span className="absolute right-2.5 top-[31px] rounded-full bg-white px-1.5 py-0.5 text-[9px] font-bold text-primary-ink">auto</span>
      )}
    </div>
  );
}

// Set/clear a per-colour override; clearing reverts to the inherited default.
function upd(rec: Record<string, number>, key: string, v: number | null): Record<string, number> {
  const next = { ...rec };
  if (v == null || Number.isNaN(v)) delete next[key];
  else next[key] = v;
  return next;
}

function MiniInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: number | undefined;
  placeholder?: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block truncate text-[9px] uppercase tracking-wide text-indigo-300/70">{label}</span>
      <input
        type="number"
        step="0.01"
        value={value ?? ""}
        placeholder={placeholder != null ? String(placeholder) : "—"}
        onChange={(e) => onChange(e.target.value === "" ? null : +e.target.value)}
        className="w-full rounded-md border border-white/15 bg-white/10 px-1.5 py-1 text-center text-[11px] font-semibold text-white tnum outline-none placeholder:text-indigo-300/40 focus:border-indigo-300"
      />
    </label>
  );
}
