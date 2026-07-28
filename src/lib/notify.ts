import "server-only";
import { db } from "@/lib/db";

/**
 * Change 36 Part 2 — the single outbound gateway.
 *
 * A garment factory runs on WhatsApp, but ssfact only ever waited to be clicked: share.ts
 * builds wa.me and mailto links a human has to press. Every alert it already computes —
 * low stock, delayed deliveries, a card routed to a vendor — died on a dashboard nobody
 * keeps open. This makes it push.
 *
 * ★ ONE gateway, many triggers. Two things follow from that:
 *
 * 1. TRANSPORT IS SWAPPABLE AND DEFAULTS TO LOG-ONLY. Every send is recorded as a
 *    Notification row whether or not anything left the building, so the factory gets a
 *    working in-app inbox with zero external setup. Wiring a real WhatsApp Business API
 *    or SMTP sender later means implementing one function here, not touching call sites.
 *
 * 2. A SEND MUST NEVER BREAK THE WORK IT REPORTS. Trigger sites like lockChallan and
 *    addDispatch run inside a $transaction that also writes the stock ledger — awaiting
 *    a transport hiccup in there would roll back a stock posting. So notify() swallows
 *    its own failures into a FAILED row, and callers use notifyAfter() to fire it
 *    strictly AFTER their transaction has committed.
 */

export type Channel = "WHATSAPP" | "EMAIL" | "INAPP";

export type NotifyInput = {
  /** Resolved address, or a party name when we have nothing to send to. */
  to: string;
  channel?: Channel;
  template: string;
  body: string;
  entity?: string | null;
  entityId?: string | number | null;
  /** Whose inbox this lands in. Null = the owner/admin inbox. */
  userId?: number | null;
};

/**
 * The transport seam. Returns true when something actually left the building.
 * Today: nothing does, by design — see the header. A real implementation reads its
 * credentials from env and returns false (not throws) when unconfigured.
 */
async function deliver(input: NotifyInput): Promise<boolean> {
  // No transport is configured, by design. A real implementation dispatches on
  // input.channel, reads its credentials from env, and returns false — not throws —
  // when unconfigured, so an unset key degrades to in-app rather than erroring.
  void input;
  return false;
}

/** Has this exact alert already gone out recently? Stops a daily re-notify storm. */
async function alreadySent(template: string, entityId: string | null, withinHours: number): Promise<boolean> {
  if (!entityId) return false;
  const since = new Date(Date.now() - withinHours * 3600_000);
  const hit = await db.notification.findFirst({
    where: { template, entityId, at: { gte: since } },
    select: { id: true },
  });
  return hit != null;
}

export async function notify(input: NotifyInput): Promise<void> {
  const channel = input.channel ?? "INAPP";
  const entityId = input.entityId == null ? null : String(input.entityId);
  try {
    // getLowStockAlerts() returns EVERY at-or-below item on every run, so a naive
    // trigger would re-notify the same trims daily until someone reorders. Dedupe on
    // (template, entityId) within a day; the inbox stays readable.
    if (await alreadySent(input.template, entityId, 24)) return;

    const sent = await deliver({ ...input, channel });
    await db.notification.create({
      data: {
        to: input.to,
        channel,
        template: input.template,
        body: input.body,
        entity: input.entity ?? null,
        entityId,
        userId: input.userId ?? null,
        status: sent ? "SENT" : "QUEUED",
      },
    });
  } catch (e) {
    // A gateway failure must never surface to the caller — the underlying work already
    // happened and is not in doubt. Record what we can and move on.
    try {
      await db.notification.create({
        data: {
          to: input.to, channel, template: input.template, body: input.body,
          entity: input.entity ?? null, entityId, userId: input.userId ?? null,
          status: "FAILED", error: e instanceof Error ? e.message : String(e),
        },
      });
    } catch {
      /* the DB itself is unavailable; there is nowhere left to record this */
    }
  }
}

/**
 * Fire-and-forget, for use immediately AFTER a transaction commits.
 * Never await this inside a $transaction — see rule 2 in the header.
 */
export function notifyAfter(input: NotifyInput): void {
  void notify(input).catch(() => {});
}

/** Who gets the owner-facing alerts, and at what address. */
export async function ownerRecipients(): Promise<{ userId: number; name: string; to: string }[]> {
  const admins = await db.user.findMany({
    where: { role: "ADMIN", active: true },
    select: { id: true, displayName: true, username: true, phone: true, email: true },
  });
  return admins.map((a) => ({
    userId: a.id,
    name: a.displayName || a.username,
    to: a.phone || a.email || a.displayName || a.username,
  }));
}

/** Resolve a vendor to something we could send to. Falls back to the name. */
export async function vendorRecipient(vendorName: string | null | undefined): Promise<string> {
  if (!vendorName) return "—";
  const v = await db.vendor.findUnique({ where: { name: vendorName }, select: { phone: true, email: true, name: true } });
  return v?.phone || v?.email || v?.name || vendorName;
}

/** Has this user switched the template off for this channel? Absent row = on. */
export async function isEnabled(userId: number, template: string, channel: Channel): Promise<boolean> {
  const pref = await db.notificationPref.findUnique({
    where: { userId_template_channel: { userId, template, channel } },
    select: { enabled: true },
  });
  return pref?.enabled ?? true;
}
