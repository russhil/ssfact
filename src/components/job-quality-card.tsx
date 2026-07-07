"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setJobQuality } from "@/lib/actions";
import { Card } from "@/components/ui";
import { num } from "@/lib/format";

const inp = "w-24 rounded-md border border-border px-2 py-1.5 text-right text-[12px] tnum outline-none focus:border-primary";
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

type Props = {
  jobCardId: number;
  canEdit: boolean;
  rejectQty: number | null;
  alterQty: number | null;
  extraQty: number | null;
};

/** Optional quality/quantity capture (Change 12, Part G): reject · alter · extra. */
export function JobQualityCard({ jobCardId, canEdit, rejectQty, alterQty, extraQty }: Props) {
  const router = useRouter();
  const [reject, setReject] = useState(rejectQty?.toString() ?? "");
  const [alter, setAlter] = useState(alterQty?.toString() ?? "");
  const [extra, setExtra] = useState(extraQty?.toString() ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await setJobQuality({
        jobCardId,
        rejectQty: numOrNull(reject),
        alterQty: numOrNull(alter),
        extraQty: numOrNull(extra),
      });
      router.refresh();
    } catch (e) {
      alert("Could not save: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <Card className="mt-3.5 p-5">
        <h3 className="mb-3 text-[13px] font-bold">Quality <span className="font-medium text-faint">· reject · alter · extra</span></h3>
        <div className="grid grid-cols-3 gap-3.5 text-[12px]">
          {([["Reject", rejectQty], ["Alteration", alterQty], ["Extra", extraQty]] as const).map(([l, v]) => (
            <div key={l}>
              <div className="text-[11px] text-faint">{l}</div>
              <div className="mt-0.5 font-semibold tnum">{v != null ? `${num(v)} pcs` : "—"}</div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="mt-3.5 p-5">
      <h3 className="mb-3 text-[13px] font-bold">Quality <span className="font-medium text-faint">· optional pcs — reject · alter · extra</span></h3>
      <div className="flex flex-wrap items-end gap-4 text-[12px]">
        {([["Reject", reject, setReject], ["Alteration", alter, setAlter], ["Extra", extra, setExtra]] as const).map(([label, val, set]) => (
          <label key={label} className="flex flex-col gap-1">
            <span className="text-[11px] text-faint">{label}</span>
            <input type="number" value={val} onChange={(e) => set(e.target.value)} placeholder="—" className={inp} />
          </label>
        ))}
        <button onClick={save} disabled={busy} className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-40">
          Save
        </button>
      </div>
    </Card>
  );
}
