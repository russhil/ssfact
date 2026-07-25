"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";

/**
 * Right-side detail panel. Enters and exits along the same path so the spatial
 * relationship holds, and never traps the user — Escape and the scrim both
 * close it. Stays mounted so the exit animation has something to animate.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  footer,
  width = 400,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

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
        style={{ width, maxWidth: "calc(100vw - 24px)" }}
        className={cn(
          "fixed inset-y-3 right-3 z-50 flex flex-col overflow-hidden rounded-card bg-surface outline-none elev-hi",
          "transition-[transform,opacity] duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
          open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-[calc(100%+20px)] opacity-0"
        )}
      >
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
