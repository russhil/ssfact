"use client";

/**
 * Change 39 Part G1/G3 — pick the authorised signatory (a person at our firm, name only) with
 * an inline "+ add" that closes the only path to an empty signatory. Never the login user.
 * Shared by the job-card form and the challan dialog.
 */
import { useState } from "react";
import { createFirmContactQuick } from "@/lib/actions";
import { Plus, Check, X } from "lucide-react";

export function SignatoryPicker({
  value,
  options,
  onChange,
  className = "",
}: {
  value: string;
  options: string[];
  onChange: (name: string) => void;
  className?: string;
}) {
  const [extra, setExtra] = useState<string[]>([]);
  const all = [...new Set([...options, ...extra, ...(value ? [value] : [])])];
  const [adding, setAdding] = useState(all.length === 0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const n = draft.trim();
    if (!n) return;
    setBusy(true);
    try {
      await createFirmContactQuick({ name: n });
      setExtra((p) => [...p, n]);
      onChange(n);
      setDraft("");
      setAdding(false);
    } catch (e) {
      alert("Could not add contact: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "w-full rounded-lg border border-border bg-surface px-3 py-2 t-body outline-none focus:border-primary";

  if (adding) {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        <input
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="New signatory name"
          className={inputCls}
        />
        <button type="button" onClick={add} disabled={busy} className="rounded-md border border-border p-2 text-ok hover:bg-surface-2 disabled:opacity-40"><Check size={14} /></button>
        {all.length > 0 && (
          <button type="button" onClick={() => setAdding(false)} className="rounded-md border border-border p-2 text-faint hover:bg-surface-2"><X size={14} /></button>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        <option value="">— firm name —</option>
        {all.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-2 t-xs font-semibold text-primary-ink hover:bg-surface-2">
        <Plus size={13} /> add
      </button>
    </div>
  );
}
