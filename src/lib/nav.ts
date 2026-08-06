/**
 * The one nav model. Extracted from sidebar.tsx (Change 40) so the desktop
 * sidebar, the mobile bottom bar, the "More" drawer and the ⌘K palette all read
 * the SAME grouped, role-gated list — it still mirrors ROUTE_ROLES in proxy.ts.
 *
 * Plain data + pure helpers, no "use client": safe to import from server or
 * client components.
 */

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
  Activity,
} from "lucide-react";
import type { Role } from "@/lib/session";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: Role[];
  /** key into the NavCounts prop */
  count?: "jobs" | "pendingTrims";
};

export type NavGroup = { group: string; items: NavItem[] };

export type NavCounts = { jobs?: number; pendingTrims?: number };

const ALL: Role[] = ["ADMIN", "STAFF", "VENDOR", "TRIMS"];
const STAFF: Role[] = ["ADMIN", "STAFF"];

/* Grouped so 17 destinations read as five short lists instead of one long one.
   Role gating mirrors ROUTE_ROLES in proxy.ts. */
export const GROUPS: NavGroup[] = [
  {
    group: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ALL },
      { href: "/board", label: "Production Board", icon: LayoutGrid, roles: STAFF },
      { href: "/planning", label: "Planning", icon: CalendarClock, roles: STAFF },
    ],
  },
  {
    group: "Production",
    items: [
      { href: "/my-work", label: "My work", icon: ListChecks, roles: ALL },
      { href: "/job-cards", label: "Job Cards", icon: ClipboardList, roles: ["ADMIN", "STAFF", "VENDOR"], count: "jobs" },
      { href: "/production-orders", label: "Production", icon: PackageCheck, roles: ["ADMIN"] },
      { href: "/finishing", label: "Finishing", icon: Sparkles, roles: STAFF },
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
      { href: "/status", label: "Status", icon: Activity, roles: ["ADMIN"] },
    ],
  },
];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  STAFF: "Staff",
  VENDOR: "Vendor",
  TRIMS: "Trims",
};

/** The grouped nav, filtered to what this role may see (empty groups dropped). */
export function filterGroupsForRole(role: Role): NavGroup[] {
  return GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => n.roles.includes(role)) })).filter(
    (g) => g.items.length > 0
  );
}

/** Flat, role-filtered item list — handy for resolving bottom-tab hrefs. */
export function navItemsForRole(role: Role): NavItem[] {
  return filterGroupsForRole(role).flatMap((g) => g.items);
}

/**
 * The four bottom-bar destinations per role (a fifth "More" tab is always
 * appended by BottomNav). Chosen so nobody gets a dead tab: ADMIN/STAFF see
 * everything; VENDOR ≈ my-work + job-cards; TRIMS ≈ trims + pending-trims.
 */
export const BOTTOM_TABS: Record<Role, string[]> = {
  ADMIN: ["/my-work", "/job-cards", "/board"],
  STAFF: ["/my-work", "/job-cards", "/board"],
  VENDOR: ["/my-work", "/job-cards", "/"],
  TRIMS: ["/my-work", "/trims", "/pending-trims"],
};

/** Resolve a role's bottom-tab hrefs to real NavItems (drops any it can't see). */
export function bottomTabsForRole(role: Role): NavItem[] {
  const items = navItemsForRole(role);
  return BOTTOM_TABS[role]
    .map((href) => items.find((n) => n.href === href))
    .filter((n): n is NavItem => Boolean(n));
}
