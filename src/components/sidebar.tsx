"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Building2,
  ClipboardList,
  History,
  Factory,
  FileText,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Package,
  PackageCheck,
  Scissors,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  Users,
  Sparkles,
  CalendarClock,
  FlaskConical,
  Search,
  ListChecks,
} from "lucide-react";
import { logout } from "@/lib/auth-actions";
import type { Role } from "@/lib/session";
import { BrandLockup } from "@/components/brand";
import { CommandTrigger, DensityToggle, ThemeToggle } from "@/components/theme-controls";
import { cn } from "@/lib/cn";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: Role[];
  /** key into the `counts` prop */
  count?: "jobs" | "pendingTrims";
};

const ALL: Role[] = ["ADMIN", "STAFF", "VENDOR", "TRIMS"];
const STAFF: Role[] = ["ADMIN", "STAFF"];

/* Grouped so 17 destinations read as five short lists instead of one long one.
   Role gating is unchanged — it still mirrors ROUTE_ROLES in proxy.ts. */
const GROUPS: { group: string; items: NavItem[] }[] = [
  {
    group: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ALL },
      { href: "/board", label: "Production Board", icon: LayoutGrid, roles: STAFF },
      // Change 36 Part 4 — open work against each vendor's daily capacity.
      { href: "/planning", label: "Planning", icon: CalendarClock, roles: STAFF },
    ],
  },
  {
    group: "Production",
    items: [
      // Change 36 Part 9 — the floor lens. Everyone has one; it just differs by role.
      { href: "/my-work", label: "My work", icon: ListChecks, roles: ALL },
      { href: "/job-cards", label: "Job Cards", icon: ClipboardList, roles: ["ADMIN", "STAFF", "VENDOR"], count: "jobs" },
      { href: "/production-orders", label: "Production", icon: PackageCheck, roles: ["ADMIN"] },
      // Change 20: finishing given out as job-work, between the machine and dispatch —
      // which is where it sits on the floor.
      { href: "/finishing", label: "Finishing", icon: Sparkles, roles: STAFF },
      // Change 36 Part 7 — development before bulk.
      { href: "/samples", label: "Samples", icon: FlaskConical, roles: STAFF },
      { href: "/dispatch", label: "Dispatch", icon: Truck, roles: STAFF },
    ],
  },
  {
    group: "Materials",
    items: [
      { href: "/inventory", label: "Inventory", icon: Boxes, roles: STAFF },
      { href: "/fabric-orders", label: "Fabric Orders", icon: ShoppingCart, roles: STAFF },
      { href: "/trim-orders", label: "Trim Orders", icon: ShoppingCart, roles: STAFF },
      { href: "/challans", label: "Challans", icon: FileText, roles: STAFF },
      // Change 36 Part 8 — roll to garment, and back.
      { href: "/trace", label: "Trace", icon: Search, roles: STAFF },
      { href: "/trims", label: "Trims", icon: Scissors, roles: ["ADMIN", "STAFF", "TRIMS"] },
      {
        href: "/pending-trims",
        label: "Pending Trims",
        icon: AlertTriangle,
        roles: ["ADMIN", "STAFF", "TRIMS"],
        count: "pendingTrims",
      },
    ],
  },
  {
    group: "Network",
    items: [
      { href: "/vendors", label: "Vendors", icon: Factory, roles: STAFF },
      { href: "/suppliers", label: "Suppliers", icon: Users, roles: STAFF },
      { href: "/buyers", label: "Buyers", icon: Building2, roles: STAFF },
      { href: "/catalog", label: "Product Master", icon: Package, roles: STAFF },
    ],
  },
  {
    group: "Admin",
    items: [
      { href: "/masters", label: "Masters", icon: SlidersHorizontal, roles: STAFF },
      { href: "/users", label: "Users", icon: ShieldCheck, roles: ["ADMIN"] },
      { href: "/audit", label: "Audit", icon: History, roles: ["ADMIN"] },
      { href: "/reports", label: "Reports", icon: BarChart3, roles: ["ADMIN"] },
      { href: "/settings", label: "Settings", icon: Settings, roles: ["ADMIN"] },
    ],
  },
];

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  STAFF: "Staff",
  VENDOR: "Vendor",
  TRIMS: "Trims",
};

export type NavCounts = { jobs?: number; pendingTrims?: number };

export function Sidebar({
  role,
  displayName,
  counts = {},
  bell,
}: {
  role: Role;
  displayName: string;
  counts?: NavCounts;
  /** Change 36 Part 2 — the inbox, rendered by the layout so this stays a pure shell. */
  bell?: React.ReactNode;
}) {
  const path = usePathname();
  const initial = (displayName.trim()[0] ?? "?").toUpperCase();

  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => n.roles.includes(role)) })).filter(
    (g) => g.items.length > 0
  );

  return (
    <aside className="sticky top-0 flex h-screen flex-col border-r border-hairline bg-surface px-3 py-4">
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

      <div className="mt-3 flex flex-col gap-2 border-t border-hairline pt-3">
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
    </aside>
  );
}
