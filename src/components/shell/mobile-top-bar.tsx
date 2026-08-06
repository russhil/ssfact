"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { BrandLogo } from "@/components/brand";
import { cn } from "@/lib/cn";

/**
 * The mobile header: brand home-link + ⌘K search + the notification bell. Sticky
 * at the top of `<main>`, hidden at `md` and up (the sidebar carries these on
 * desktop). Opens the existing CommandPalette by synthesising the shortcut it
 * already listens for.
 */
export function MobileTopBar({ bell, className }: { bell?: React.ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex items-center gap-2 border-b border-hairline bg-surface/95 px-3 py-2 backdrop-blur",
        className
      )}
    >
      <Link href="/" aria-label="Sport Sun — dashboard" className="flex items-center text-accent">
        <BrandLogo width={92} />
      </Link>
      <button
        type="button"
        onClick={() =>
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))
        }
        aria-label="Search"
        className="ml-auto inline-flex size-9 items-center justify-center rounded-lg text-t2 transition-colors hover:bg-surface-2 hover:text-t1 active:scale-[0.94]"
      >
        <Search size={18} strokeWidth={2.1} />
      </button>
      {bell}
    </header>
  );
}
