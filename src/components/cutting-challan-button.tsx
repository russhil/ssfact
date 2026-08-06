"use client";

/**
 * Change 39 Part D2 — raise a cutting challan (colour × size cut goods) from one lay and jump
 * straight to the draft document. The pieces are derived from the lay's cells, never re-typed.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCuttingChallan } from "@/lib/actions";
import { Scissors } from "lucide-react";

export function CuttingChallanButton({ jobCardId, layerId }: { jobCardId: number; layerId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const { id } = await createCuttingChallan({ jobCardId, layerId });
      router.push(`/challan-doc/${id}`);
    } catch (e) {
      alert("Could not raise cutting challan: " + (e as Error).message);
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      className="inline-flex items-center gap-1 t-xs font-semibold text-primary-ink hover:underline disabled:opacity-40"
      title="Issue this lay's cut goods (colour × size) as an outward challan"
    >
      <Scissors size={12} /> {busy ? "…" : "Cutting challan"}
    </button>
  );
}
