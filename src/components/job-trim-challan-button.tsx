"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { draftTrimChallanForJob } from "@/lib/actions";
import { Truck } from "lucide-react";

/**
 * Change 19 A.3 — "more trims needed" is just another outward challan against the same card.
 * `fromRemainingBom` bills the BOM down by what locked challans already issued, so a top-up
 * carries only the shortfall. The job-card page is a server component, hence this wrapper.
 */
export function JobTrimChallanButton({ jobCardId }: { jobCardId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function raise(fromRemainingBom: boolean) {
    setBusy(true);
    try {
      const { id } = await draftTrimChallanForJob({ jobCardId, fromRemainingBom });
      router.push(`/challan-doc/${id}`);
    } catch (e) {
      alert((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        onClick={() => raise(true)}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 t-xs font-semibold text-primary-ink hover:bg-surface-2 disabled:opacity-40"
      >
        <Truck size={12} /> Raise outward trim challan
      </button>
      <button
        onClick={() => raise(false)}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 t-xs font-semibold text-t2 hover:bg-surface-2 disabled:opacity-40"
        title="Full BOM quantities"
      >
        full BOM
      </button>
    </div>
  );
}
