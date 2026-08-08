"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createTrim, updateTrim, deleteTrim } from "@/lib/actions";
import { MasterDelete } from "@/components/master-delete";
import { Card, Badge, MobileCardList, SortHeader, TableToolbar, useTableView, type CsvExport, type FilterDef } from "@/components/ui";
import { StockAdjust } from "@/components/stock-adjust";
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

  // Change 23 Part F — search + supplier and below-reorder filters on top of the
  // category tabs, plus click-to-sort. "Below reorder" is the practical
  // what-do-I-need-to-buy view, reading the same isLow() the REORDER tab does.
  const supplierNames = useMemo(
    () => [...new Set(trims.map((t) => t.supplier).filter((x): x is string => !!x))].sort(),
    [trims]
  );
  const filters: FilterDef<TrimMasterRow>[] = useMemo(
    () => [
      {
        key: "supplier",
        label: "suppliers",
        options: supplierNames.map((n) => ({ value: n, label: n })),
        match: (t, v) => t.supplier === v,
      },
      {
        // Change 25 Part E: ONE below-reorder rule, matching getLowStockAlerts() —
        // `reorderLevel != null && current <= reorderLevel`. This deliberately replaces
        // the previous "stock levels" filter, which used isLow()'s ≤ 0 fallback: two
        // filters answering the same question with different rules meant picking one or
        // the other silently changed the answer, and neither agreed with the dashboard.
        // isLow() still drives the REORDER tab and the row badge, where the ≤ 0 fallback
        // is wanted — a trim at zero is worth flagging even with no level set.
        key: "reorder",
        label: "stock",
        options: [
          { value: "LOW", label: "Below reorder" },
          { value: "OK", label: "Above reorder" },
        ],
        match: (t, v) => {
          const below = t.reorderLevel != null && t.current <= t.reorderLevel;
          return v === "LOW" ? below : !below;
        },
      },
    ],
    [supplierNames]
  );
  const csv: CsvExport<TrimMasterRow> = {
    filename: "trims",
    columns: [
      { header: "trim", value: (t) => t.name },
      { header: "category", value: (t) => t.category ?? t.family },
      { header: "supplier", value: (t) => t.supplier },
      { header: "rate", value: (t) => t.ratePerUnit },
      { header: "reorder_level", value: (t) => t.reorderLevel },
      { header: "current", value: (t) => t.current },
      { header: "status", value: (t) => (t.current <= 0 ? "Indent" : isLow(t) ? "Low" : "OK") },
    ],
  };
  const view = useTableView<TrimMasterRow>({
    id: "tm",
    rows,
    filters,
    search: (t) => [t.name, t.category, t.family, t.supplier],
    sorts: {
      name: (t) => t.name,
      supplier: (t) => t.supplier ?? "",
      rate: (t) => t.ratePerUnit,
      reorder: (t) => t.reorderLevel,
      current: (t) => t.current,
      // "how far under the trigger am I" — the buy-list order
      gap: (t) => (t.reorderLevel != null ? t.current - t.reorderLevel : t.current),
    },
    sum: (t) => t.current,
  });

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
          <button key={c} onClick={() => setTab(c)} className={`rounded-full px-3 py-1 t-sm font-semibold transition ${tab === c ? "bg-primary text-accent-on" : "border border-border text-t2 hover:bg-surface-2"}`}>
            {c === "ALL" ? "All" : c.charAt(0) + c.slice(1).toLowerCase()}
            <span className="ml-1 t-micro opacity-70">{c === "ALL" ? trims.length : counts.get(c) ?? 0}</span>
          </button>
        ))}
        <button onClick={() => setTab("REORDER")} className={`rounded-full px-3 py-1 t-sm font-semibold transition ${tab === "REORDER" ? "bg-warn text-surface" : "border border-warn/30 text-warn hover:bg-warn-soft"}`}>
          Reorder list<span className="ml-1 t-micro opacity-80">{lowCount}</span>
        </button>
        <button onClick={() => setAdding((v) => !v)} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 t-sm font-semibold text-accent-on"><Plus size={13} /> Add trim</button>
      </div>

      {adding && (
        <Card className="mb-4 p-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Labelled label="Category">
              <LookupSelect kind="TRIM_CATEGORY" options={categories} value={f.category ?? ""} onChange={(v) => set("category", v)} placeholder="Category…" className="w-full rounded-lg border border-border px-2.5 py-2 t-body outline-none focus:border-primary" />
            </Labelled>
            <Labelled label="Name"><In v={f.name} on={(v) => set("name", v)} /></Labelled>
            <Labelled label="Supplier">
              <select value={f.supplierId ?? ""} onChange={(e) => set("supplierId", e.target.value)} className="w-full rounded-lg border border-border px-2.5 py-2 t-body outline-none focus:border-primary">
                <option value="">—</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Labelled>
            <Labelled label="Rate (₹)"><In v={f.rate} on={(v) => set("rate", v)} type="number" /></Labelled>
            <Labelled label="Unit">
              <LookupSelect kind="UNIT" options={units} value={f.unit ?? ""} onChange={(v) => set("unit", v)} placeholder="Unit…" className="w-full rounded-lg border border-border px-2.5 py-2 t-body outline-none focus:border-primary" />
            </Labelled>
            {/* Change 40 Part D — "Applies to" removed; a trim's BOM contribution is always Flat. */}
            <Labelled label="Per-piece avg"><In v={f.perPiece} on={(v) => set("perPiece", v)} type="number" /></Labelled>
            <Labelled label="Reorder level"><In v={f.reorder} on={(v) => set("reorder", v)} type="number" /></Labelled>
            <Labelled label="Opening stock"><In v={f.opening} on={(v) => set("opening", v)} type="number" /></Labelled>
            {specFields.map((sf) => (
              <Labelled key={sf} label={sf.charAt(0).toUpperCase() + sf.slice(1)}><In v={f[sf]} on={(v) => set(sf, v)} /></Labelled>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <button onClick={add} disabled={busy || !f.name?.trim()} className="rounded-lg bg-primary px-4 py-2 t-body font-semibold text-accent-on disabled:opacity-40">Save trim</button>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <TableToolbar view={view} filters={filters} searchPlaceholder="Search trim, category, supplier…" showDate={false} unit="in store" csv={csv} />

        {/* phones: a card per trim */}
        <MobileCardList
          className="md:hidden"
          rows={view.rows.slice(0, 500)}
          keyOf={(t) => t.id}
          empty={<p className="px-2 py-10 text-center t-sm text-muted">No trims match these filters</p>}
          renderCard={(t) => {
            const low = isLow(t);
            return (
              <div className={`rounded-card bg-surface p-4 elev ${t.status === "DISCONTINUED" ? "opacity-50" : ""}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/trims/${t.id}`} className="t-body font-bold text-primary-ink">{t.name}</Link>
                  {t.current <= 0 ? <Badge tone="danger">Indent</Badge> : low ? <Badge tone="warn">Low</Badge> : <Badge tone="ok">OK</Badge>}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 t-sm text-t2">
                  <span>{t.category ?? t.family ?? "—"}</span>
                  {t.supplier && <span className="text-t3">{t.supplier}</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 t-sm">
                  <span className={`tnum font-semibold ${t.current <= 0 ? "text-danger" : low ? "text-warn" : ""}`}>{num(t.current)} in store</span>
                  {t.reorderLevel != null && <span className="tnum text-t3">reorder {num(t.reorderLevel)}</span>}
                  {t.ratePerUnit != null && <span className="tnum text-t3">₹{num(t.ratePerUnit, 2)}</span>}
                </div>
                <div className="mt-2 flex items-center justify-end gap-1.5">
                  <StockAdjust target={{ kind: "trim", trimItemId: t.id }} name={t.name} current={t.current} unit={t.unit} />
                  <MasterDelete
                    kind="trim"
                    id={t.id}
                    label="Trim"
                    onDelete={() => deleteTrim({ id: t.id })}
                    onDeactivate={t.status !== "DISCONTINUED" ? () => updateTrim({ id: t.id, status: "DISCONTINUED" }) : undefined}
                  />
                </div>
              </div>
            );
          }}
        />

        <div className="hidden overflow-x-auto md:block">
        <table className="w-full t-sm">
          <thead>
            <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5"><SortHeader view={view} sortKey="name">Trim</SortHeader></th>
              <th className="px-4 py-2.5 font-semibold">Category</th>
              <th className="px-4 py-2.5"><SortHeader view={view} sortKey="supplier">Supplier</SortHeader></th>
              <th className="px-4 py-2.5 text-right"><SortHeader view={view} sortKey="rate" align="right">Rate</SortHeader></th>
              <th className="px-4 py-2.5 text-right"><SortHeader view={view} sortKey="gap" align="right">Reorder</SortHeader></th>
              <th className="px-4 py-2.5 text-right"><SortHeader view={view} sortKey="current" align="right">Current</SortHeader></th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {view.rows.slice(0, 500).map((t) => (
              <TrimRow key={t.id} t={t} units={units} suppliers={suppliers} categories={categories} onSaved={() => router.refresh()} />
            ))}
            {view.rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">No trims match these filters</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </Card>
    </>
  );
}

function TrimRow({ t, units, suppliers, categories, onSaved }: { t: TrimMasterRow; units: LookupRow[]; suppliers: Pick[]; categories: LookupRow[]; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  // Change 40 Part E — the edit form now holds the SAME fields as the add form, so Rate and
  // Supplier (previously settable only at creation) can be filled on an existing trim.
  const [name, setName] = useState(t.name);
  const [category, setCategory] = useState(t.category ?? "OTHER");
  const [supplierId, setSupplierId] = useState(t.supplierId != null ? String(t.supplierId) : "");
  const [rate, setRate] = useState(t.ratePerUnit != null ? String(t.ratePerUnit) : "");
  const [perPiece, setPerPiece] = useState(t.perPieceAvg != null ? String(t.perPieceAvg) : "");
  const [reorder, setReorder] = useState(t.reorderLevel != null ? String(t.reorderLevel) : "");
  const [unit, setUnit] = useState(t.unit ?? "pcs");
  const [spec, setSpec] = useState<Record<string, string>>({
    size: t.size ?? "", material: t.material ?? "", color: t.color ?? "", weight: t.weight ?? "", shape: t.shape ?? "",
  });
  const low = isLow(t);
  const specFields = CATEGORY_FIELDS[category] ?? [];

  async function save() {
    setBusy(true);
    try {
      await updateTrim({
        id: t.id,
        name: name.trim() || undefined,
        category: category as any,
        supplierId: supplierId ? +supplierId : null,
        ratePerUnit: rate.trim() === "" ? null : +rate,
        dimension: "FLAT", // Change 40 Part D — collapse; only FLAT is written going forward
        perPieceAvg: perPiece.trim() === "" ? null : +perPiece,
        reorderLevel: reorder.trim() === "" ? null : +reorder,
        unit: unit || null,
        size: spec.size.trim() || null,
        material: spec.material.trim() || null,
        color: spec.color.trim() || null,
        weight: spec.weight.trim() || null,
        shape: spec.shape.trim() || null,
      });
      setEditing(false);
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <>
      <tr className={`border-b border-hairline last:border-0 ${t.status === "DISCONTINUED" ? "opacity-50" : ""}`}>
        <td className="px-4 py-2.5"><Link href={`/trims/${t.id}`} className="font-semibold text-primary-ink hover:underline">{t.name}</Link></td>
        <td className="px-4 py-2.5 text-t2">{t.category ?? t.family ?? "—"}</td>
        <td className="px-4 py-2.5 text-t2">{t.supplier ?? "—"}</td>
        <td className="px-4 py-2.5 text-right tnum text-t2">{t.ratePerUnit != null ? `₹${num(t.ratePerUnit, 2)}` : "—"}</td>
        <td className="px-4 py-2.5 text-right tnum text-t2">{t.reorderLevel != null ? num(t.reorderLevel) : "—"}</td>
        <td className={`px-4 py-2.5 text-right tnum font-semibold ${t.current <= 0 ? "text-danger" : low ? "text-warn" : ""}`}>{num(t.current)}</td>
        <td className="px-4 py-2.5">{t.current <= 0 ? <Badge tone="danger">Indent</Badge> : low ? <Badge tone="warn">Low</Badge> : <Badge tone="ok">OK</Badge>}</td>
        <td className="px-4 py-2.5 text-right">
          <span className="inline-flex items-center gap-1.5">
            {/* Change 22 Part E: trims finally get the ledger-backed correction fabric had —
                the only doors into trim stock were a locked challan and the UI-less legacy
                recordTrimReceipt. */}
            <StockAdjust target={{ kind: "trim", trimItemId: t.id }} name={t.name} current={t.current} unit={t.unit} />
            <button onClick={() => setEditing((v) => !v)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 t-xs font-semibold text-t1 hover:bg-surface-2"><Settings2 size={12} /> Edit</button>
            {/* Change 36 Part 0. A trim has no `active` flag — its retire state is the
                status enum, so "deactivate" here means status = DISCONTINUED. */}
            <MasterDelete
              kind="trim"
              id={t.id}
              label="Trim"
              onDelete={() => deleteTrim({ id: t.id })}
              onDeactivate={t.status !== "DISCONTINUED" ? () => updateTrim({ id: t.id, status: "DISCONTINUED" }) : undefined}
            />
          </span>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-hairline bg-surface-2">
          <td colSpan={8} className="px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              {/* Change 40 Part E — full field parity with the add form. */}
              <Labelled label="Name">
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-48 rounded-lg border border-border px-2.5 py-1.5 t-sm outline-none focus:border-primary" />
              </Labelled>
              <Labelled label="Category">
                <LookupSelect kind="TRIM_CATEGORY" options={categories} value={category} onChange={setCategory} placeholder="Category…" className="w-36 rounded-lg border border-border px-2.5 py-1.5 t-sm outline-none focus:border-primary" />
              </Labelled>
              <Labelled label="Supplier">
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-40 rounded-lg border border-border px-2.5 py-1.5 t-sm outline-none focus:border-primary">
                  <option value="">— none —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Labelled>
              {/* Change 40 Part F3 — "Base price", never a bare "Rate", so it is not mistaken for the last price paid. */}
              <Labelled label="Base price (₹/unit)">
                <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="—" className="w-28 rounded-lg border border-border px-2.5 py-1.5 t-sm tnum outline-none focus:border-primary" />
              </Labelled>
              <Labelled label="Per-piece avg">
                <input type="number" value={perPiece} onChange={(e) => setPerPiece(e.target.value)} placeholder="—" className="w-24 rounded-lg border border-border px-2.5 py-1.5 t-sm tnum outline-none focus:border-primary" />
              </Labelled>
              <Labelled label="Reorder level">
                <input type="number" value={reorder} onChange={(e) => setReorder(e.target.value)} placeholder="—" className="w-24 rounded-lg border border-border px-2.5 py-1.5 t-sm tnum outline-none focus:border-primary" />
              </Labelled>
              <Labelled label="Unit">
                <LookupSelect kind="UNIT" options={units} value={unit} onChange={setUnit} placeholder="Unit…" className="w-28 rounded-lg border border-border px-2.5 py-1.5 t-sm outline-none focus:border-primary" />
              </Labelled>
              {specFields.map((sf) => (
                <Labelled key={sf} label={sf.charAt(0).toUpperCase() + sf.slice(1)}>
                  <input value={spec[sf]} onChange={(e) => setSpec((p) => ({ ...p, [sf]: e.target.value }))} placeholder="—" className="w-28 rounded-lg border border-border px-2.5 py-1.5 t-sm outline-none focus:border-primary" />
                </Labelled>
              ))}
              <button onClick={save} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 t-sm font-semibold text-accent-on disabled:opacity-40"><Check size={13} /> Save</button>
              <button onClick={() => setEditing(false)} className="rounded-lg border border-border px-3 py-1.5 t-sm text-t2">Cancel</button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block t-micro font-semibold uppercase tracking-wide text-faint">{label}</label>{children}</div>;
}
function In({ v, on, type = "text" }: { v?: string; on: (v: string) => void; type?: string }) {
  return <input type={type} value={v ?? ""} onChange={(e) => on(e.target.value)} className="w-full rounded-lg border border-border px-2.5 py-2 t-body outline-none focus:border-primary" />;
}
