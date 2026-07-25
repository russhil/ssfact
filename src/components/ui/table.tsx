import { cn } from "@/lib/cn";

/* Row height and cell padding come from --row-h / --row-px, which the density
   toggle flips on <html>. Tables inherit it; they don't read any state. */

const align = { left: "text-left", right: "text-right", center: "text-center" } as const;

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  align?: keyof typeof align;
  /** applied to both header and body cells */
  className?: string;
  width?: string;
};

export function DataTable<T>({
  columns,
  rows,
  keyOf,
  empty,
  onRowClick,
  isSelected,
  footer,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T, index: number) => string | number;
  empty?: React.ReactNode;
  onRowClick?: (row: T, index: number) => void;
  isSelected?: (row: T, index: number) => boolean;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-card bg-surface elev", className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse t-sm">
          <thead>
            <tr className="border-b border-border">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  style={c.width ? { width: c.width } : undefined}
                  className={cn(
                    "t-label whitespace-nowrap px-[var(--row-px)] py-3 text-t3",
                    align[c.align ?? "left"],
                    c.className
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={keyOf(row, i)}
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                data-selected={isSelected?.(row, i) || undefined}
                className={cn(
                  "border-b border-hairline last:border-0 transition-colors duration-100",
                  "data-selected:bg-accent-soft",
                  onRowClick && "cursor-pointer hover:bg-surface-2"
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "h-[var(--row-h)] px-[var(--row-px)] align-middle",
                      align[c.align ?? "left"],
                      c.align === "right" && "tnum",
                      c.className
                    )}
                  >
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  {empty ?? <p className="px-6 py-12 text-center t-sm text-t2">Nothing here yet.</p>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {footer && <div className="border-t border-hairline px-[var(--row-px)] py-2.5 t-xs text-t3">{footer}</div>}
    </div>
  );
}

/* ---- escape hatches ----
   For the bespoke tables (job-card size×colour matrices) that a column config
   can't express — same surface and cell rhythm, hand-built rows. */

export function TableWrap({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("overflow-hidden rounded-card bg-surface elev", className)}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function Th({
  className,
  children,
  ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn("t-label whitespace-nowrap px-[var(--row-px)] py-3 text-left text-t3", className)}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  className,
  children,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("h-[var(--row-h)] px-[var(--row-px)] align-middle", className)} {...rest}>
      {children}
    </td>
  );
}
