"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { runAction } from "@/lib/action-result";
import { draftReorderPO } from "@/lib/actions";
import { num } from "@/lib/format";

/**
 * Change 36 Part 6 Part C — turn a reorder alert into a draft purchase order.
 *
 * It drafts; it does not order. The PO lands in PLANNING with no number, so the owner
 * still confirms it — "no automated ordering" is the rule, and this only removes the
 * re-typing.
 */
export function DraftPOButton({
  kind,
  id,
  gap,
  unit,
  name,
}: {
  kind: "FABRIC" | "TRIM";
  id: number;
  gap: number;
  unit: string;
  name: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      disabled={busy}
      title={`Draft an order for ${num(gap, 2)} ${unit} of ${name}`}
      onClick={async (ev) => {
        // The row is a Link; drafting must not also navigate.
        ev.preventDefault();
        ev.stopPropagation();
        const qty = prompt(`How much ${name} to order? (${unit})`, String(Math.max(gap, 0)));
        if (!qty) return;
        setBusy(true);
        const ok = await runAction(() => draftReorderPO({ kind, id, qty: Number(qty) }));
        setBusy(false);
        if (ok) router.push(kind === "TRIM" ? "/trim-orders" : "/fabric-orders");
      }}
      className="shrink-0 rounded-md border border-border px-2 py-0.5 t-xs font-semibold text-primary-ink hover:bg-surface-2 disabled:opacity-40"
    >
      {busy ? "…" : "Draft PO"}
    </button>
  );
}
