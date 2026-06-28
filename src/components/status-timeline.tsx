import { Card } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { Check } from "lucide-react";

export type TimelineStep = { label: string; date: Date | string | null; done: boolean };

// Horizontal Cut → Fabric → Stitching → Received → Closed. Steps with no logged
// data show "not logged yet" — the timeline always renders (logging is optional).
export function StatusTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <Card className="mt-3.5 p-5">
      <h3 className="mb-4 text-[13px] font-bold">Status Timeline</h3>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-0">
        {steps.map((s, i) => (
          <div key={s.label} className="flex flex-1 items-start gap-3 md:flex-col md:items-center md:text-center">
            <div className="flex items-center md:w-full md:flex-col">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  s.done ? "bg-primary text-white" : "border border-dashed border-border bg-slate-50 text-faint"
                }`}
              >
                {s.done ? <Check size={14} /> : i + 1}
              </div>
              {i < steps.length - 1 && (
                <div className={`hidden h-0.5 w-full md:block ${steps[i + 1].done ? "bg-primary" : "bg-border"}`} />
              )}
            </div>
            <div className="md:mt-1.5">
              <div className={`text-[12px] font-semibold ${s.done ? "text-ink" : "text-faint"}`}>{s.label}</div>
              <div className="text-[11px] text-muted">{s.done && s.date ? fmtDate(s.date) : "not logged yet"}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
