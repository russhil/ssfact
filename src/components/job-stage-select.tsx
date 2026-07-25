"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJobStage } from "@/lib/actions";
import { STAGES, STAGE_LABEL, stageTone, type Stage } from "@/lib/job-labels";

const toneClass: Record<ReturnType<typeof stageTone>, string> = {
  danger: "border-danger/40 bg-danger-soft text-danger",
  warn: "border-warn/30 bg-warn-soft text-warn",
  primary: "border-primary/30 bg-primary-soft text-primary-ink",
  ok: "border-ok/30 bg-ok-soft text-ok",
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
      className={`cursor-pointer rounded-full border px-2.5 py-1 t-xs font-bold outline-none disabled:opacity-50 ${toneClass[stageTone(value)]}`}
      aria-label="Stage"
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>{STAGE_LABEL[s]}</option>
      ))}
    </select>
  );
}
