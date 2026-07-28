import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { NotificationSettings } from "@/components/notification-settings";

export const dynamic = "force-dynamic";

/** Change 36 Part 2 Part D — per-event preferences and the contact details to send to. */
export default async function NotificationSettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const [user, prefs] = await Promise.all([
    db.user.findUnique({ where: { id: me.userId }, select: { phone: true, email: true } }),
    db.notificationPref.findMany({ where: { userId: me.userId } }),
  ]);

  return (
    <div className="p-6">
      <PageHeader title="Notifications" subtitle="What reaches you, and where" />
      <NotificationSettings
        phone={user?.phone ?? null}
        email={user?.email ?? null}
        prefs={prefs.map((p) => ({ template: p.template, channel: p.channel, enabled: p.enabled }))}
      />
    </div>
  );
}
