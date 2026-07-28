"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Field, Input, Badge } from "@/components/ui";
import { runAction } from "@/lib/action-result";
import { setNotificationPref, setMyContact } from "@/lib/actions";

/**
 * Change 36 Part 2 Part D.
 *
 * The templates are listed here rather than read from the database because they are
 * code, not data: a row only exists once someone switches something OFF. An absent
 * preference means the event is on, which is why a fresh install needs no seeding.
 */
const TEMPLATES: { key: string; label: string }[] = [
  { key: "owner.digest", label: "Daily summary" },
  { key: "challan.inward", label: "Material received" },
  { key: "stock.low", label: "Stock at reorder level" },
  { key: "dispatch.done", label: "Dispatch booked" },
  { key: "po.shared", label: "Purchase order shared" },
  { key: "card.routed", label: "Job card routed to a vendor" },
];

const CHANNELS = ["INAPP", "WHATSAPP", "EMAIL"] as const;

export function NotificationSettings({
  phone,
  email,
  prefs,
}: {
  phone: string | null;
  email: string | null;
  prefs: { template: string; channel: string; enabled: boolean }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [p, setP] = useState(phone ?? "");
  const [e, setE] = useState(email ?? "");

  const enabled = (template: string, channel: string) =>
    prefs.find((x) => x.template === template && x.channel === channel)?.enabled ?? true;

  async function toggle(template: string, channel: string) {
    setBusy(true);
    const ok = await runAction(() => setNotificationPref({ template, channel, enabled: !enabled(template, channel) }));
    setBusy(false);
    if (ok) router.refresh();
  }

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
      <Card className="p-4">
        <h3 className="mb-3 t-body font-bold">Where to reach you</h3>
        <Field label="Phone">
          <Input value={p} onChange={(ev) => setP(ev.target.value)} placeholder="WhatsApp number" />
        </Field>
        <Field label="Email">
          <Input value={e} onChange={(ev) => setE(ev.target.value)} placeholder="name@company.com" />
        </Field>
        <Button
          className="mt-2"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const ok = await runAction(() => setMyContact({ phone: p, email: e }));
            setBusy(false);
            if (ok) router.refresh();
          }}
        >
          Save
        </Button>
        <p className="mt-2 t-xs text-t3">
          With neither set, alerts stay in the app.
        </p>
      </Card>

      <Card className="p-4 lg:col-span-2">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="t-body font-bold">Events</h3>
          <Badge tone="default">WhatsApp and email are not connected yet</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full t-sm">
            <thead>
              <tr className="t-micro font-bold uppercase tracking-wide text-faint">
                <th className="px-2 py-1.5 text-left">Event</th>
                {CHANNELS.map((c) => <th key={c} className="px-2 py-1.5">{c === "INAPP" ? "In app" : c === "WHATSAPP" ? "WhatsApp" : "Email"}</th>)}
              </tr>
            </thead>
            <tbody>
              {TEMPLATES.map((t) => (
                <tr key={t.key} className="border-t border-hairline">
                  <td className="px-2 py-1.5 font-semibold text-t1">{t.label}</td>
                  {CHANNELS.map((c) => (
                    <td key={c} className="px-2 py-1.5 text-center">
                      <button onClick={() => toggle(t.key, c)} disabled={busy}>
                        {enabled(t.key, c) ? <Badge tone="ok">On</Badge> : <Badge tone="default">Off</Badge>}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
