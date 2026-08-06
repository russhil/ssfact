import { cn } from "@/lib/cn";

/**
 * Change 40 — the table→card lever for phones. A dense <table> can't be read on
 * a 390px screen; on mobile each row becomes a tap-target card instead. Fed the
 * SAME `view.rows` the desktop table renders, so search/filter/sort/CSV (from
 * useTableView) keep working untouched — only the row's presentation changes.
 *
 * `renderCard` returns the whole card body (often a Link). Kept deliberately
 * open so each screen shows the two or three figures that matter on that screen,
 * exactly like the hand-built cards on /my-work.
 */
export function MobileCardList<T>({
  rows,
  keyOf,
  renderCard,
  empty,
  className,
}: {
  rows: T[];
  keyOf: (row: T, index: number) => string | number;
  renderCard: (row: T, index: number) => React.ReactNode;
  empty?: React.ReactNode;
  className?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className={className}>
        {empty ?? <p className="rounded-card bg-surface px-6 py-12 text-center t-sm text-t2 elev">No records</p>}
      </div>
    );
  }
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {rows.map((row, i) => (
        <li key={keyOf(row, i)}>{renderCard(row, i)}</li>
      ))}
    </ul>
  );
}

/**
 * The default card chrome, so screens don't re-type the surface/press treatment.
 * Wrap it in a Link (or pass `as`) at the call site when the row navigates.
 */
export function MobileCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("block rounded-card bg-surface p-4 elev active:scale-[0.99]", className)}>{children}</div>
  );
}
