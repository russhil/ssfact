import { cn } from "@/lib/cn";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-card border border-border bg-surface", className)}>
      {children}
    </div>
  );
}

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
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[19px] font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[12px] text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

const toneMap: Record<string, string> = {
  default: "bg-slate-100 text-slate-600",
  primary: "bg-primary-soft text-primary-ink",
  danger: "bg-danger-soft text-danger",
  warn: "bg-amber-100 text-amber-700",
  ok: "bg-ok-soft text-emerald-700",
};

export function Badge({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof toneMap;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        toneMap[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function Bar({ value, tone = "primary" }: { value: number; tone?: "primary" | "warn" | "ok" }) {
  const color = tone === "warn" ? "bg-amber-400" : tone === "ok" ? "bg-emerald-500" : "bg-primary";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  );
}
