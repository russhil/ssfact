"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { upsertVendor, upsertCuttingMaster, deleteVendor, deleteCuttingMaster } from "@/lib/actions";
import { Card, Badge, SearchInput } from "@/components/ui";
import { Plus, Check } from "lucide-react";
import { MasterDelete } from "@/components/master-delete";
import type { MasterKind } from "@/lib/master-refs";

type Row = { id: number; name: string; active: boolean; jobs: number };
type VRow = Row & { kind: string };

export function VendorCuttingManager({ vendors, masters }: { vendors: VRow[]; masters: Row[] }) {
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
      <MiniMaster
        title="Vendors (stitching units)"
        rows={vendors}
        kind="vendor"
        noun="Vendor"
        onAdd={(name) => upsertVendor({ name })}
        onRename={(id, name) => upsertVendor({ id, name })}
        onToggle={(id, active) => upsertVendor({ id, name: vendors.find((v) => v.id === id)!.name, active })}
        onDelete={(id) => deleteVendor({ id })}
      />
      <MiniMaster
        title="Cutting masters"
        rows={masters}
        kind="cuttingMaster"
        noun="Cutting master"
        onAdd={(name) => upsertCuttingMaster({ name })}
        onRename={(id, name) => upsertCuttingMaster({ id, name })}
        onToggle={(id, active) => upsertCuttingMaster({ id, name: masters.find((m) => m.id === id)!.name, active })}
        onDelete={(id) => deleteCuttingMaster({ id })}
      />
    </div>
  );
}

function MiniMaster({
  title, rows, kind, noun, onAdd, onRename, onToggle, onDelete,
}: {
  title: string; rows: Row[]; kind: MasterKind; noun: string;
  onAdd: (name: string) => Promise<unknown>;
  onRename: (id: number, name: string) => Promise<unknown>;
  onToggle: (id: number, active: boolean) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  // Change 23 Part H: a search box on the small master lists — they grow.
  const [q, setQ] = useState("");
  // Change 36 Part 0: the always-visible Active pill is retired in favour of
  // Delete → (blocked) → Deactivate, so inactive rows are hidden by default and this
  // chip is how they stay findable.
  const [showOff, setShowOff] = useState(false);
  const shown = rows
    .filter((r) => showOff || r.active)
    .filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const offCount = rows.filter((r) => !r.active).length;
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); router.refresh(); } finally { setBusy(false); } };

  return (
    <Card className="p-4">
      <h3 className="mb-3 t-body font-bold">{title}</h3>
      <div className="mb-3 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && draft.trim() && run(async () => { await onAdd(draft); setDraft(""); })} placeholder="Add…" className="flex-1 rounded-lg border border-border px-3 py-2 t-body outline-none focus:border-primary" />
        <button onClick={() => draft.trim() && run(async () => { await onAdd(draft); setDraft(""); })} disabled={busy || !draft.trim()} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 t-sm font-semibold text-accent-on disabled:opacity-40"><Plus size={13} /> Add</button>
      </div>
      {rows.length > 8 && (
        <SearchInput
          size="sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${title.toLowerCase()}…`}
          wrapClassName="mb-2"
        />
      )}
      {offCount > 0 && (
        <button
          onClick={() => setShowOff((v) => !v)}
          className={`mb-2 rounded-full border px-2.5 py-0.5 t-xs font-semibold ${showOff ? "border-primary text-primary-ink" : "border-border text-faint hover:text-ink"}`}
        >
          Inactive {offCount}
        </button>
      )}
      <div className="max-h-[420px] overflow-y-auto">
        {shown.map((r) => {
          const val = edits[r.id] ?? r.name;
          const dirty = val !== r.name;
          return (
            <div key={r.id} className={`flex items-center gap-2 border-b border-hairline py-1.5 last:border-0 ${r.active ? "" : "opacity-50"}`}>
              <input value={val} onChange={(e) => setEdits((p) => ({ ...p, [r.id]: e.target.value }))} className="flex-1 rounded-md border border-transparent px-2 py-1 t-body outline-none hover:border-border focus:border-primary" />
              <span className="t-micro text-faint">{r.jobs} jobs</span>
              {dirty && (
                <button onClick={() => run(async () => { await onRename(r.id, val); setEdits((p) => { const n = { ...p }; delete n[r.id]; return n; }); })} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 t-xs font-semibold text-accent-on"><Check size={11} /> Save</button>
              )}
              {!r.active && (
                <button onClick={() => run(() => onToggle(r.id, true))} disabled={busy} title="Reactivate"><Badge tone="default">Inactive</Badge></button>
              )}
              <MasterDelete
                kind={kind}
                id={r.id}
                label={noun}
                onDelete={() => onDelete(r.id)}
                onDeactivate={r.active ? () => onToggle(r.id, false) : undefined}
                disabled={busy}
              />
            </div>
          );
        })}
        {rows.length === 0 && <p className="py-4 text-center t-sm text-muted">None</p>}
      </div>
    </Card>
  );
}
