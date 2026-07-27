import { Card } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { Check } from "lucide-react";

export type TimelineStep = { label: string; date: Date | string | null; done: boolean };

// Horizontal Cut → Fabric → Stitching → Received → Closed. Steps with no logged
// data show "not logged yet" — the timeline always renders (logging is optional).
export function StatusTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <Card className="mt-3.5 p-5">
      <h3 className="mb-4 t-body font-bold">Status Timeline</h3>
      <ol className="flex flex-col gap-3 md:flex-row md:gap-0">
        {steps.map((s, i) => (
          <li key={s.label} className="flex flex-1 items-center gap-3 md:flex-col md:items-stretch md:gap-0">
            {/* Rail: half-segment · dot · half-segment, so the line meets each dot's centre. */}
            <div className="flex items-center md:w-full">
              <span
                className={`hidden h-px flex-1 md:block ${
                  i === 0 ? "bg-transparent" : s.done ? "bg-primary/35" : "bg-border"
                }`}
              />
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full t-xs font-semibold transition-colors ${
                  s.done ? "bg-primary text-accent-on" : "border border-dashed border-border bg-surface text-faint"
                }`}
              >
                {s.done ? <Check size={13} strokeWidth={3} /> : i + 1}
              </span>
              <span
                className={`hidden h-px flex-1 md:block ${
                  i === steps.length - 1 ? "bg-transparent" : steps[i + 1].done ? "bg-primary/35" : "bg-border"
                }`}
              />
            </div>
            <div className="min-w-0 md:mt-2.5 md:px-2 md:text-center">
              <div className={`truncate t-sm font-semibold ${s.done ? "text-ink" : "text-faint"}`}>{s.label}</div>
              <div className="truncate t-xs text-muted">{s.done && s.date ? fmtDate(s.date) : "not logged yet"}</div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
