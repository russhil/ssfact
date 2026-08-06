"use client";

import { useEffect, useState } from "react";
import { Delete } from "lucide-react";
import { BottomSheet } from "./sheet";
import { cn } from "@/lib/cn";

/**
 * Change 40 — a single-cell numeric editor for phones. The desktop cutting grid
 * edits a wide colour×size matrix inline; on a phone that can't exist, so a tap
 * on any one figure opens THIS — a big display + an on-screen keypad, so exactly
 * one value is ever in focus and there's no horizontal scrolling. Its own keypad
 * (not the OS keyboard) so the sheet is never covered.
 *
 * Commits the draft on Done and on close; `onChange` receives the raw string
 * (empty string clears), matching the string-based LayerState fields.
 */
export function NumpadSheet({
  open,
  onClose,
  title,
  subtitle,
  value,
  onChange,
  integer = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  /** whole numbers only — hides the decimal point (qty, bundles) */
  integer?: boolean;
}) {
  const [draft, setDraft] = useState(value);

  // reopen with the latest committed value
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const commit = (v: string) => {
    onChange(v);
    onClose();
  };

  const press = (k: string) => {
    setDraft((d) => {
      if (k === "back") return d.slice(0, -1);
      if (k === ".") return d.includes(".") || d === "" ? d || "0." : d + ".";
      // no leading zeros like "07"
      if (d === "0" && k !== ".") return k;
      return d + k;
    });
  };

  const keys = integer
    ? ["7", "8", "9", "4", "5", "6", "1", "2", "3", "clear", "0", "back"]
    : ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "back"];

  return (
    <BottomSheet
      open={open}
      onClose={() => commit(draft)}
      title={title}
      subtitle={subtitle}
      footer={
        <>
          <button
            onClick={() => commit("")}
            className="rounded-lg px-3 py-2 t-sm font-semibold text-t3 active:scale-[0.97] hover:text-danger"
          >
            Clear
          </button>
          <button
            onClick={() => commit(draft)}
            className="ml-auto rounded-lg bg-accent px-5 py-2 t-sm font-semibold text-accent-on active:scale-[0.97]"
          >
            Done
          </button>
        </>
      }
    >
      <div className="grid h-16 place-items-end rounded-xl bg-surface-2 px-4">
        <span className="t-stat font-bold tnum text-t1">{draft || "0"}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {keys.map((k) =>
          k === "clear" ? (
            <button key="clear" onClick={() => setDraft("")} className={keyCls("text-t3")}>
              C
            </button>
          ) : k === "back" ? (
            <button key="back" onClick={() => press("back")} aria-label="Delete" className={keyCls()}>
              <Delete size={20} />
            </button>
          ) : (
            <button key={k} onClick={() => press(k)} className={keyCls()}>
              {k}
            </button>
          )
        )}
      </div>
    </BottomSheet>
  );
}

const keyCls = (extra?: string) =>
  cn(
    "grid h-14 place-items-center rounded-xl bg-surface-2 t-title font-semibold tnum text-t1",
    "active:scale-[0.96] active:bg-accent-soft active:text-accent transition-transform duration-75",
    extra
  );
