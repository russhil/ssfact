"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sheet, Badge, Button } from "@/components/ui";
import { Bell } from "lucide-react";
import { runAction } from "@/lib/action-result";
import { markNotificationsRead } from "@/lib/actions";
import { fmtDate } from "@/lib/format";

export type InboxItem = { id: string; at: Date; body: string; template: string; status: string };

/**
 * Change 36 Part 2 Part D — the in-app inbox.
 *
 * This is the whole reason the gateway defaults to log-only: with no WhatsApp or SMTP
 * configured the factory still gets working alerts, because every send is recorded here.
 */
export function NotificationBell({ items }: { items: InboxItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const unread = items.filter((i) => i.status !== "READ").length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Notifications"
        title="Notifications"
        className="relative text-t3 hover:text-ink"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 rounded-full bg-danger px-1 t-micro font-bold text-accent-on">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : "All caught up"}
        width={420}
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <Link href="/settings/notifications" className="t-sm text-primary-ink hover:underline">Settings</Link>
            {unread > 0 && (
              <Button
                size="sm"
                onClick={async () => {
                  if (await runAction(() => markNotificationsRead())) { setOpen(false); router.refresh(); }
                }}
              >
                Mark all read
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col">
          {items.map((i) => (
            <div key={i.id} className={`border-b border-hairline py-2.5 last:border-0 ${i.status === "READ" ? "opacity-55" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="t-sm whitespace-pre-line text-t1">{i.body}</p>
                {i.status === "FAILED" && <Badge tone="danger">Failed</Badge>}
              </div>
              <span className="t-micro text-faint">{fmtDate(i.at)}</span>
            </div>
          ))}
          {items.length === 0 && <p className="py-10 text-center t-sm text-muted">Nothing yet</p>}
        </div>
      </Sheet>
    </>
  );
}
