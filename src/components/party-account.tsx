"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Button, Field, Input, Select, Badge, Sheet, StatCard } from "@/components/ui";
import { runAction } from "@/lib/action-result";
import { recordPayment, recordAdvance, recordAdjustment, setVendorJobRate } from "@/lib/actions";
import { inr, fmtDate } from "@/lib/format";
import type { PartyStatement } from "@/lib/party-ledger";
import { Plus } from "lucide-react";

/**
 * Change 36 Part 1 — one account view for both vendors and suppliers.
 *
 * The derived "billed" sits beside the ledger deliberately: the two must always
 * reconcile, and showing only the balance would hide a rate that has gone missing.
 * Everything here is owner-only — the page decides that, not this component.
 */
export function PartyAccount({
  statement,
  rate,
  rateType,
}: {
  statement: PartyStatement;
  /** Vendors only — the default job-work rate, editable here because it is money. */
  rate?: number | null;
  rateType?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "PAYMENT" | "ADVANCE" | "ADJUSTMENT">(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [rateDraft, setRateDraft] = useState(rate != null ? String(rate) : "");
  const [rateTypeDraft, setRateTypeDraft] = useState(rateType ?? "PER_PIECE");

  const s = statement;
  const party = s.kind === "VENDOR" ? { vendorId: s.partyId } : { supplierId: s.partyId };

  async function submit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    setBusy(true);
    const payload = { ...party, amount: amt, note: note.trim() || null, at: at || null };
    const ok = await runAction(() =>
      open === "PAYMENT" ? recordPayment(payload)
      : open === "ADVANCE" ? recordAdvance(payload)
      : recordAdjustment({ ...payload, reason: reason.trim() })
    );
    setBusy(false);
    if (ok) {
      setOpen(null); setAmount(""); setNote(""); setReason(""); setAt("");
      router.refresh();
    }
  }

  const owed = s.outstanding;
  // Owing them reads as a warning; being in advance with them is fine.
  const tone: "warn" | "ok" | undefined = owed > 0 ? "warn" : owed < 0 ? "ok" : undefined;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Billed (derived)" value={inr(s.billed)} />
        <StatCard label="Paid" value={inr(s.paid)} />
        <StatCard
          label={owed < 0 ? "Advance in hand" : "Outstanding"}
          value={inr(Math.abs(owed))}
          tone={tone}
        />
        <StatCard label="Over 90 days" value={inr(s.ageing.d90plus)} tone={s.ageing.d90plus > 0 ? "danger" : undefined} />
      </div>

      {s.kind === "VENDOR" && (
        <Card className="mt-3 p-4">
          <h3 className="mb-2 t-body font-bold">Job-work rate</h3>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Rate">
              <Input type="number" step="0.01" value={rateDraft} onChange={(e) => setRateDraft(e.target.value)} placeholder="—" className="w-32 text-right tnum" />
            </Field>
            <Field label="Per">
              <Select value={rateTypeDraft} onChange={(e) => setRateTypeDraft(e.target.value)}>
                <option value="PER_PIECE">piece</option>
                <option value="PER_DOZEN">dozen</option>
                <option value="LUMPSUM">lump sum</option>
              </Select>
            </Field>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await runAction(() =>
                  setVendorJobRate({
                    id: s.partyId,
                    jobRate: rateDraft.trim() === "" ? null : Number(rateDraft),
                    jobRateType: rateTypeDraft,
                  })
                );
                setBusy(false);
                if (ok) router.refresh();
              }}
            >
              Save rate
            </Button>
          </div>
          <p className="mt-1.5 t-xs text-t3">
            A layer can carry its own rate, which wins over this one.
          </p>
        </Card>
      )}

      {s.unratedWork && (
        <Card className="mt-3 p-3">
          <p className="t-sm text-warn">
            Some work has no rate agreed, so <b>Billed</b> is lower than the real position.
          </p>
        </Card>
      )}

      <Card className="mt-3 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="t-body font-bold">Ageing</h3>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="default">0–30 {inr(s.ageing.d0_30)}</Badge>
            <Badge tone="default">31–60 {inr(s.ageing.d31_60)}</Badge>
            <Badge tone="warn">61–90 {inr(s.ageing.d61_90)}</Badge>
            <Badge tone="danger">90+ {inr(s.ageing.d90plus)}</Badge>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setOpen("PAYMENT")}><Plus size={12} /> Record payment</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen("ADVANCE")}>Record advance</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen("ADJUSTMENT")}>Adjustment</Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full t-sm">
            <thead>
              <tr className="t-micro font-bold uppercase tracking-wide text-faint">
                <th className="px-2 py-1.5 text-left">Date</th>
                <th className="px-2 py-1.5 text-left">Entry</th>
                <th className="px-2 py-1.5 text-right">Owed</th>
                <th className="px-2 py-1.5 text-right">Paid</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l, i) => (
                <tr key={i} className="border-t border-hairline">
                  <td className="whitespace-nowrap px-2 py-1.5 text-t2">{fmtDate(l.at)}</td>
                  <td className="px-2 py-1.5">
                    {l.href ? (
                      <Link href={l.href} className="text-primary-ink hover:underline">{l.label}</Link>
                    ) : (
                      <span className="text-t1">{l.label}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tnum">{l.debit ? inr(l.debit) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tnum text-ok">{l.credit ? inr(l.credit) : "—"}</td>
                </tr>
              ))}
              {s.lines.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-muted">Nothing on this account yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Sheet
        open={open != null}
        onClose={() => setOpen(null)}
        title={open === "PAYMENT" ? "Record payment" : open === "ADVANCE" ? "Record advance" : "Adjustment"}
        subtitle={s.name}
        width={380}
        footer={
          <>
            <Button className="flex-1" onClick={submit} disabled={busy || !amount}>{busy ? "Saving…" : "Post"}</Button>
            <Button variant="ghost" onClick={() => setOpen(null)} disabled={busy}>Cancel</Button>
          </>
        }
      >
        <Field label="Amount">
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-right tnum" placeholder="0.00" />
        </Field>
        <Field label="Date">
          <Input type="date" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        {open === "ADJUSTMENT" && (
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. rate difference settled" />
          </Field>
        )}
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="cheque no, UPI ref…" />
        </Field>
      </Sheet>
    </>
  );
}
