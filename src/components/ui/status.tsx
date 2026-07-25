import { cn } from "@/lib/cn";

/* ---------------------------------------------------------------- Badge --
   Enumerated state only — never decoration. Same API as the original so all
   existing call sites keep compiling. */

const badgeTone: Record<string, string> = {
  default: "bg-surface-2 text-t2",
  primary: "bg-accent-soft text-accent-ink",
  accent: "bg-accent-soft text-accent-ink",
  danger: "bg-danger-soft text-danger",
  warn: "bg-warn-soft text-warn",
  ok: "bg-ok-soft text-ok",
};

export function Badge({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof badgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 t-xs font-semibold",
        badgeTone[tone] ?? badgeTone.default,
        className
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ Tag --
   Quieter than a Badge: a neutral chip for metadata, not state. */

export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 t-xs font-medium text-t2",
        className
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ StatusDot --
   A dot carries state at a glance where a full badge would be noise. */

const dotTone: Record<string, string> = {
  default: "bg-t3",
  primary: "bg-accent",
  accent: "bg-accent",
  danger: "bg-danger",
  warn: "bg-warn",
  ok: "bg-ok",
};

export function StatusDot({
  tone = "default",
  label,
  className,
}: {
  tone?: keyof typeof dotTone;
  label?: string;
  className?: string;
}) {
  const dot = <span className={cn("size-1.5 shrink-0 rounded-full", dotTone[tone] ?? dotTone.default)} />;
  if (!label) return <span className={className}>{dot}</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 t-xs text-t2", className)}>
      {dot}
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ Bar --
   Progress against a target. Same API as the original. */

const barTone: Record<string, string> = {
  primary: "bg-accent",
  warn: "bg-warn",
  ok: "bg-ok",
  danger: "bg-danger",
};

export function Bar({
  value,
  tone = "primary",
  className,
}: {
  value: number;
  tone?: keyof typeof barTone;
  className?: string;
}) {
  const w = Math.min(100, Math.max(0, (Number.isFinite(value) ? value : 0) * 100));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-2", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", barTone[tone] ?? barTone.primary)}
        style={{ width: `${w}%` }}
      />
    </div>
  );
}
