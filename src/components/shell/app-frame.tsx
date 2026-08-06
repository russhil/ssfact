"use client";

import { useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { MobileTopBar } from "@/components/shell/mobile-top-bar";
import { BottomNav, TABBAR_H } from "@/components/shell/bottom-nav";
import { MoreDrawer } from "@/components/shell/more-drawer";
import { OfflineBanner } from "@/components/offline-banner";
import { CommandPalette } from "@/components/command-palette";
import { ConfirmProvider } from "@/components/ui";
import type { Role } from "@/lib/session";
import type { NavCounts } from "@/lib/nav";

/**
 * Change 40 — the adaptive shell. One route tree, two chromes chosen by CSS
 * breakpoint (both are in the DOM, so nothing flips on hydration): the desktop
 * `Sidebar` at `md`+, and a `MobileTopBar` + `BottomNav` + `MoreDrawer` below it.
 * All server data (user, counts, inbox, quick-create actions) is fetched by the
 * layout and passed in, so this stays a presentational client shell.
 */
export function AppFrame({
  role,
  displayName,
  counts,
  bell,
  actions,
  children,
}: {
  role: Role;
  displayName: string;
  counts: NavCounts;
  bell?: React.ReactNode;
  actions: { label: string; sub: string; href: string }[];
  children: React.ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <ConfirmProvider>
    <div className="grid min-h-screen grid-cols-1 bg-app md:grid-cols-[216px_1fr]">
      <Sidebar role={role} displayName={displayName} counts={counts} bell={bell} className="hidden md:flex" />

      <main className="min-w-0">
        <MobileTopBar bell={bell} className="md:hidden" />
        <OfflineBanner />
        {children}
        {/* reserves scroll room under the fixed bottom bar; phones only */}
        <div className="md:hidden" aria-hidden style={{ height: `calc(${TABBAR_H}px + env(safe-area-inset-bottom))` }} />
      </main>

      <BottomNav role={role} counts={counts} onMore={() => setMoreOpen(true)} moreOpen={moreOpen} className="md:hidden" />
      <MoreDrawer open={moreOpen} onClose={() => setMoreOpen(false)} role={role} displayName={displayName} counts={counts} />

      <CommandPalette actions={actions} />
    </div>
    </ConfirmProvider>
  );
}
