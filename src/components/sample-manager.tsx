"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Button, Field, Input, Select, Badge, Sheet, SortHeader, TableToolbar, useTableView, type FilterDef } from "@/components/ui";
import { runAction } from "@/lib/action-result";
import { createSample } from "@/lib/actions";
import { inr } from "@/lib/format";
import { Plus } from "lucide-react";
import type { SampleRow } from "@/lib/samples";

export const SAMPLE_TONE: Record<string, "ok" | "warn" | "danger" | "default"> = {
  REQUESTED: "default",
  IN_PROGRESS: "warn",
  SUBMITTED: "warn",
  APPROVED: "ok",
  REJECTED: "danger",
};
const LABEL = (s: string) => s.toLowerCase().replace("_", " ");

export function SampleManager({
  samples,
  owner,
  products,
  vendors,
}: {
  samples: SampleRow[];
  owner: boolean;
  products: { id: number; label: string }[];
  vendors: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [productId, setProductId] = useState("");
  const [vendor, setVendor] = useState("");
  const [mrp, setMrp] = useState("");

  const filters: FilterDef<SampleRow>[] = useMemo(
    () => [
      {
        key: "status",
        label: "Status",
        options: ["REQUESTED", "IN_PROGRESS", "SUBMITTED", "APPROVED", "REJECTED"].map((v) => ({ value: v, label: LABEL(v) })),
        match: (s, v) => s.status === v,
      },
    ],
    []
  );

  const view = useTableView<SampleRow>({
    id: "samples",
    rows: samples,
    filters,
    search: (s) => [s.code, s.name, s.product, s.vendor],
    sorts: {
      code: (s) => s.code,
      name: (s) => s.name,
      status: (s) => s.status,
      cost: (s) => s.cost,
    },
  });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <TableToolbar view={view} />
        <Button onClick={() => setOpen(true)}><Plus size={14} /> New sample</Button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5"><SortHeader view={view} sortKey="code">Code</SortHeader></th>
                <th className="px-4 py-2.5"><SortHeader view={view} sortKey="name">Sample</SortHeader></th>
                <th className="px-4 py-2.5 font-semibold">Product</th>
                <th className="px-4 py-2.5 font-semibold">Vendor</th>
                <th className="px-4 py-2.5 text-right font-semibold">Round</th>
                {owner && <th className="px-4 py-2.5 text-right"><SortHeader view={view} sortKey="cost" align="right">Cost</SortHeader></th>}
                <th className="px-4 py-2.5"><SortHeader view={view} sortKey="status">Status</SortHeader></th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((s) => (
                <tr key={s.id} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-2.5">
                    <Link href={`/samples/${s.id}`} className="font-semibold text-primary-ink hover:underline">{s.code}</Link>
                  </td>
                  <td className="px-4 py-2.5">{s.name}</td>
                  <td className="px-4 py-2.5 text-t2">{s.product ?? "—"}</td>
                  <td className="px-4 py-2.5 text-t2">{s.vendor ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tnum text-t2">{s.round}</td>
                  {owner && <td className="px-4 py-2.5 text-right tnum">{s.cost > 0 ? inr(s.cost) : "—"}</td>}
                  <td className="px-4 py-2.5"><Badge tone={SAMPLE_TONE[s.status] ?? "default"}>{LABEL(s.status)}</Badge></td>
                </tr>
              ))}
              {view.rows.length === 0 && (
                <tr><td colSpan={owner ? 7 : 6} className="px-4 py-10 text-center t-sm text-t3">No samples</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="New sample"
        width={380}
        footer={
          <>
            <Button
              className="flex-1"
              disabled={busy || !name.trim()}
              onClick={async () => {
                setBusy(true);
                const ok = await runAction(() =>
                  createSample({
                    name,
                    productId: productId ? Number(productId) : null,
                    vendorName: vendor || null,
                    targetMrp: mrp.trim() === "" ? null : Number(mrp),
                  })
                );
                setBusy(false);
                if (ok) { setOpen(false); setName(""); setProductId(""); setVendor(""); setMrp(""); router.refresh(); }
              }}
            >
              {busy ? "Saving…" : "Create"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          </>
        }
      >
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Polo — navy, round neck" /></Field>
        <Field label="Product (optional)">
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">— new development —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Field>
        <Field label="Vendor">
          <Select value={vendor} onChange={(e) => setVendor(e.target.value)}>
            <option value="">—</option>
            {vendors.map((v) => <option key={v}>{v}</option>)}
          </Select>
        </Field>
        {owner && <Field label="Target MRP"><Input type="number" value={mrp} onChange={(e) => setMrp(e.target.value)} className="text-right tnum" /></Field>}
      </Sheet>
    </>
  );
}
