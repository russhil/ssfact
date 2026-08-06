"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/session";
import { filterGroupsForRole, type NavCounts } from "@/lib/nav";
import { BrandLockup } from "@/components/brand";
import { AccountControls, CommandTrigger } from "@/components/shell/account-controls";
import { cn } from "@/lib/cn";

export type { NavCounts };

/**
 * The desktop nav rail. Change 40: the nav model now lives in `@/lib/nav` and the
 * account footer in `AccountControls`, both shared with the mobile chrome — this
 * stays a presentational shell. Hidden below `md` by the app frame.
 */
export function Sidebar({
  role,
  displayName,
  counts = {},
  bell,
  className,
}: {
  role: Role;
  displayName: string;
  counts?: NavCounts;
  /** the inbox, rendered by the layout so this stays a pure shell. */
  bell?: React.ReactNode;
  className?: string;
}) {
  const path = usePathname();
  const groups = filterGroupsForRole(role);

  return (
    <aside className={cn("sticky top-0 flex h-screen flex-col border-r border-hairline bg-surface px-3 py-4", className)}>
      <Link href="/" className="mb-4 block px-2 pt-1" aria-label="Sport Sun — Production OS, go to dashboard">
        <BrandLockup width={132} />
      </Link>

      <CommandTrigger />

      <nav className="-mx-1 mt-1 flex-1 overflow-y-auto px-1 scrollbar-hide">
        {groups.map((g) => (
          <div key={g.group}>
            <div className="px-2.5 pb-1 pt-4 t-label text-t3">{g.group}</div>
            {g.items.map(({ href, label, icon: Icon, count }) => {
              const active = href === "/" ? path === "/" : path.startsWith(href);
              const n = count ? counts[count] : undefined;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 t-sm font-medium",
                    "transition-[background-color,color] duration-150",
                    "active:scale-[0.98] active:transition-transform active:duration-75",
                    active
                      ? "bg-accent-soft font-semibold text-accent"
                      : "text-t2 hover:bg-surface-2 hover:text-t1"
                  )}
                >
                  <Icon size={15} strokeWidth={active ? 2.4 : 2} className="shrink-0" />
                  <span className="truncate">{label}</span>
                  {n != null && n > 0 && (
                    <span className={cn("ml-auto tnum t-xs font-bold", active ? "opacity-70" : "text-t3")}>
                      {n}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-3">
        <AccountControls role={role} displayName={displayName} bell={bell} />
      </div>
    </aside>
  );
}
