"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  Boxes,
  Factory,
  Truck,
  BarChart3,
  Package,
  PackageCheck,
  Scissors,
  AlertTriangle,
  Users,
  ShoppingCart,
  SlidersHorizontal,
  LogOut,
} from "lucide-react";
import { logout } from "@/lib/auth-actions";
import type { Role } from "@/lib/session";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: Role[];
};

const ALL: Role[] = ["ADMIN", "STAFF", "VENDOR", "TRIMS"];

const nav: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ALL },
  { href: "/job-cards", label: "Job Cards", icon: ClipboardList, roles: ["ADMIN", "STAFF", "VENDOR"] },
  { href: "/production-orders", label: "Production", icon: PackageCheck, roles: ["ADMIN"] },
  { href: "/catalog", label: "Product Master", icon: Package, roles: ["ADMIN", "STAFF"] },
  { href: "/inventory", label: "Inventory", icon: Boxes, roles: ["ADMIN", "STAFF"] },
  { href: "/fabric-orders", label: "Fabric Orders", icon: ShoppingCart, roles: ["ADMIN", "STAFF"] },
  { href: "/trims", label: "Trims", icon: Scissors, roles: ["ADMIN", "STAFF", "TRIMS"] },
  { href: "/pending-trims", label: "Pending Trims", icon: AlertTriangle, roles: ["ADMIN", "STAFF", "TRIMS"] },
  { href: "/suppliers", label: "Suppliers", icon: Users, roles: ["ADMIN", "STAFF"] },
  { href: "/vendors", label: "Vendors", icon: Factory, roles: ["ADMIN", "STAFF"] },
  { href: "/dispatch", label: "Receipts", icon: Truck, roles: ["ADMIN", "STAFF"] },
  { href: "/masters", label: "Masters", icon: SlidersHorizontal, roles: ["ADMIN", "STAFF"] },
  { href: "/reports", label: "Reports", icon: BarChart3, roles: ["ADMIN"] },
];

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  STAFF: "Staff",
  VENDOR: "Vendor",
  TRIMS: "Trims",
};

export function Sidebar({
  role,
  displayName,
}: {
  role: Role;
  displayName: string;
}) {
  const path = usePathname();
  const items = nav.filter((n) => n.roles.includes(role));
  const initial = (displayName.trim()[0] ?? "?").toUpperCase();

  return (
    <aside className="sticky top-0 flex h-screen flex-col border-r border-border bg-surface px-3 py-4">
      <Link href="/" className="mb-6 flex items-center gap-2 px-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-sm font-black text-white">
          S
        </span>
        <span className="text-[15px] font-extrabold tracking-tight">Sportsun</span>
      </Link>

      <nav className="flex flex-col gap-0.5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition ${
                active
                  ? "bg-primary-soft text-primary-ink"
                  : "text-slate-500 hover:bg-slate-50 hover:text-ink"
              }`}
            >
              <Icon size={16} strokeWidth={active ? 2.4 : 2} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-[12px] font-bold text-white">
            {initial}
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[12px] font-semibold text-slate-700">
              {displayName}
            </div>
            <div className="text-[11px] text-muted">{ROLE_LABEL[role]}</div>
          </div>
        </div>

        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-slate-500 transition hover:bg-slate-50 hover:text-danger"
          >
            <LogOut size={16} strokeWidth={2} />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
