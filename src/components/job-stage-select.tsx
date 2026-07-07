"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJobStage } from "@/lib/actions";
import { STAGES, STAGE_LABEL, stageTone, type Stage } from "@/lib/job-labels";

const toneClass: Record<ReturnType<typeof stageTone>, string> = {
  danger: "border-danger/40 bg-danger-soft text-danger",
  warn: "border-amber-300 bg-amber-100 text-amber-700",
  primary: "border-primary/30 bg-primary-soft text-primary-ink",
  ok: "border-emerald-300 bg-ok-soft text-emerald-700",
};

/** Inline stage editor — a coloured pill that is a native <select> under the hood. */
export function JobStageSelect({ jobCardId, stage }: { jobCardId: number; stage: Stage }) {
  const router = useRouter();
  const [value, setValue] = useState<Stage>(stage);
  const [pending, start] = useTransition();

  function change(next: Stage) {
    const prev = value;
    setValue(next);
    start(async () => {
      try {
        await setJobStage({ jobCardId, stage: next });
        router.refresh();
      } catch (e) {
        setValue(prev);
        alert("Could not update stage: " + (e as Error).message);
      }
    });
  }

  return (
    <select
      value={value}
      disabled={pending}
      onChange={(e) => change(e.target.value as Stage)}
      className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-bold outline-none disabled:opacity-50 ${toneClass[stageTone(value)]}`}
      aria-label="Stage"
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>{STAGE_LABEL[s]}</option>
      ))}
    </select>
  );
}
