"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/session";
import { filterGroupsForRole, type NavCounts } from "@/lib/nav";
import { BottomSheet } from "@/components/ui/sheet";
import { AccountControls } from "@/components/shell/account-controls";
import { cn } from "@/lib/cn";

const isActive = (href: string, path: string) => (href === "/" ? path === "/" : path.startsWith(href));

/**
 * The "More" tab's target: every destination this role may reach, grouped
 * exactly like the desktop sidebar, in a bottom sheet. Tapping a link closes the
 * sheet. The account/theme/density/sign-out footer is the shared AccountControls.
 */
export function MoreDrawer({
  open,
  onClose,
  role,
  displayName,
  counts = {},
  bell,
}: {
  open: boolean;
  onClose: () => void;
  role: Role;
  displayName: string;
  counts?: NavCounts;
  bell?: React.ReactNode;
}) {
  const path = usePathname();
  const groups = filterGroupsForRole(role);

  return (
    <BottomSheet open={open} onClose={onClose} title="All destinations" footer={<AccountControls role={role} displayName={displayName} bell={bell} />}>
      {groups.map((g) => (
        <div key={g.group}>
          <div className="px-1 pb-1 t-label text-t3">{g.group}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {g.items.map(({ href, label, icon: Icon, count }) => {
              const active = isActive(href, path);
              const n = count ? counts[count] : undefined;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onClose}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl px-3 py-3 t-sm font-medium",
                    "transition-colors active:scale-[0.98]",
                    active ? "bg-accent-soft font-semibold text-accent" : "bg-surface-2 text-t2"
                  )}
                >
                  <Icon size={17} strokeWidth={active ? 2.4 : 2} className="shrink-0" />
                  <span className="truncate">{label}</span>
                  {n != null && n > 0 && <span className="ml-auto tnum t-xs font-bold text-t3">{n}</span>}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </BottomSheet>
  );
}
