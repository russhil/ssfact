import { cn } from "@/lib/cn";

/* ----------------------------------------------------------------- Card --
   Depth is two soft blurs plus a hairline ring (`.elev`) — never a hard 1px
   border. Padding stays the caller's job, matching the original API. */

export function Card({
  className,
  children,
  hover,
}: {
  className?: string;
  children: React.ReactNode;
  hover?: boolean;
}) {
  return (
    <div className={cn("rounded-card bg-surface elev", hover && "elev-lift", className)}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- Panel --
   A Card with the header treatment that was being hand-rolled as
   `<h3 className="t-body font-bold">` on ~20 screens. */

export function Panel({
  title,
  note,
  actions,
  pad = true,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  note?: React.ReactNode;
  actions?: React.ReactNode;
  /** false when the body is an edge-to-edge table */
  pad?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("overflow-hidden rounded-card bg-surface elev", className)}>
      {(title || actions) && (
        <header className="flex items-baseline justify-between gap-3 px-5 pt-5">
          <h3 className="t-head font-semibold flex items-baseline gap-2">
            {title}
            {note && <span className="t-xs font-medium text-t3">{note}</span>}
          </h3>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(pad ? "p-5" : "", title && pad ? "pt-4" : "", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ----------------------------------------------------------- PageHeader --
   Same API as the original. */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-5">
      <div className="min-w-0">
        <h1 className="t-display font-bold">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-[70ch] t-sm text-t2">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({
  children,
  note,
  className,
}: {
  children: React.ReactNode;
  note?: React.ReactNode;
  className?: string;
}) {
  return (
    <h3 className={cn("t-head font-semibold flex items-baseline gap-2", className)}>
      {children}
      {note && <span className="t-xs font-medium text-t3">{note}</span>}
    </h3>
  );
}

/* ------------------------------------------------------------- StatCard --
   The KPI block repeated on the dashboard, job-card detail and reports. */

export function StatCard({
  label,
  value,
  foot,
  tone,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  foot?: React.ReactNode;
  tone?: "danger" | "warn" | "ok";
  className?: string;
}) {
  const toneText =
    tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "";
  return (
    <div className={cn("rounded-xl bg-surface p-4 elev elev-lift", className)}>
      <div className="t-label text-t3">{label}</div>
      <div className={cn("mt-2 t-stat font-extrabold", toneText || "text-t1")}>{value}</div>
      {foot != null && <div className={cn("mt-2 t-xs", toneText || "text-t3")}>{foot}</div>}
    </div>
  );
}

/* -------------------------------------------------------------- DefList --
   The `<dl className="grid grid-cols-2 …">` pattern on the detail screens. */

export function DefList({
  items,
  cols = 2,
  className,
}: {
  items: { label: React.ReactNode; value: React.ReactNode }[];
  cols?: 1 | 2 | 3;
  className?: string;
}) {
  const grid = cols === 1 ? "grid-cols-1" : cols === 3 ? "grid-cols-3" : "grid-cols-2";
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", grid, className)}>
      {items.map((it, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <dt className="t-xs text-t3">{it.label}</dt>
          <dd className="t-body font-semibold tnum">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ----------------------------------------------------------- EmptyState --
   Never a bare "No rows." — say what would be here and how to create it. */

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-14 text-center", className)}>
      {icon && <div className="mb-1 text-t3">{icon}</div>}
      <p className="t-head font-semibold text-t1">{title}</p>
      {hint && <p className="max-w-[46ch] t-sm text-t2">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-surface-2", className)} />;
}

/** Filter/action strip that sits above a table. */
export function Toolbar({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-center justify-between gap-3", className)}>{children}</div>
  );
}
