"use client";

/**
 * Change 39 Part F — ADMIN-only "Unlock for correction". Clears the freeze on a card whose
 * material has posted, for one correction save. The action writes an audit row (who/when/why).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { unlockJobCardForCorrection } from "@/lib/actions";
import { LockOpen } from "lucide-react";

export function UnlockJobButton({ jobCardId }: { jobCardId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    const reason = window.prompt("Unlock this card for correction. Reason (recorded in the audit log):", "");
    if (reason === null) return; // cancelled
    setBusy(true);
    try {
      await unlockJobCardForCorrection({ jobCardId, reason: reason.trim() || null });
      router.refresh();
    } catch (e) {
      alert("Could not unlock: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-lg border border-warn/40 px-3 py-2 t-body font-semibold text-warn hover:bg-warn-soft disabled:opacity-40"
    >
      <LockOpen size={14} /> {busy ? "…" : "Unlock for correction"}
    </button>
  );
}
