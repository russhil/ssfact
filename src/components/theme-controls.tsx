"use client";

import { useEffect, useState } from "react";
import { Moon, Rows3, Rows4, Sun } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Theme and density both live on <html> and are stamped by the blocking script
 * in the root layout before paint. These controls only read the live DOM on
 * mount — never during render — so there is no hydration mismatch.
 */

const btn =
  "inline-flex size-8 items-center justify-center rounded-lg text-t2 transition-colors duration-150 " +
  "hover:bg-surface-2 hover:text-t1 active:scale-[0.94] active:transition-transform active:duration-75";

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("sportsun-theme", next ? "dark" : "light");
    } catch {}
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(btn)}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
    >
      {/* both icons render until we know, so the button never flips after hydration */}
      {dark === null ? (
        <Sun size={15} strokeWidth={2.1} className="opacity-0" />
      ) : dark ? (
        <Sun size={15} strokeWidth={2.1} />
      ) : (
        <Moon size={15} strokeWidth={2.1} />
      )}
    </button>
  );
}

export function DensityToggle() {
  const [compact, setCompact] = useState<boolean | null>(null);

  useEffect(() => setCompact(document.documentElement.dataset.density === "compact"), []);

  function toggle() {
    const next = document.documentElement.dataset.density !== "compact";
    document.documentElement.dataset.density = next ? "compact" : "comfortable";
    try {
      localStorage.setItem("sportsun-density", next ? "compact" : "comfortable");
    } catch {}
    setCompact(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(btn)}
      aria-label={compact ? "Comfortable rows" : "Compact rows"}
      title={compact ? "Comfortable rows" : "Compact rows"}
    >
      {compact === null ? (
        <Rows3 size={15} strokeWidth={2.1} className="opacity-0" />
      ) : compact ? (
        <Rows3 size={15} strokeWidth={2.1} />
      ) : (
        <Rows4 size={15} strokeWidth={2.1} />
      )}
    </button>
  );
}

/** Opens the ⌘K palette by synthesising the shortcut the palette listens for. */
export function CommandTrigger({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))
      }
      className={cn(
        "flex w-full items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 t-sm text-t3",
        "transition-shadow duration-150 hover:shadow-[0_0_0_1px_var(--border)]",
        className
      )}
    >
      <span className="truncate">Search…</span>
      <kbd className="ml-auto shrink-0 rounded-md bg-surface px-1.5 py-0.5 t-xs font-semibold">⌘K</kbd>
    </button>
  );
}
