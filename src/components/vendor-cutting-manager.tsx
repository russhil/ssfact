"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { upsertVendor, upsertCuttingMaster } from "@/lib/actions";
import { Card, Badge } from "@/components/ui";
import { Plus, Check } from "lucide-react";

type Row = { id: number; name: string; active: boolean; jobs: number };
type VRow = Row & { kind: string };

export function VendorCuttingManager({ vendors, masters }: { vendors: VRow[]; masters: Row[] }) {
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
      <MiniMaster
        title="Vendors (stitching units)"
        rows={vendors}
        onAdd={(name) => upsertVendor({ name })}
        onRename={(id, name) => upsertVendor({ id, name })}
        onToggle={(id, active) => upsertVendor({ id, name: vendors.find((v) => v.id === id)!.name, active })}
      />
      <MiniMaster
        title="Cutting masters"
        rows={masters}
        onAdd={(name) => upsertCuttingMaster({ name })}
        onRename={(id, name) => upsertCuttingMaster({ id, name })}
        onToggle={(id, active) => upsertCuttingMaster({ id, name: masters.find((m) => m.id === id)!.name, active })}
      />
    </div>
  );
}

function MiniMaster({
  title, rows, onAdd, onRename, onToggle,
}: {
  title: string; rows: Row[];
  onAdd: (name: string) => Promise<unknown>;
  onRename: (id: number, name: string) => Promise<unknown>;
  onToggle: (id: number, active: boolean) => Promise<unknown>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); router.refresh(); } finally { setBusy(false); } };

  return (
    <Card className="p-4">
      <h3 className="mb-3 text-[13px] font-bold">{title}</h3>
      <div className="mb-3 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && draft.trim() && run(async () => { await onAdd(draft); setDraft(""); })} placeholder="Add…" className="flex-1 rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-primary" />
        <button onClick={() => draft.trim() && run(async () => { await onAdd(draft); setDraft(""); })} disabled={busy || !draft.trim()} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40"><Plus size={13} /> Add</button>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {rows.map((r) => {
          const val = edits[r.id] ?? r.name;
          const dirty = val !== r.name;
          return (
            <div key={r.id} className={`flex items-center gap-2 border-b border-slate-50 py-1.5 last:border-0 ${r.active ? "" : "opacity-50"}`}>
              <input value={val} onChange={(e) => setEdits((p) => ({ ...p, [r.id]: e.target.value }))} className="flex-1 rounded-md border border-transparent px-2 py-1 text-[13px] outline-none hover:border-border focus:border-primary" />
              <span className="text-[10px] text-faint">{r.jobs} jobs</span>
              {dirty ? (
                <button onClick={() => run(async () => { await onRename(r.id, val); setEdits((p) => { const n = { ...p }; delete n[r.id]; return n; }); })} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-white"><Check size={11} /> Save</button>
              ) : (
                <button onClick={() => run(() => onToggle(r.id, !r.active))} disabled={busy}>{r.active ? <Badge tone="ok">Active</Badge> : <Badge tone="default">Off</Badge>}</button>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <p className="py-4 text-center text-[12px] text-muted">None yet.</p>}
      </div>
    </Card>
  );
}
