"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupplier, updateSupplier } from "@/lib/actions";
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
  Th,
  inputClass,
  useTableView,
  type CsvExport,
  type FilterDef,
} from "@/components/ui";
import { LookupSelect } from "@/components/masters/lookup-select";
import { ContactRows, blankContact, contactDrafts, contactLabel, type ContactDraft } from "@/components/contact-rows";
import { Pencil, Plus } from "lucide-react";
import type { LookupRow, SupplierRow } from "@/lib/masters";

export function SupplierManager({ suppliers, types = [] }: { suppliers: SupplierRow[]; types?: LookupRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  // Change 25 Part G.1: GST is on the PO, so it belongs on the master.
  const [gstNo, setGstNo] = useState("");
  const [contacts, setContacts] = useState<ContactDraft[]>([blankContact()]);
  const [busy, setBusy] = useState(false);
  // Change 25 Part G.1: the same form edits an existing supplier in place.
  const [editingId, setEditingId] = useState<number | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  function resetForm() {
    setEditingId(null);
    setName(""); setType(""); setCity(""); setPhone(""); setAddress(""); setEmail(""); setGstNo("");
    setContacts([blankContact()]);
  }

  function startEdit(s: SupplierRow) {
    setEditingId(s.id);
    setName(s.name);
    setType(s.type ?? "");
    setCity(s.city ?? "");
    setPhone(s.phone ?? "");
    setAddress(s.address ?? "");
    setEmail(s.email ?? "");
    setGstNo(s.gstNo ?? "");
    setContacts(contactDrafts(s.contacts));
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    const ok = await runAction(fn);
    if (ok) { after?.(); router.refresh(); }
    setBusy(false);
  }

  const payload = () => ({
    name: name.trim(),
    type: type || null,
    city: city || null,
    phone: phone || null,
    address: address || null,
    email: email || null,
    gstNo: gstNo || null,
    contacts,
  });

  const add = () => run(() => createSupplier(payload()), resetForm);
  const save = () => editingId && run(() => updateSupplier({ id: editingId, ...payload() }), resetForm);
  const toggle = (s: SupplierRow) => run(() => updateSupplier({ id: s.id, active: !s.active }));

  /* ---- Change 25 Part G.1: the shared Change 23 toolbar, replacing the
          hand-rolled search that only appeared past eight rows. ---- */

  const typeNames = useMemo(
    () => [...new Set(suppliers.map((s) => (s.type ? String(s.type) : null)).filter((t): t is string => !!t))].sort(),
    [suppliers]
  );
  const filters: FilterDef<SupplierRow>[] = useMemo(
    () => [
      {
        key: "type",
        label: "types",
        options: typeNames.map((t) => ({ value: t, label: t })),
        match: (s, v) => String(s.type ?? "") === v,
      },
      {
        key: "state",
        label: "states",
        options: [
          { value: "ACTIVE", label: "Active only" },
          { value: "INACTIVE", label: "Inactive" },
        ],
        match: (s, v) => (v === "ACTIVE" ? s.active : !s.active),
      },
    ],
    [typeNames]
  );
  const csv: CsvExport<SupplierRow> = {
    filename: "suppliers",
    columns: [
      { header: "supplier", value: (s) => s.name },
      { header: "type", value: (s) => s.type },
      { header: "city", value: (s) => s.city },
      { header: "phone", value: (s) => s.phone },
      { header: "email", value: (s) => s.email },
      { header: "gst_no", value: (s) => s.gstNo },
      { header: "address", value: (s) => s.address },
      { header: "contacts", value: (s) => s.contacts.map(contactLabel).join("; ") },
      { header: "trims", value: (s) => s.trims },
      { header: "orders", value: (s) => s.orders },
      { header: "state", value: (s) => (s.active ? "ACTIVE" : "INACTIVE") },
    ],
  };
  const view = useTableView<SupplierRow>({
    id: "sup",
    rows: suppliers,
    filters,
    search: (s) => [s.name, s.city, s.phone, s.email, s.gstNo, ...s.contacts.map((c) => c.name)],
    sorts: {
      name: (s) => s.name,
      city: (s) => s.city ?? "",
    },
  });

  return (
    <>
      <Card className="mb-4 p-5">
        <div ref={formRef} className="mb-4 flex items-center justify-between">
          <h3 className="t-xs font-bold uppercase tracking-wide text-t3">
            {editingId ? "Edit supplier" : "New supplier"}
          </h3>
          {editingId && (
            <button onClick={resetForm} className="t-xs font-semibold text-t2 transition-colors duration-150 hover:text-danger">
              Cancel
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
          <Field label="Supplier name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Supplier name" />
          </Field>
          {/* Not a <Field>: that wraps its children in a <label>, and LookupSelect's
              inline "add new" mode puts buttons inside — a label would swallow them. */}
          <div className="flex flex-col gap-1.5">
            <span className="t-xs font-semibold text-t2">Type</span>
            <LookupSelect kind="SUPPLIER_TYPE" options={types} value={type} onChange={setType} placeholder="Type" className={selectCls} />
          </div>
          <Field label="City">
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          </Field>
          <Field label="GST no.">
            <Input value={gstNo} onChange={(e) => setGstNo(e.target.value.toUpperCase())} placeholder="GST no." className="tnum" />
          </Field>
          <Field label="Address" className="md:col-span-3">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" />
          </Field>
        </div>

        <div className="mt-4">
          <ContactRows value={contacts} onChange={setContacts} />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button
            variant="primary"
            onClick={editingId ? save : add}
            disabled={busy || !name.trim()}
          >
            {editingId ? <Pencil size={14} /> : <Plus size={14} />}
            {busy ? "Saving…" : editingId ? "Save supplier" : "Add supplier"}
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden p-5">
        <TableToolbar
          view={view}
          filters={filters}
          searchPlaceholder="Search supplier, city, phone, GST, contact…"
          showDate={false}
          csv={csv}
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse t-sm">
            <thead>
              <tr className="border-b border-border">
                <Th><SortHeader view={view} sortKey="name">Supplier</SortHeader></Th>
                <Th>Type</Th>
                <Th><SortHeader view={view} sortKey="city">City</SortHeader></Th>
                <Th>Phone</Th>
                <Th>GST</Th>
                <Th>Contacts</Th>
                <Th className="text-right">Trims</Th>
                <Th className="text-right">Orders</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {view.rows.map((s) => (
                <tr
                  key={s.id}
                  className={`border-b border-hairline last:border-0 ${s.active ? "" : "opacity-55"} ${editingId === s.id ? "bg-accent-soft" : ""}`}
                >
                  <Td className="font-semibold">{s.name}</Td>
                  <Td className="text-t2">{s.type ?? "—"}</Td>
                  <Td className="text-t2">{s.city ?? "—"}</Td>
                  <Td className="text-t2 tnum">{s.phone ?? "—"}</Td>
                  <Td className="text-t2 tnum">{s.gstNo ?? "—"}</Td>
                  <Td className="text-t2">
                    {s.contacts.length === 0 ? "—" : s.contacts.map(contactLabel).join(", ")}
                  </Td>
                  <Td className="text-right tnum text-t2">{s.trims}</Td>
                  <Td className="text-right tnum text-t2">{s.orders}</Td>
                  <Td>
                    <button onClick={() => toggle(s)} disabled={busy}>
                      {s.active ? <Badge tone="ok">Active</Badge> : <Badge tone="default">Inactive</Badge>}
                    </button>
                  </Td>
                  <Td className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(s)} disabled={busy}>
                      <Pencil size={12} /> Edit
                    </Button>
                  </Td>
                </tr>
              ))}
              {view.rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center t-sm text-t3">
                    {suppliers.length === 0 ? "No suppliers" : "No suppliers match these filters"}
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

const selectCls = inputClass("md", "w-full pr-7");
