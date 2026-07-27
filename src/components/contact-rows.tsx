"use client";

import { useId } from "react";
import { X } from "lucide-react";
import { inputClass } from "@/components/ui";

/**
 * Change 25 Part G.0 — the named-people editor, shared by the supplier and buyer
 * masters.
 *
 * Controlled: the parent owns the rows, because it is the parent that hands them to
 * createSupplier / updateSupplier / createBuyer / updateBuyer. The list of rows IS
 * the contact list — passing it to an update action replaces what is stored, so a
 * row removed here disappears there.
 *
 * A trailing blank row is kept automatically (the `normalizeRows` idiom from
 * fabric-order-manager) and blank rows are legal: the actions drop them.
 */

export type ContactDraft = { name: string; role: string; phone: string; email: string };

/** Roles offered as suggestions — a datalist, not a closed list. */
const ROLES = ["Owner", "Accounts", "Dispatch", "Production"];

export const blankContact = (): ContactDraft => ({ name: "", role: "", phone: "", email: "" });

/** Stored contacts re-hydrated for the editor, with the trailing blank row. */
export function contactDrafts(
  rows: { name: string; role: string | null; phone: string | null; email: string | null }[]
): ContactDraft[] {
  return [
    ...rows.map((r) => ({ name: r.name, role: r.role ?? "", phone: r.phone ?? "", email: r.email ?? "" })),
    blankContact(),
  ];
}

/** `Ramesh (Owner)`, `Ramesh` when no role — the table rendering of a contact. */
export const contactLabel = (c: { name: string; role: string | null }) =>
  c.role ? `${c.name} (${c.role})` : c.name;

function normalizeRows(rows: ContactDraft[]): ContactDraft[] {
  const last = rows[rows.length - 1];
  if (last && last.name.trim()) return [...rows, blankContact()];
  return rows;
}

export function ContactRows({
  value,
  onChange,
  label = "Contacts",
}: {
  value: ContactDraft[];
  onChange: (rows: ContactDraft[]) => void;
  label?: React.ReactNode;
}) {
  const listId = useId();
  const rows = value.length === 0 ? [blankContact()] : value;

  const set = (i: number, patch: Partial<ContactDraft>) =>
    onChange(normalizeRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r))));
  const remove = (i: number) =>
    onChange(rows.length <= 1 ? [blankContact()] : rows.filter((_, idx) => idx !== i));

  return (
    <div>
      <div className="mb-1.5 t-xs font-semibold text-t2">{label}</div>
      <datalist id={listId}>
        {ROLES.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <div className="hidden grid-cols-[1.2fr_1fr_1fr_1.4fr_auto] gap-1.5 pb-1 md:grid">
        <span className="t-micro font-bold uppercase tracking-wide text-faint">Name</span>
        <span className="t-micro font-bold uppercase tracking-wide text-faint">Role</span>
        <span className="t-micro font-bold uppercase tracking-wide text-faint">Phone</span>
        <span className="t-micro font-bold uppercase tracking-wide text-faint">Email</span>
        <span className="w-5" />
      </div>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-1 gap-1.5 md:grid-cols-[1.2fr_1fr_1fr_1.4fr_auto]">
            <input
              value={r.name}
              onChange={(e) => set(i, { name: e.target.value })}
              placeholder="Name"
              aria-label="Contact name"
              className={cellCls}
            />
            <input
              value={r.role}
              onChange={(e) => set(i, { role: e.target.value })}
              list={listId}
              placeholder="Role"
              aria-label="Contact role"
              className={cellCls}
            />
            <input
              value={r.phone}
              onChange={(e) => set(i, { phone: e.target.value })}
              placeholder="Phone"
              aria-label="Contact phone"
              className={cellCls}
            />
            <input
              type="email"
              value={r.email}
              onChange={(e) => set(i, { email: e.target.value })}
              placeholder="Email"
              aria-label="Contact email"
              className={cellCls}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label="Remove contact"
              title="Remove contact"
              className="justify-self-start text-faint transition-colors duration-150 hover:text-danger md:self-center md:justify-self-center"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const cellCls = inputClass("sm", "w-full");
