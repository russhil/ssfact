"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Card,
  Panel,
  Button,
  Field,
  Input,
  Select,
  Badge,
  Sheet,
  StatCard,
  SectionTitle,
  EmptyState,
} from "@/components/ui";
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

      {/* Ageing summarises the ledger, so it reads as its own strip rather than as a card
          whose title would describe only the first of the three things it contains. */}
      <div className="mt-3.5 mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <SectionTitle>Ageing</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="default">0–30 {inr(s.ageing.d0_30)}</Badge>
          <Badge tone="default">31–60 {inr(s.ageing.d31_60)}</Badge>
          <Badge tone="warn">61–90 {inr(s.ageing.d61_90)}</Badge>
          <Badge tone="danger">90+ {inr(s.ageing.d90plus)}</Badge>
        </div>
      </div>

      <Panel
        title="Ledger"
        note={s.lines.length ? `${s.lines.length} ${s.lines.length === 1 ? "entry" : "entries"}` : undefined}
        pad={false}
        actions={
          <>
            <Button size="sm" onClick={() => setOpen("PAYMENT")}><Plus size={12} /> Record payment</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen("ADVANCE")}>Record advance</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen("ADJUSTMENT")}>Adjustment</Button>
          </>
        }
      >
        {s.lines.length === 0 ? (
          <EmptyState title="Nothing on this account yet" />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full t-sm">
              <thead>
                {/* Only Entry flexes; the rest collapse to their content, so the figures sit
                    beside the entry they belong to instead of across a gap of dead space. */}
                <tr className="border-b border-border">
                  <th className="t-label whitespace-nowrap px-[var(--row-px)] py-3 text-left text-t3">Date</th>
                  <th className="t-label w-full px-[var(--row-px)] py-3 text-left text-t3">Entry</th>
                  <th className="t-label whitespace-nowrap px-[var(--row-px)] py-3 text-right text-t3">Owed</th>
                  <th className="t-label whitespace-nowrap px-[var(--row-px)] py-3 text-right text-t3">Paid</th>
                </tr>
              </thead>
              <tbody>
                {s.lines.map((l, i) => (
                  <tr key={i} className="border-b border-hairline last:border-0">
                    <td className="h-[var(--row-h)] whitespace-nowrap px-[var(--row-px)] align-middle text-t2">{fmtDate(l.at)}</td>
                    <td className="h-[var(--row-h)] px-[var(--row-px)] align-middle">
                      {l.href ? (
                        <Link href={l.href} className="text-primary-ink hover:underline">{l.label}</Link>
                      ) : (
                        <span className="text-t1">{l.label}</span>
                      )}
                    </td>
                    <td className="h-[var(--row-h)] whitespace-nowrap px-[var(--row-px)] text-right align-middle tnum">{l.debit ? inr(l.debit) : "—"}</td>
                    <td className="h-[var(--row-h)] whitespace-nowrap px-[var(--row-px)] text-right align-middle tnum text-ok">{l.credit ? inr(l.credit) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

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
