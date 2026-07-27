"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { Sheet, Button, Field, Select, Input } from "@/components/ui";
import { generatePO, generateTrimPO } from "@/lib/actions";
import { runAction } from "@/lib/action-result";

/**
 * Change 25 — one dialog for everything a PO needs to know at the moment it is issued.
 *
 * Generating a PO used to be a bare button that only allocated a number. Three parts of
 * this change all attach at exactly that moment, so they share one form rather than
 * three scattered controls:
 *   G.3  which of our firms issues it, and to which of that firm's delivery addresses
 *   K.2  the GST %, stored on the order so a reprint computes the identical figure
 *   I.2  the authorised signatory, defaulting to the person clicking
 *
 * Every field is optional. Leaving them all alone produces exactly the PO the previous
 * button produced, and generation stays idempotent server-side.
 */

export type BuyerOption = {
  id: number;
  name: string;
  gstNo: string | null;
  deliveryAddrs: { id: number; label: string | null; address: string }[];
};

export type SignatoryOption = { id: number; displayName: string; signatureUrl: string | null };

const GST_RATES = ["", "0", "5", "12", "18", "28"];

export function GeneratePoButton({
  orderId,
  kind,
  buyers,
  signatories,
  meId,
  canOverrideSignatory,
  disabled,
}: {
  orderId: number;
  kind: "FABRIC" | "TRIM";
  buyers: BuyerOption[];
  signatories: SignatoryOption[];
  meId: number;
  /** Only an owner may sign on someone else's behalf; the server enforces this too. */
  canOverrideSignatory: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Default to the only firm when there is only one — the common case for a factory
  // that has just added its firms and does not want to re-pick every time.
  const [buyerId, setBuyerId] = useState(() => (buyers.length === 1 ? String(buyers[0].id) : ""));
  const [addrId, setAddrId] = useState("");
  const [gst, setGst] = useState("");
  const [placedById, setPlacedById] = useState(String(meId));

  const buyer = useMemo(() => buyers.find((b) => String(b.id) === buyerId) ?? null, [buyers, buyerId]);
  const addrs = buyer?.deliveryAddrs ?? [];
  // The chosen address must belong to the chosen firm; default to its first.
  const effectiveAddrId = addrs.some((a) => String(a.id) === addrId) ? addrId : addrs[0] ? String(addrs[0].id) : "";

  async function submit() {
    setBusy(true);
    const args = {
      id: orderId,
      buyerId: buyerId ? Number(buyerId) : null,
      deliveryAddressId: effectiveAddrId ? Number(effectiveAddrId) : null,
      gstRate: gst === "" ? null : Number(gst),
      placedById: Number(placedById),
    };
    const ok = await runAction(async () => {
      await (kind === "FABRIC" ? generatePO(args) : generateTrimPO(args));
    });
    if (ok) {
      setOpen(false);
      router.push(kind === "FABRIC" ? `/po/${orderId}` : `/pot/${orderId}`);
    }
    setBusy(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 t-xs font-semibold text-primary-ink hover:bg-surface-2 disabled:opacity-40"
      >
        <FileText size={12} /> Generate PO
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Generate purchase order"
        width={440}
        footer={
          <>
            <Button variant="primary" onClick={submit} disabled={busy}>
              Generate
            </Button>
            <Button onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        }
      >
        <Field label="Issued from">
          <Select value={buyerId} onChange={(e) => { setBuyerId(e.target.value); setAddrId(""); }}>
            <option value="">—</option>
            {buyers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.gstNo ? ` · ${b.gstNo}` : ""}
              </option>
            ))}
          </Select>
        </Field>

        {addrs.length > 0 && (
          <Field label="Deliver to">
            <Select value={effectiveAddrId} onChange={(e) => setAddrId(e.target.value)}>
              {addrs.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label ? `${a.label} — ` : ""}
                  {a.address}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="GST %">
          <Select value={gst} onChange={(e) => setGst(e.target.value)}>
            {GST_RATES.map((r) => (
              <option key={r} value={r}>
                {r === "" ? "—" : `${r}%`}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Authorised signatory">
          {canOverrideSignatory ? (
            <Select value={placedById} onChange={(e) => setPlacedById(e.target.value)}>
              {signatories.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </Select>
          ) : (
            <Input value={signatories.find((s) => s.id === meId)?.displayName ?? ""} readOnly />
          )}
        </Field>
      </Sheet>
    </>
  );
}
