import { cn } from "@/lib/cn";

/* Controlled — the parent owns the value, so this stays usable from both
   server and client trees. Replaces the hand-rolled filter-pill rows. */

export type SegmentOption<T extends string> = {
  key: T;
  label: React.ReactNode;
  count?: number;
};

export function SegmentedFilter<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentOption<T>[];
  className?: string;
}) {
  return (
    <div className={cn("inline-flex gap-1 rounded-xl bg-surface-2 p-1", className)} role="group">
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 t-sm font-semibold",
              "transition-[background-color,color,box-shadow] duration-150",
              "active:scale-[0.97] active:transition-transform active:duration-75",
              active ? "bg-surface text-t1 elev-sm" : "text-t2 hover:text-t1"
            )}
          >
            {o.label}
            {o.count != null && (
              <span className={cn("tnum t-xs font-bold", active ? "text-t3" : "text-t3")}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
