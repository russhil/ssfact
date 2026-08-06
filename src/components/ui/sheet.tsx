"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";

/**
 * A modal panel that enters and exits along the same path so the spatial
 * relationship holds, and never traps the user — Escape and the scrim both
 * close it. Stays mounted so the exit animation has something to animate.
 *
 * `placement="right"` (default) is the desktop detail panel. `placement="bottom"`
 * is the mobile workhorse — a bottom sheet for forms, filters, pickers, numeric
 * entry and confirms — reusing the same scrim/Escape/focus/easing.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  footer,
  width = 400,
  placement = "right",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  placement?: "right" | "bottom";
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const bottom = placement === "bottom";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // move focus in so the panel is reachable by keyboard immediately
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          "fixed inset-0 z-50 bg-black/25 transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <aside
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        // Position/inset are inline for the bottom variant: the `*-0` inset
        // utilities render as `calc(var(--spacing)*0)` and don't apply reliably
        // here, and a modal's placement is load-bearing. env() is bare, never in
        // a calc (which would drop the declaration). The right variant keeps its
        // working `inset-y-3 right-3` classes.
        style={
          bottom
            ? { left: 0, right: 0, bottom: 0, paddingBottom: "env(safe-area-inset-bottom)" }
            : { width, maxWidth: "calc(100vw - 24px)" }
        }
        className={cn(
          // `text-left` is load-bearing: a Sheet is a DOM child of whatever opened it, so
          // one rendered from a `text-right` table cell would inherit that alignment and
          // right-align every label and hint inside the panel.
          "fixed z-50 flex flex-col overflow-hidden bg-surface text-left outline-none elev-hi",
          "transition-[transform,opacity] duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
          bottom
            ? // bottom sheet: full width, rests on the bottom edge, rounded top
              cn(
                "max-h-[90dvh] rounded-t-card",
                open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-[calc(100%+20px)] opacity-0"
              )
            : // right panel: floats inset from the right edge
              cn(
                "inset-y-3 right-3 rounded-card",
                open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-[calc(100%+20px)] opacity-0"
              )
        )}
      >
        {bottom && (
          // grab handle — the visual affordance that this pulls up from the bottom
          <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border" aria-hidden />
        )}
        <header className="flex items-center gap-3 border-b border-hairline px-4 py-3.5">
          <div className="min-w-0">
            {title && <div className="t-head truncate">{title}</div>}
            {subtitle && <div className="t-xs truncate text-t3">{subtitle}</div>}
          </div>
          <IconButton label="Close" onClick={onClose} className="ml-auto">
            <X size={15} strokeWidth={2.2} />
          </IconButton>
        </header>

        <div className="flex flex-col gap-4 overflow-auto p-4">{children}</div>

        {footer && <footer className="mt-auto flex gap-2 border-t border-hairline px-4 py-3">{footer}</footer>}
      </aside>
    </>
  );
}

/** A `Sheet` that rises from the bottom edge — the default mobile overlay. */
export function BottomSheet(props: Omit<React.ComponentProps<typeof Sheet>, "placement">) {
  return <Sheet {...props} placement="bottom" />;
}
