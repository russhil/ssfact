"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { setFabricReorderLevel } from "@/lib/actions";
import { runAction } from "@/lib/action-result";
import { inputClass } from "@/components/ui";
import { num } from "@/lib/format";

/**
 * Change 25 Part E — the per-colour reorder trigger, edited in place beside the
 * stock figure it guards. Blank clears it, which stops the colour being alerted on.
 */
export function ReorderLevel({
  fabricColorId,
  level,
  unit,
}: {
  fabricColorId: number;
  level: number | null;
  unit?: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(level != null ? String(level) : "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const trimmed = value.trim();
    const ok = await runAction(() =>
      setFabricReorderLevel({ fabricColorId, level: trimmed === "" ? null : Number(trimmed) })
    );
    if (ok) {
      setEditing(false);
      router.refresh();
    }
    setBusy(false);
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`t-xs tnum ${level == null ? "text-faint hover:text-t2" : "font-semibold text-t2 hover:text-t1"}`}
        title="Reorder level"
      >
        {level == null ? "set" : `${num(level, 2)}${unit ? ` ${unit}` : ""}`}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        step="any"
        min={0}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className={inputClass("sm", "w-20 text-right tnum")}
      />
      <button onClick={save} disabled={busy} className="text-ok disabled:opacity-40" title="Save">
        <Check size={13} />
      </button>
      <button onClick={() => setEditing(false)} disabled={busy} className="text-faint hover:text-danger" title="Cancel">
        <X size={13} />
      </button>
    </span>
  );
}
