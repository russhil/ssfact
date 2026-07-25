import { Search } from "lucide-react";
import { cn } from "@/lib/cn";

/* Replaces the 11 hand-rolled `const inp = "rounded-lg border border-border …"`
   constants that had drifted apart across the form components. */

type Size = "sm" | "md";

const sizes: Record<Size, string> = {
  sm: "rounded-md px-2 py-1.5 t-sm",
  md: "rounded-lg px-3 py-2 t-body",
};

/* Deliberately no `w-full` — plenty of these sit inline inside table cells.
   The components below opt into it; `inputClass()` callers decide for
   themselves. */
const field =
  "bg-surface text-t1 border border-border outline-none transition-[border-color,box-shadow] duration-150 " +
  "placeholder:text-t3 focus:border-accent focus:ring-2 focus:ring-accent/15 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export function inputClass(size: Size = "md", className?: string) {
  return cn(field, sizes[size], className);
}

export function Input({
  size = "md",
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: Size }) {
  return <input className={inputClass(size, cn("w-full", className))} {...rest} />;
}

export function Textarea({
  size = "md",
  className,
  ...rest
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> & { size?: Size }) {
  return <textarea className={inputClass(size, cn("w-full resize-y", className))} {...rest} />;
}

export function Select({
  size = "md",
  className,
  children,
  ...rest
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: Size }) {
  return (
    <select className={inputClass(size, cn("w-full pr-7", className))} {...rest}>
      {children}
    </select>
  );
}

/* -------------------------------------------------------------- Field --
   Label sits next to what it affects; hint and error are inline, not on
   submit. */

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  children,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)} htmlFor={htmlFor}>
      {label && (
        <span className="t-xs font-semibold text-t2">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="t-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="t-xs text-t3">{hint}</span>
      ) : null}
    </label>
  );
}

/* -------------------------------------------------------- SearchInput --
   Controlled — the parent owns the query, so this stays a plain component. */

export function SearchInput({
  size = "md",
  className,
  wrapClassName,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: Size;
  wrapClassName?: string;
}) {
  return (
    <div className={cn("relative", wrapClassName)}>
      <Search
        size={14}
        strokeWidth={2.2}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-t3"
      />
      <input type="search" className={inputClass(size, cn("pl-8", className))} {...rest} />
    </div>
  );
}
