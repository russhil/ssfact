"use client";

import { useState } from "react";
import { createLookup } from "@/lib/actions";
import { Check, X } from "lucide-react";
import type { LookupRow } from "@/lib/masters";

const ADD = "__add__";

/** Dropdown fed by a Lookup kind, with an inline "➕ Add new…" that persists + selects.
 *  Stores the label string (back-compat with existing free-text columns). */
export function LookupSelect({
  kind, options, value, onChange, placeholder = "Select…", className,
}: {
  kind: string;
  options: LookupRow[];
  value: string;
  onChange: (label: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [opts, setOpts] = useState(options);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const cls = className ?? "w-full rounded-lg border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary";

  async function confirm() {
    if (!draft.trim()) { setAdding(false); return; }
    setBusy(true);
    try {
      const r = await createLookup({ kind, label: draft });
      setOpts((p) => (p.some((o) => o.label === r.label) ? p : [...p, { id: r.id, code: r.label, label: r.label, hex: null, parentId: null, sortOrder: 999, active: true }]));
      onChange(r.label);
    } finally { setAdding(false); setDraft(""); setBusy(false); }
  }

  if (adding) {
    return (
      <div className="flex gap-1.5">
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirm()} placeholder="New value" className={cls} />
        <button type="button" onClick={confirm} disabled={busy} className="rounded-lg bg-primary px-2.5 text-white"><Check size={14} /></button>
        <button type="button" onClick={() => setAdding(false)} className="rounded-lg border border-border px-2.5 text-slate-500"><X size={14} /></button>
      </div>
    );
  }
  // value may be a legacy free-text not in opts → keep it selectable
  const hasValue = !value || opts.some((o) => o.label === value);
  return (
    <select value={value} onChange={(e) => (e.target.value === ADD ? setAdding(true) : onChange(e.target.value))} className={cls}>
      <option value="">{placeholder}</option>
      {!hasValue && <option value={value}>{value}</option>}
      {opts.map((o) => <option key={o.id} value={o.label}>{o.label}</option>)}
      <option value={ADD}>➕ Add new…</option>
    </select>
  );
}
