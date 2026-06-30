"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createLookup, updateLookup, deactivateLookup, reorderLookup } from "@/lib/actions";
import { Badge } from "@/components/ui";
import { Plus, ChevronUp, ChevronDown, Check } from "lucide-react";
import type { LookupRow } from "@/lib/masters";

export function MasterListManager({ kind, rows, hint }: { kind: string; rows: LookupRow[]; hint?: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); router.refresh(); } finally { setBusy(false); } };

  async function add() {
    if (!draft.trim()) return;
    await run(async () => { await createLookup({ kind, label: draft }); setDraft(""); });
  }
  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const ids = rows.map((r) => r.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await run(() => reorderLookup({ ids }));
  }

  return (
    <div>
      {hint && <p className="mb-2 text-[12px] text-muted">{hint}</p>}
      <div className="mb-3 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Add a value…" className="w-64 rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-primary" />
        <button onClick={add} disabled={busy || !draft.trim()} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40"><Plus size={14} /> Add</button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-[12px]">
          <tbody>
            {rows.map((r, i) => {
              const val = edits[r.id] ?? r.label;
              const dirty = val !== r.label;
              return (
                <tr key={r.id} className={`border-b border-slate-50 last:border-0 ${r.active ? "" : "opacity-50"}`}>
                  <td className="w-10 px-2 py-1.5 text-faint">
                    <div className="flex flex-col">
                      <button onClick={() => move(i, -1)} disabled={busy || i === 0} className="hover:text-ink disabled:opacity-20"><ChevronUp size={13} /></button>
                      <button onClick={() => move(i, 1)} disabled={busy || i === rows.length - 1} className="hover:text-ink disabled:opacity-20"><ChevronDown size={13} /></button>
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <input value={val} onChange={(e) => setEdits((p) => ({ ...p, [r.id]: e.target.value }))} className="w-full rounded-md border border-transparent px-2 py-1 text-[13px] outline-none hover:border-border focus:border-primary" />
                  </td>
                  <td className="w-20 px-2 py-1.5 text-faint">{r.code}</td>
                  <td className="w-24 px-2 py-1.5 text-right">
                    {dirty ? (
                      <button onClick={() => run(async () => { await updateLookup({ id: r.id, label: val }); setEdits((p) => { const n = { ...p }; delete n[r.id]; return n; }); })} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-white"><Check size={11} /> Save</button>
                    ) : (
                      <button onClick={() => run(() => deactivateLookup({ id: r.id, active: !r.active }))} disabled={busy}>
                        {r.active ? <Badge tone="ok">Active</Badge> : <Badge tone="default">Off</Badge>}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td className="px-3 py-6 text-center text-muted">No values yet — add one above.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
