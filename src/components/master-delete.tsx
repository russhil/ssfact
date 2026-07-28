"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { IconButton, Sheet, Button, Badge } from "@/components/ui";
import { runAction } from "@/lib/action-result";
import { checkMasterRefs } from "@/lib/actions";
import type { MasterKind, MasterRefs } from "@/lib/master-refs";

/**
 * Change 36 Part 0 — the Delete control every master row now carries.
 *
 * The flow is deliberately check-then-delete rather than try-then-parse. Server actions
 * in this app throw, and a thrown Error carries only a string — it cannot carry the
 * reference groups the owner needs to see. So Delete asks checkMasterRefs first:
 *   total === 0  → confirm, then delete
 *   total  >  0  → open the where-used panel with the groups already in hand
 *
 * The panel is also the only place deactivate now lives: the always-visible Active pill
 * is retired in favour of Delete → (blocked) → Deactivate, which is the decision the
 * owner is actually making.
 */
export function MasterDelete({
  kind,
  id,
  label,
  onDelete,
  onDeactivate,
  disabled,
}: {
  kind: MasterKind;
  id: number;
  /** What this master is called on screen — "Supplier", "Fabric", "Firm". */
  label: string;
  onDelete: () => Promise<unknown>;
  /** Omitted when the master has no retire flag; the panel then only explains. */
  onDeactivate?: () => Promise<unknown>;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refs, setRefs] = useState<MasterRefs | null>(null);

  async function start() {
    setBusy(true);
    try {
      const found = await checkMasterRefs({ kind, id });
      if (found.total > 0) {
        setRefs(found);
        return;
      }
      if (!confirm(`Delete ${label.toLowerCase()} ${found.name}? This cannot be undone.`)) return;
      if (await runAction(onDelete)) router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!onDeactivate) return;
    setBusy(true);
    try {
      if (await runAction(onDeactivate)) {
        setRefs(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <IconButton
        label={`Delete ${label.toLowerCase()}`}
        onClick={start}
        disabled={busy || disabled}
        className="text-faint hover:text-danger"
      >
        <Trash2 size={14} />
      </IconButton>

      <Sheet
        open={refs != null}
        onClose={() => setRefs(null)}
        title={refs ? `${label} ${refs.name} is in use` : ""}
        subtitle={refs ? `${refs.total} ${refs.total === 1 ? "entry references" : "entries reference"} it` : ""}
        width={460}
        footer={
          onDeactivate ? (
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => setRefs(null)} disabled={busy}>Cancel</Button>
              <Button onClick={deactivate} disabled={busy}>Deactivate instead</Button>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setRefs(null)}>Close</Button>
          )
        }
      >
        <div className="flex flex-col gap-3">
          {refs?.groups.map((g) => (
            <div key={g.label} className="rounded-lg border border-hairline p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="t-sm font-semibold text-t1">{g.label}</span>
                <Badge tone="warn">{g.count}</Badge>
              </div>
              {g.sample.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {g.sample.map((s) =>
                    s.href ? (
                      <li key={String(s.id)}>
                        <Link href={s.href} className="t-xs text-primary-ink hover:underline">{s.label}</Link>
                      </li>
                    ) : (
                      <li key={String(s.id)} className="t-xs text-muted">{s.label}</li>
                    )
                  )}
                  {g.count > g.sample.length && (
                    <li className="t-xs text-faint">+{g.count - g.sample.length} more</li>
                  )}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
}
