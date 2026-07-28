"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createColour, deactivateColour, deleteColour } from "@/lib/actions";
import { MasterDelete } from "@/components/master-delete";
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
  ["Products", "/catalog"], ["Vendors", "/vendors"],
  // Change 25 Part G.2: the issuing-firm master. Replaces a duplicate "Cutting
  // masters" tile that pointed at /vendors, the same href as Vendors.
  ["Buyers", "/buyers"],
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
        <div className="hidden t-micro font-bold uppercase tracking-wide text-faint md:block">Lists</div>
        {SIMPLE.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-left t-body font-medium transition ${tab === k ? "bg-primary-soft text-primary-ink" : "text-t2 hover:bg-surface-2"}`}>{label}</button>
        ))}
        <div className="mt-2 hidden t-micro font-bold uppercase tracking-wide text-faint md:block">Rich masters</div>
        {RICH.map(([label, href]) => (
          <Link key={label} href={href} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 t-body font-medium text-t2 hover:bg-surface-2"><ExternalLink size={12} /> {label}</Link>
        ))}
      </div>

      <Card className="p-5">
        {tab === "categories" && <CategoryTree tree={tree} />}
        {tab === "units" && <MasterListManager kind="UNIT" rows={units} hint="MTR, KG, PCS…" />}
        {tab === "supplier_types" && <MasterListManager kind="SUPPLIER_TYPE" rows={supplierTypes} hint="Supplier classifications" />}
        {tab === "trim_categories" && <MasterListManager kind="TRIM_CATEGORY" rows={trimCategories} hint="Trim head categories" />}
        {tab === "style_groups" && <MasterListManager kind="STYLE_GROUP" rows={styleGroups} hint="Product groupings" />}
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
      
      <div className="mb-3 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && run(async () => { await createColour({ name }); setName(""); })} placeholder="Add a colour…" className="w-64 rounded-lg border border-border px-3 py-2 t-body outline-none focus:border-primary" />
        <button onClick={() => name.trim() && run(async () => { await createColour({ name }); setName(""); })} disabled={busy || !name.trim()} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 t-body font-semibold text-accent-on disabled:opacity-40"><Plus size={14} /> Add</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {/* Change 36 Part 0: the chip no longer toggles active on click — a stray click
            used to silently retire a colour. Clicking an inactive chip brings it back;
            retiring now goes through Delete → (blocked) → Deactivate. */}
        {colours.map((c) => (
          <span key={c.id} className={`inline-flex items-center gap-1.5 rounded-full border border-border py-1 pl-2.5 pr-1 t-xs font-semibold ${c.active ? "" : "opacity-40"}`}>
            {c.hex && <span className="h-2.5 w-2.5 rounded-full border border-black/10" style={{ background: c.hex }} />}
            {c.active ? (
              c.name
            ) : (
              <button onClick={() => run(() => deactivateColour({ id: c.id, active: true }))} disabled={busy} title="Reactivate">
                {c.name}
              </button>
            )}
            <MasterDelete
              kind="colour"
              id={c.id}
              label="Colour"
              onDelete={() => deleteColour({ id: c.id })}
              onDeactivate={c.active ? () => deactivateColour({ id: c.id, active: false }) : undefined}
              disabled={busy}
            />
          </span>
        ))}
      </div>
    </div>
  );
}
