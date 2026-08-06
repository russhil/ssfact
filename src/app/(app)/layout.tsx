import { redirect } from "next/navigation";
import { AppFrame } from "@/components/shell/app-frame";
import { NotificationBell } from "@/components/notification-bell";
import type { NavCounts } from "@/lib/nav";
import { getCurrentUser } from "@/lib/auth";
import { getJobs } from "@/lib/jobs";
import { getPendingTrims } from "@/lib/insights";
import { db } from "@/lib/db";
import type { Role } from "@/lib/session";

/* Quick-create actions offered by ⌘K, gated the same way the routes are. */
const ACTIONS: { label: string; sub: string; href: string; roles: Role[] }[] = [
  { label: "New job card", sub: "Start a cutting-to-receipt order", href: "/job-cards/new", roles: ["ADMIN", "STAFF"] },
  { label: "New product", sub: "Add a style to the product master", href: "/catalog/new", roles: ["ADMIN", "STAFF"] },
  { label: "New production order", sub: "Plan a production run", href: "/production-orders/new", roles: ["ADMIN"] },
];

async function navCounts(role: Role, vendor?: string | null): Promise<NavCounts> {
  const counts: NavCounts = {};

  // A vendor's card set is small, so scoping it properly is cheap. For staff a
  // plain count avoids loading every job card on every page render.
  if (role === "VENDOR") {
    const rows = await getJobs({ vendorName: vendor ?? "" });
    counts.jobs = rows.filter((r) => r.status === "ACTIVE").length;
  } else {
    counts.jobs = await db.jobCard.count({ where: { status: "ACTIVE" } });
  }

  if (role === "ADMIN" || role === "STAFF" || role === "TRIMS") {
    // Same query the Pending Trims page uses, so the badge can't disagree with it.
    counts.pendingTrims = (await getPendingTrims()).length;
  }

  return counts;
}

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const counts = await navCounts(user.role, user.vendor);

  // Change 36 Part 2 — the inbox. Read here so the sidebar stays a presentational shell.
  const inbox = await db.notification.findMany({
    where: { userId: user.userId },
    orderBy: { at: "desc" },
    take: 30,
    select: { id: true, at: true, body: true, template: true, status: true },
  });
  const actions = ACTIONS.filter((a) => a.roles.includes(user.role)).map(({ label, sub, href }) => ({
    label,
    sub,
    href,
  }));

  return (
    <AppFrame
      role={user.role}
      displayName={user.displayName}
      counts={counts}
      bell={<NotificationBell items={inbox} />}
      actions={actions}
    >
      {children}
    </AppFrame>
  );
}
