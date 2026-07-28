"use client";

import { inputClass } from "@/components/ui";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createUser, updateUser, resetUserPassword, setUserActive, deleteUser } from "@/lib/actions";
import { Card, Badge, SearchInput } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { SignatureUpload } from "@/components/signature-upload";
import { Plus, Check, KeyRound, Trash2, X } from "lucide-react";
import type { UserRow } from "@/lib/masters";

const ROLES = ["ADMIN", "STAFF", "VENDOR", "TRIMS"] as const;
type Role = (typeof ROLES)[number];

const ROLE_HINT: Record<Role, string> = {
  ADMIN: "Everything, including this page",
  STAFF: "Day-to-day production — no reports or users",
  VENDOR: "Only their own job cards",
  TRIMS: "Trims and pending trims only",
};

const inp = inputClass("md");

export function UserManager({
  users,
  vendors,
  meId,
}: {
  users: UserRow[];
  vendors: string[];
  meId: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Change 23 Part H: search on the master lists — cheap, and they grow.
  const [q, setQ] = useState("");
  const shown = users.filter((u) => {
    const n = q.trim().toLowerCase();
    return !n || [u.username, u.displayName, u.role, u.vendorName].some((v) => v?.toLowerCase().includes(n));
  });

  // create form
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("STAFF");
  const [vendorName, setVendorName] = useState("");

  // inline rename + password reset
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [resetId, setResetId] = useState<number | null>(null);
  const [resetPw, setResetPw] = useState("");

  /** Every mutation goes through here so a thrown guard ("last active admin") is visible. */
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canAdd =
    username.trim().length >= 3 &&
    !/\s/.test(username.trim()) &&
    !!displayName.trim() &&
    password.length >= 6 &&
    (role !== "VENDOR" || !!vendorName);

  async function add() {
    if (!canAdd) return;
    await run(async () => {
      await createUser({
        username,
        displayName,
        password,
        role,
        vendorName: role === "VENDOR" ? vendorName : null,
      });
      setUsername(""); setDisplayName(""); setPassword(""); setRole("STAFF"); setVendorName("");
    });
  }

  async function saveName(u: UserRow) {
    const next = edits[u.id]?.trim();
    if (!next || next === u.displayName) return;
    await run(async () => {
      await updateUser({ id: u.id, displayName: next });
      setEdits((p) => {
        const { [u.id]: _drop, ...rest } = p;
        return rest;
      });
    });
  }

  async function confirmReset(u: UserRow) {
    if (resetPw.length < 6) return;
    await run(async () => {
      await resetUserPassword({ id: u.id, password: resetPw });
      setResetId(null);
      setResetPw("");
    });
  }

  async function remove(u: UserRow) {
    if (!confirm(`Delete the login "${u.username}"? This cannot be undone — deactivate instead if you may need it back.`)) return;
    await run(() => deleteUser({ id: u.id }));
  }

  return (
    <>
      <Card className="mb-4 p-4">
        <h3 className="mb-3 t-xs font-bold uppercase tracking-wide text-muted">New login</h3>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username (no spaces)"
            className={inp}
          />
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Full name"
            className={inp}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (6+ characters)"
            className={inp}
          />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={inp}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r} — {ROLE_HINT[r]}
              </option>
            ))}
          </select>
          {role === "VENDOR" && (
            <select value={vendorName} onChange={(e) => setVendorName(e.target.value)} className={inp}>
              <option value="">Vendor…</option>
              {vendors.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={add}
            disabled={busy || !canAdd}
            className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary px-3 py-2 t-body font-semibold text-accent-on disabled:opacity-40 md:col-span-3"
          >
            <Plus size={14} /> Add login
          </button>
        </div>
      </Card>

      <>
      {users.length > 8 && (
        <SearchInput
          size="sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search user, name, role…"
          wrapClassName="mb-2 w-72"
        />
      )}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-4 py-2.5 font-semibold">Username</th>
                <th className="px-4 py-2.5 font-semibold">Role</th>
                <th className="px-4 py-2.5 font-semibold">Vendor</th>
                <th className="px-4 py-2.5 font-semibold">Signature</th>
                <th className="px-4 py-2.5 font-semibold">Created</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const isMe = u.id === meId;
                const draft = edits[u.id] ?? u.displayName;
                const dirty = draft.trim() !== u.displayName;
                return (
                  <tr key={u.id} className={`border-b border-hairline last:border-0 ${u.active ? "" : "opacity-50"}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <input
                          value={draft}
                          onChange={(e) => setEdits((p) => ({ ...p, [u.id]: e.target.value }))}
                          onKeyDown={(e) => e.key === "Enter" && saveName(u)}
                          className="w-40 rounded-md border border-transparent px-1.5 py-1 t-sm font-semibold outline-none hover:border-border focus:border-primary"
                        />
                        {dirty && (
                          <button
                            onClick={() => saveName(u)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 t-xs font-semibold text-accent-on disabled:opacity-40"
                          >
                            <Check size={12} /> Save
                          </button>
                        )}
                        {isMe && <Badge tone="primary">you</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-t2">{u.username}</td>
                    <td className="px-4 py-2.5">
                      <select
                        value={u.role}
                        disabled={busy || isMe}
                        onChange={(e) =>
                          run(() => updateUser({ id: u.id, role: e.target.value as Role }))
                        }
                        className="rounded-md border border-border px-2 py-1 t-sm outline-none focus:border-primary disabled:bg-surface-2 disabled:text-t3"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-t2">
                      {u.role === "VENDOR" ? (
                        <select
                          value={u.vendorName ?? ""}
                          disabled={busy}
                          onChange={(e) => run(() => updateUser({ id: u.id, vendorName: e.target.value }))}
                          className="rounded-md border border-border px-2 py-1 t-sm outline-none focus:border-primary"
                        >
                          <option value="">—</option>
                          {[...new Set([...vendors, ...(u.vendorName ? [u.vendorName] : [])])].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      ) : (
                        "—"
                      )}
                    </td>
                    {/* Change 25 Part I.1 — printed on every PO this person raises. */}
                    <td className="px-4 py-2.5">
                      {u.role === "ADMIN" || u.role === "STAFF" ? (
                        <SignatureUpload userId={u.id} signatureUrl={u.signatureUrl} />
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-t2">{fmtDate(u.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => run(() => setUserActive({ id: u.id, active: !u.active }))}
                        disabled={busy || isMe}
                        className="disabled:cursor-not-allowed"
                      >
                        {u.active ? <Badge tone="ok">Active</Badge> : <Badge tone="default">Disabled</Badge>}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      {resetId === u.id ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <input
                            type="password"
                            autoFocus
                            value={resetPw}
                            onChange={(e) => setResetPw(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && confirmReset(u)}
                            placeholder="New password"
                            className="w-32 rounded-md border border-border px-2 py-1 t-sm outline-none focus:border-primary"
                          />
                          <button
                            onClick={() => confirmReset(u)}
                            disabled={busy || resetPw.length < 6}
                            className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 t-xs font-semibold text-accent-on disabled:opacity-40"
                          >
                            <Check size={12} /> Set
                          </button>
                          <button
                            onClick={() => {
                              setResetId(null);
                              setResetPw("");
                            }}
                            className="rounded-md border border-border px-1.5 py-1 text-t2 hover:bg-surface-2"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setResetId(u.id);
                              setResetPw("");
                            }}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 t-xs font-semibold text-t1 hover:bg-surface-2 disabled:opacity-40"
                          >
                            <KeyRound size={12} /> Password
                          </button>
                          {!isMe && (
                            <button
                              onClick={() => remove(u)}
                              disabled={busy}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 t-xs font-semibold text-danger hover:bg-danger-soft disabled:opacity-40"
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      </>
    </>
  );
}
