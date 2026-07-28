import { buildOwnerDigest } from "@/lib/digest";
import { notify, ownerRecipients, isEnabled } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Change 36 Part 2 Part C — the cron entry point.
 *
 * It lives under /api/* deliberately: src/proxy.ts excludes `api` from its auth matcher,
 * so anything outside it would be 302'd to /login and cron would silently "succeed" while
 * fetching a login page. Because it IS outside the session gate, it carries its own
 * secret instead.
 *
 * Install the cron line the way the nightly backup one was installed — `crontab -` eats
 * stdin, so write the file and load it, don't pipe:
 *
 *   0 8 * * * curl -fsS -H "x-cron-key: $CRON_SECRET" http://127.0.0.1:3100/api/cron/digest
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 503 });
  if (req.headers.get("x-cron-key") !== secret) return new Response("Forbidden", { status: 403 });

  const digest = await buildOwnerDigest();
  const recipients = await ownerRecipients();
  let sent = 0;
  for (const r of recipients) {
    if (!(await isEnabled(r.userId, "owner.digest", "INAPP"))) continue;
    await notify({
      to: r.to,
      channel: "INAPP",
      template: "owner.digest",
      body: `${digest.subject}\n${digest.body}`,
      // The digest is a fresh snapshot each morning, so it must not dedupe against
      // yesterday's — the date makes each one its own entity.
      entity: "Digest",
      entityId: new Date().toISOString().slice(0, 10),
      userId: r.userId,
    });
    sent++;
  }
  return Response.json({ ok: true, recipients: sent, body: digest.body });
}
