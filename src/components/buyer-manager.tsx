"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBuyer, updateBuyer, deactivateBuyer } from "@/lib/actions";
import { runAction } from "@/lib/action-result";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  SortHeader,
  TableToolbar,
  Td,
  Textarea,
  Th,
  inputClass,
  useTableView,
  type CsvExport,
  type FilterDef,
} from "@/components/ui";
import { ContactRows, blankContact, contactDrafts, contactLabel, type ContactDraft } from "@/components/contact-rows";
import { Pencil, Plus, X } from "lucide-react";
import type { BuyerRow } from "@/lib/masters";

/**
 * Change 25 Part G.2 — the buyer master: which of the owner's own firms a purchase
 * order is issued under, with that firm's GST, registered and billing addresses, its
 * named people, and the set of places goods can be shipped to.
 *
 * Delivery addresses are edited with their ids attached. updateBuyer keeps every id it
 * is given and deactivates the rest — it never deletes, because an already-issued PO
 * points at one by FK. Dropping a row here therefore retires that address rather than
 * blanking the ship-to on an old document.
 */

type AddrDraft = { id?: number; label: string; address: string };

const blankAddr = (): AddrDraft => ({ label: "", address: "" });

function normalizeAddrs(rows: AddrDraft[]): AddrDraft[] {
  const last = rows[rows.length - 1];
  if (last && last.address.trim()) return [...rows, blankAddr()];
  return rows;
}

