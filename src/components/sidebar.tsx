"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  Boxes,
  Factory,
  Shirt,
  Truck,
  BarChart3,
} from "lucide-react";

const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/job-cards", label: "Job Cards", icon: ClipboardList },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/vendors", label: "Vendors", icon: Factory },
  { href: "/styles", label: "Styles", icon: Shirt },
  { href: "/dispatch", label: "Dispatch", icon: Truck },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="sticky top-0 flex h-screen flex-col border-r border-border bg-surface px-3 py-4">
      <Link href="/" className="mb-6 flex items-center gap-2 px-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-sm font-black text-white">
          S
        </span>
        <span className="text-[15px] font-extrabold tracking-tight">Sportsun</span>
      </Link>

      <nav className="flex flex-col gap-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
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

      <div className="mt-auto rounded-xl bg-slate-50 px-3 py-3 text-[11px] leading-relaxed text-muted">
        <div className="font-semibold text-slate-600">Demo workspace</div>
        Seeded from the live production workbook.
      </div>
    </aside>
  );
}
