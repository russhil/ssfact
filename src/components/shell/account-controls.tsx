"use client";

import { LogOut } from "lucide-react";
import { logout } from "@/lib/auth-actions";
import type { Role } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/nav";
import { CommandTrigger, DensityToggle, ThemeToggle } from "@/components/theme-controls";
import { cn } from "@/lib/cn";

/**
 * The account chip + theme/density/bell/sign-out footer. Lifted out of the
 * sidebar (Change 40) so the desktop sidebar AND the mobile "More" drawer render
 * exactly the same controls.
 */
export function AccountControls({
  role,
  displayName,
  bell,
}: {
  role: Role;
  displayName: string;
  bell?: React.ReactNode;
}) {
  const initial = (displayName.trim()[0] ?? "?").toUpperCase();

  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-3">
      <div className="flex items-center gap-2.5 rounded-xl bg-surface-2 px-2.5 py-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent t-xs font-bold text-accent-on">
          {initial}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate t-sm font-semibold">{displayName}</span>
          <span className="block t-xs text-t3">{ROLE_LABEL[role]}</span>
        </span>
      </div>

      <div className="flex items-center gap-1">
        <ThemeToggle />
        <DensityToggle />
        {bell}
        <form action={logout} className="ml-auto">
          <button
            type="submit"
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 t-sm font-medium text-t2",
              "transition-colors duration-150 hover:bg-danger-soft hover:text-danger"
            )}
          >
            <LogOut size={15} strokeWidth={2} />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

export { CommandTrigger };
