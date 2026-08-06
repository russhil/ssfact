"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import type { Role } from "@/lib/session";
import { bottomTabsForRole, type NavCounts, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/cn";

/** Bar height in px, excl. safe-area. Hardcoded (not a CSS var) because Lightning
 *  CSS prunes `:root` custom properties referenced only from TSX. Shared with the
 *  AppFrame spacer that reserves the same room under scrolling content. */
export const TABBAR_H = 56;

const isActive = (href: string, path: string) => (href === "/" ? path === "/" : path.startsWith(href));

/**
 * The mobile bottom bar: four role-chosen destinations + a permanent "More".
 * Hidden at `md` and up. Tabs come from BOTTOM_TABS via `bottomTabsForRole`, so a
 * role can never see a tab it lacks. "More" opens the full drawer.
 */
export function BottomNav({
  role,
  counts = {},
  onMore,
  moreOpen = false,
  className,
}: {
  role: Role;
  counts?: NavCounts;
  onMore: () => void;
  moreOpen?: boolean;
  className?: string;
}) {
  const path = usePathname();
  const tabs = bottomTabsForRole(role);
  // "More" reads as active while the drawer is open, or when the current route
  // isn't one of the four tabs (so the user can see they're deeper in).
  const moreActive = moreOpen || !tabs.some((t) => isActive(t.href, path));

  return (
    <nav
      className={cn("z-40 flex border-t border-hairline bg-surface/95 backdrop-blur", className)}
      // Geometry is inline, not Tailwind/CSS-var: this bar's placement is
      // load-bearing and inline styles can't be pruned or lose a cascade race.
      // `env()` is bare, never inside a calc it might fail to resolve.
      style={{ position: "fixed", left: 0, right: 0, bottom: 0, minHeight: TABBAR_H, paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      {tabs.map((t) => (
        <Tab key={t.href} item={t} active={isActive(t.href, path)} count={t.count ? counts[t.count] : undefined} />
      ))}
      <button
        type="button"
        onClick={onMore}
        aria-current={moreActive ? "page" : undefined}
        aria-expanded={moreOpen}
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-0.5 pt-1 t-micro font-semibold transition-colors",
          moreActive ? "text-accent" : "text-t3"
        )}
      >
        <MoreHorizontal size={20} strokeWidth={moreActive ? 2.4 : 2} />
        <span>More</span>
      </button>
    </nav>
  );
}

function Tab({ item, active, count }: { item: NavItem; active: boolean; count?: number }) {
  const { href, label, icon: Icon } = item;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-1 t-micro font-semibold transition-colors",
        active ? "text-accent" : "text-t3"
      )}
    >
      <span className="relative">
        <Icon size={20} strokeWidth={active ? 2.4 : 2} />
        {count != null && count > 0 && (
          <span className="absolute -right-2 -top-1.5 grid min-w-3.5 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold leading-4 text-accent-on">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </span>
      <span className="max-w-full truncate px-0.5">{label}</span>
    </Link>
  );
}
