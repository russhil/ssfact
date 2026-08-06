"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteFabricOrder, deleteTrimOrder } from "@/lib/actions";
import { Badge, Card, useConfirm } from "@/components/ui";
import { num } from "@/lib/format";
import { Trash2 } from "lucide-react";

export type OrderDraft = { id: number; name: string; supplier: string | null; qty: number };

/**
 * Change 38 Part A — purchase orders started and not yet placed.
 *
 * A DRAFT order has pushed nothing outward: no unit onto the material master, no sourcing
 * rate against a supplier it may never be sent to, no goods. It is kept out of the order
 * table and its counts for exactly that reason, and shown here so it is not lost.
 */
export function OrderDraftsStrip({ kind, drafts }: { kind: "FABRIC" | "TRIM"; drafts: OrderDraft[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<number | null>(null);
  if (drafts.length === 0) return null;

  async function discard(d: OrderDraft) {
    if (
      !(await confirm({
        title: `Discard draft order for ${d.name}?`,
        message: "It was never placed, so nothing is reversed.",
        tone: "danger",
        confirmLabel: "Discard",
      }))
    )
      return;
    setBusy(d.id);
    try {
      await (kind === "FABRIC" ? deleteFabricOrder({ id: d.id }) : deleteTrimOrder({ id: d.id }));
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mb-4 p-4">
      <h3 className="mb-2 flex items-center gap-2 t-xs font-bold uppercase tracking-wide text-muted">
        Drafts <Badge tone="warn">{drafts.length}</Badge>
      </h3>
      <div className="divide-y divide-hairline">
        {drafts.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-3 py-2 t-sm">
            <span className="min-w-0 flex-1 truncate font-semibold text-t1">
              {d.name}
              {d.supplier && <span className="ml-1.5 font-normal text-faint">· {d.supplier}</span>}
            </span>
            <span className="flex items-center gap-3 t-xs text-faint">
              <span className="tnum">{d.qty > 0 ? num(d.qty) : "no qty yet"}</span>
              <button
                type="button"
                onClick={() => discard(d)}
                disabled={busy === d.id}
                title="Discard this draft"
                className="text-faint transition hover:text-danger disabled:opacity-40"
              >
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
