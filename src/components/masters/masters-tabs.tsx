"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createColour, deactivateColour } from "@/lib/actions";
import { MasterListManager } from "@/components/masters/master-list-manager";
import { CategoryTree } from "@/components/masters/category-tree";
import { Card, Badge } from "@/components/ui";
import { Plus, ExternalLink } from "lucide-react";
import type { LookupRow } from "@/lib/masters";

type Head = LookupRow & { children: LookupRow[] };
type Colour = { id: number; name: string; hex: string | null; active: boolean };

const SIMPLE = [
  ["categories", "Categories"], ["units", "Units"], ["supplier_types", "Supplier types"],
  ["trim_categories", "Trim categories"], ["style_groups", "Style groups"], ["colours", "Colours"],
] as const;
const RICH: [string, string][] = [
  ["Suppliers", "/suppliers"], ["Trims", "/trims"], ["Fabrics", "/inventory"],
  ["Products", "/catalog"], ["Vendors", "/vendors"], ["Cutting masters", "/vendors"],
];

export function MastersTabs({
  tree, units, supplierTypes, trimCategories, styleGroups, colours,
}: {
  tree: Head[]; units: LookupRow[]; supplierTypes: LookupRow[]; trimCategories: LookupRow[]; styleGroups: LookupRow[]; colours: Colour[];
}) {
  const [tab, setTab] = useState<string>("categories");

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[200px_1fr]">
      {/* tab rail (wraps to a row on phone) */}
      <div className="flex flex-wrap gap-1.5 md:flex-col">
        <div className="hidden text-[10px] font-bold uppercase tracking-wide text-faint md:block">Lists</div>
        {SIMPLE.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-left text-[13px] font-medium transition ${tab === k ? "bg-primary-soft text-primary-ink" : "text-slate-500 hover:bg-slate-50"}`}>{label}</button>
        ))}
        <div className="mt-2 hidden text-[10px] font-bold uppercase tracking-wide text-faint md:block">Rich masters</div>
        {RICH.map(([label, href]) => (
          <Link key={label} href={href} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-medium text-slate-500 hover:bg-slate-50"><ExternalLink size={12} /> {label}</Link>
        ))}
      </div>

      <Card className="p-5">
        {tab === "categories" && <CategoryTree tree={tree} />}
        {tab === "units" && <MasterListManager kind="UNIT" rows={units} hint="Units used on fabric & trim (MTR, KG, PCS…)." />}
        {tab === "supplier_types" && <MasterListManager kind="SUPPLIER_TYPE" rows={supplierTypes} hint="Supplier classifications." />}
        {tab === "trim_categories" && <MasterListManager kind="TRIM_CATEGORY" rows={trimCategories} hint="The trim master's 7 head categories." />}
        {tab === "style_groups" && <MasterListManager kind="STYLE_GROUP" rows={styleGroups} hint="Optional grouping used on products." />}
        {tab === "colours" && <ColourManager colours={colours} />}
      </Card>
    </div>
  );
}

function ColourManager({ colours }: { colours: Colour[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); router.refresh(); } finally { setBusy(false); } };
  return (
    <div>
      <p className="mb-2 text-[12px] text-muted">Shared colour master (also editable inline from fabric orders).</p>
      <div className="mb-3 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && run(async () => { await createColour({ name }); setName(""); })} placeholder="Add a colour…" className="w-64 rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-primary" />
        <button onClick={() => name.trim() && run(async () => { await createColour({ name }); setName(""); })} disabled={busy || !name.trim()} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40"><Plus size={14} /> Add</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {colours.map((c) => (
          <button key={c.id} onClick={() => run(() => deactivateColour({ id: c.id, active: !c.active }))} disabled={busy} className={`inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold ${c.active ? "" : "opacity-40"}`}>
            {c.hex && <span className="h-2.5 w-2.5 rounded-full border border-black/10" style={{ background: c.hex }} />}
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