export function BuyerManager({ buyers }: { buyers: BuyerRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [gstNo, setGstNo] = useState("");
  const [city, setCity] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [contacts, setContacts] = useState<ContactDraft[]>([blankContact()]);
  const [addrs, setAddrs] = useState<AddrDraft[]>([blankAddr()]);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  function resetForm() {
    setEditingId(null);
    setName(""); setGstNo(""); setCity(""); setBuyerAddress(""); setBillingAddress("");
    setContacts([blankContact()]);
    setAddrs([blankAddr()]);
  }

  function startEdit(b: BuyerRow) {
    setEditingId(b.id);
    setName(b.name);
    setGstNo(b.gstNo ?? "");
    setCity(b.city ?? "");
    setBuyerAddress(b.buyerAddress ?? "");
    setBillingAddress(b.billingAddress ?? "");
    setContacts(contactDrafts(b.contacts));
    // Ids ride along so an unchanged address is updated in place, not replaced.
    setAddrs([
      ...b.deliveryAddrs.filter((a) => a.active).map((a) => ({ id: a.id, label: a.label ?? "", address: a.address })),
      blankAddr(),
    ]);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const setAddr = (i: number, patch: Partial<AddrDraft>) =>
    setAddrs((rows) => normalizeAddrs(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r))));
  const removeAddr = (i: number) =>
    setAddrs((rows) => (rows.length <= 1 ? [blankAddr()] : rows.filter((_, idx) => idx !== i)));

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    const ok = await runAction(fn);
    if (ok) { after?.(); router.refresh(); }
    setBusy(false);
  }

  const core = () => ({
    name: name.trim(),
    gstNo: gstNo || null,
    city: city || null,
    buyerAddress: buyerAddress || null,
    billingAddress: billingAddress || null,
    contacts,
  });
  const filledAddrs = () => addrs.filter((a) => a.address.trim());

  const add = () =>
    run(
      () => createBuyer({ ...core(), deliveryAddrs: filledAddrs().map((a) => ({ label: a.label || null, address: a.address })) }),
      resetForm
    );
  const save = () =>
    editingId &&
    run(
      () =>
        updateBuyer({
          id: editingId,
          ...core(),
          deliveryAddrs: filledAddrs().map((a) => ({ id: a.id, label: a.label || null, address: a.address })),
        }),
      resetForm
    );
  const toggle = (b: BuyerRow) => run(() => deactivateBuyer({ id: b.id, active: !b.active }));

  /* ---- the shared Change 23 toolbar ---- */

  const cityNames = useMemo(
    () => [...new Set(buyers.map((b) => b.city).filter((c): c is string => !!c))].sort(),
    [buyers]
  );
  const activeAddrs = (b: BuyerRow) => b.deliveryAddrs.filter((a) => a.active);
  const filters: FilterDef<BuyerRow>[] = useMemo(
    () => [
      {
        key: "state",
        label: "states",
        options: [
          { value: "ACTIVE", label: "Active only" },
          { value: "INACTIVE", label: "Inactive" },
        ],
        match: (b, v) => (v === "ACTIVE" ? b.active : !b.active),
      },
      {
        key: "city",
        label: "cities",
        options: cityNames.map((c) => ({ value: c, label: c })),
        match: (b, v) => b.city === v,
      },
    ],
    [cityNames]
  );
  const csv: CsvExport<BuyerRow> = {
    filename: "buyers",
    columns: [
      { header: "firm", value: (b) => b.name },
      { header: "gst_no", value: (b) => b.gstNo },
      { header: "city", value: (b) => b.city },
      { header: "buyer_address", value: (b) => b.buyerAddress },
      { header: "billing_address", value: (b) => b.billingAddress },
      { header: "contacts", value: (b) => b.contacts.map(contactLabel).join("; ") },
      { header: "delivery_count", value: (b) => activeAddrs(b).length },
      {
        header: "delivery_addresses",
        value: (b) => activeAddrs(b).map((a) => (a.label ? `${a.label}: ${a.address}` : a.address)).join("; "),
      },
      { header: "orders", value: (b) => b.orders },
      { header: "state", value: (b) => (b.active ? "ACTIVE" : "INACTIVE") },
    ],
  };
  const view = useTableView<BuyerRow>({
    id: "buy",
    rows: buyers,
    filters,
    search: (b) => [
      b.name, b.gstNo, b.city, b.buyerAddress, b.billingAddress,
      ...b.contacts.map((c) => c.name),
      ...b.deliveryAddrs.map((a) => a.label),
      ...b.deliveryAddrs.map((a) => a.address),
    ],
    sorts: {
      name: (b) => b.name,
      city: (b) => b.city ?? "",
      orders: (b) => b.orders,
    },
  });

  return (
    <>
      <Card className="mb-4 p-5">
        <div ref={formRef} className="mb-4 flex items-center justify-between">
          <h3 className="t-xs font-bold uppercase tracking-wide text-t3">
            {editingId ? "Edit firm" : "New firm"}
          </h3>
          {editingId && (
            <button onClick={resetForm} className="t-xs font-semibold text-t2 transition-colors duration-150 hover:text-danger">
              Cancel
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
          <Field label="Firm name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Firm name" />
          </Field>
          <Field label="GST no.">
            <Input value={gstNo} onChange={(e) => setGstNo(e.target.value.toUpperCase())} placeholder="GST no." className="tnum" />
          </Field>
          <Field label="City">
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
          </Field>
          <Field label="Registered address" className="md:col-span-3">
            <Textarea rows={2} value={buyerAddress} onChange={(e) => setBuyerAddress(e.target.value)} placeholder="Registered address" />
          </Field>
          <Field label="Billing address" className="md:col-span-3">
            <Textarea rows={2} value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} placeholder="Billing address" />
          </Field>
        </div>

        <div className="mt-4">
          <ContactRows value={contacts} onChange={setContacts} />
        </div>

        <div className="mt-4">
          <div className="mb-1.5 t-xs font-semibold text-t2">Delivery addresses</div>
          <div className="hidden grid-cols-[1fr_3fr_auto] gap-1.5 pb-1 md:grid">
            <span className="t-micro font-bold uppercase tracking-wide text-faint">Label</span>
            <span className="t-micro font-bold uppercase tracking-wide text-faint">Address</span>
            <span className="w-5" />
          </div>
          <div className="space-y-1.5">
            {addrs.map((a, i) => (
              <div key={a.id ?? `new-${i}`} className="grid grid-cols-1 gap-1.5 md:grid-cols-[1fr_3fr_auto]">
                <input
                  value={a.label}
                  onChange={(e) => setAddr(i, { label: e.target.value })}
                  placeholder="Label"
                  aria-label="Delivery address label"
                  className={cellCls}
                />
                <input
                  value={a.address}
                  onChange={(e) => setAddr(i, { address: e.target.value })}
                  placeholder="Address"
                  aria-label="Delivery address"
                  className={cellCls}
                />
                <button
                  type="button"
                  onClick={() => removeAddr(i)}
                  aria-label="Remove delivery address"
                  title="Remove delivery address"
                  className="justify-self-start text-faint transition-colors duration-150 hover:text-danger md:self-center md:justify-self-center"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button variant="primary" onClick={editingId ? save : add} disabled={busy || !name.trim()}>
            {editingId ? <Pencil size={14} /> : <Plus size={14} />}
            {busy ? "Saving…" : editingId ? "Save firm" : "Add firm"}
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden p-5">
        <TableToolbar
          view={view}
          filters={filters}
          searchPlaceholder="Search firm, GST, city, contact, address…"
          showDate={false}
          csv={csv}
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse t-sm">
            <thead>
              <tr className="border-b border-border">
                <Th><SortHeader view={view} sortKey="name">Firm</SortHeader></Th>
                <Th>GST</Th>
                <Th><SortHeader view={view} sortKey="city">City</SortHeader></Th>
                <Th>Contacts</Th>
                <Th className="text-right">Delivery</Th>
                <Th className="text-right"><SortHeader view={view} sortKey="orders" align="right">Orders</SortHeader></Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {view.rows.map((b) => (
                <tr
                  key={b.id}
                  className={`border-b border-hairline last:border-0 ${b.active ? "" : "opacity-55"} ${editingId === b.id ? "bg-accent-soft" : ""}`}
                >
                  <Td className="font-semibold">{b.name}</Td>
                  <Td className="text-t2 tnum">{b.gstNo ?? "—"}</Td>
                  <Td className="text-t2">{b.city ?? "—"}</Td>
                  <Td className="text-t2">
                    {b.contacts.length === 0 ? "—" : b.contacts.map(contactLabel).join(", ")}
                  </Td>
                  <Td className="text-right tnum text-t2">{activeAddrs(b).length}</Td>
                  <Td className="text-right tnum text-t2">{b.orders}</Td>
                  <Td>
                    <button onClick={() => toggle(b)} disabled={busy}>
                      {b.active ? <Badge tone="ok">Active</Badge> : <Badge tone="default">Inactive</Badge>}
                    </button>
                  </Td>
                  <Td className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(b)} disabled={busy}>
                      <Pencil size={12} /> Edit
                    </Button>
                  </Td>
                </tr>
              ))}
              {view.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center t-sm text-t3">
                    {buyers.length === 0 ? "No firms" : "No firms match these filters"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

const cellCls = inputClass("sm", "w-full");
