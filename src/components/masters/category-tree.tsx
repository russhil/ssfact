"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createLookup, updateLookup, deactivateLookup } from "@/lib/actions";
import { Badge } from "@/components/ui";
import { Plus, CornerDownRight } from "lucide-react";
import type { LookupRow } from "@/lib/masters";

type Head = LookupRow & { children: LookupRow[] };

export function CategoryTree({ tree }: { tree: Head[] }) {
  const router = useRouter();
  const [head, setHead] = useState("");
  const [subFor, setSubFor] = useState<number | null>(null);
  const [sub, setSub] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); router.refresh(); } finally { setBusy(false); } };

  return (
    <div>
      <p className="mb-2 text-[12px] text-muted">Head categories with sub-categories nested under them. Add a head, add subs, rename, re-parent or deactivate.</p>
      <div className="mb-3 flex gap-2">
        <input value={head} onChange={(e) => setHead(e.target.value)} onKeyDown={(e) => e.key === "Enter" && head.trim() && run(async () => { await createLookup({ kind: "HEAD_CATEGORY", label: head }); setHead(""); })} placeholder="Add head category…" className="w-64 rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-primary" />
        <button onClick={() => head.trim() && run(async () => { await createLookup({ kind: "HEAD_CATEGORY", label: head }); setHead(""); })} disabled={busy || !head.trim()} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40"><Plus size={14} /> Head</button>
      </div>

      <div className="space-y-2">
        {tree.map((h) => (
          <div key={h.id} className={`rounded-lg border border-border p-3 ${h.active ? "" : "opacity-50"}`}>
            <div className="flex items-center justify-between">
              <input defaultValue={h.label} onBlur={(e) => e.target.value.trim() && e.target.value !== h.label && run(() => updateLookup({ id: h.id, label: e.target.value }))} className="rounded-md border border-transparent px-2 py-1 text-[13px] font-bold outline-none hover:border-border focus:border-primary" />
              <div className="flex items-center gap-2">
                <button onClick={() => setSubFor(subFor === h.id ? null : h.id)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-ink hover:underline"><CornerDownRight size={12} /> add sub</button>
                <button onClick={() => run(() => deactivateLookup({ id: h.id, active: !h.active }))} disabled={busy}>{h.active ? <Badge tone="ok">Active</Badge> : <Badge tone="default">Off</Badge>}</button>
              </div>
            </div>
            {subFor === h.id && (
              <div className="mt-2 flex gap-2 pl-5">
                <input autoFocus value={sub} onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sub.trim() && run(async () => { await createLookup({ kind: "SUB_CATEGORY", label: sub, parentId: h.id }); setSub(""); })} placeholder={`Sub-category under ${h.label}…`} className="w-56 rounded-lg border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-primary" />
                <button onClick={() => sub.trim() && run(async () => { await createLookup({ kind: "SUB_CATEGORY", label: sub, parentId: h.id }); setSub(""); })} disabled={busy} className="rounded-lg bg-primary px-2.5 text-[12px] font-semibold text-white">Add</button>
              </div>
            )}
            {h.children.length > 0 && (
              <div className="mt-2 space-y-1 pl-5">
                {h.children.map((c) => (
                  <div key={c.id} className={`flex items-center justify-between ${c.active ? "" : "opacity-50"}`}>
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <CornerDownRight size={12} className="text-faint" />
                      <input defaultValue={c.label} onBlur={(e) => e.target.value.trim() && e.target.value !== c.label && run(() => updateLookup({ id: c.id, label: e.target.value }))} className="rounded-md border border-transparent px-1.5 py-0.5 text-[12px] outline-none hover:border-border focus:border-primary" />
                    </div>
                    <div className="flex items-center gap-2">
                      <select value={c.parentId ?? ""} onChange={(e) => run(() => updateLookup({ id: c.id, parentId: e.target.value ? +e.target.value : null }))} className="rounded-md border border-border px-1.5 py-0.5 text-[11px] outline-none">
                        {tree.map((hh) => <option key={hh.id} value={hh.id}>{hh.label}</option>)}
                      </select>
                      <button onClick={() => run(() => deactivateLookup({ id: c.id, active: !c.active }))} disabled={busy} className="text-[11px] text-faint hover:text-danger">{c.active ? "off" : "on"}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {tree.length === 0 && <p className="text-[12px] text-muted">No head categories yet.</p>}
      </div>
    </div>
  );
}
