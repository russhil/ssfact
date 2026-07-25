import Link from "next/link";
import { cn } from "@/lib/cn";

/* No "use client" on purpose — a Button with no handler renders fine inside a
   server component, and a client parent can still pass onClick. */

type Variant = "primary" | "soft" | "ghost" | "outline" | "danger";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-on hover:opacity-90",
  soft: "bg-surface-2 text-t1 hover:bg-hairline",
  ghost: "bg-transparent text-t2 hover:bg-surface-2 hover:text-t1",
  outline: "bg-surface text-t1 elev-sm hover:bg-surface-2",
  danger: "bg-danger-soft text-danger hover:bg-danger hover:text-white",
};

const sizes: Record<Size, string> = {
  sm: "gap-1.5 rounded-lg px-3 py-1.5 t-sm",
  md: "gap-2 rounded-lg px-4 py-2.5 t-body",
};

/* Feedback lives on the press and is instant — never wait for the click. */
const base =
  "inline-flex items-center justify-center font-semibold whitespace-nowrap " +
  "transition-[background-color,color,opacity,box-shadow] duration-150 " +
  "active:scale-[0.97] active:transition-transform active:duration-75 " +
  "disabled:pointer-events-none disabled:opacity-40";

export function buttonClass(variant: Variant = "soft", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "soft",
  size = "md",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...rest} />;
}

/** Same look as Button, but navigates. */
export function ButtonLink({
  variant = "soft",
  size = "md",
  className,
  ...rest
}: React.ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

export function IconButton({
  variant = "ghost",
  className,
  label,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(base, variants[variant], "size-8 rounded-lg", className)}
      {...rest}
    />
  );
}
