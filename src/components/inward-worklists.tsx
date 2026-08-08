"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Badge } from "@/components/ui";
import { num, fmtDate } from "@/lib/format";
import { openOrdersForSupplier, linkChallanToOrder } from "@/lib/actions";

type PendingPO = {
  id: number; kind: "fabric" | "trim"; poNumber: string | null; supplier: string; item: string;
  ordered: number; unit: string; received: number; balance: number; expectedDate: Date | null; daysOverdue: number;
};
type PoPendingChallan = { id: number; challanNo: string | null; status: string; date: Date; supplier: string; supplierId: number | null; qty: number; kind: string | null };
type InwardToday = { challans: number; totalRolls: number; totalQty: number; byFabric: { name: string; rolls: number; qty: number }[] };
type OpenOrder = { id: number; kind: "fabric" | "trim"; label: string };

export function InwardWorklists({ today, pendingPOs, poPending }: { today: InwardToday; pendingPOs: PendingPO[]; poPending: PoPendingChallan[] }) {
  return (
    <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
      {/* Change 40 H2.3 — the day's physical inward count. */}
      <Card className="p-5">
        <h3 className="mb-3 t-xs font-bold uppercase tracking-wide text-muted">Inward today</h3>
        {today.challans === 0 ? (
          <p className="py-4 text-center t-sm text-muted">Nothing inwarded yet today.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 t-sm">
              <span><span className="font-bold tnum">{today.challans}</span> <span className="text-muted">challans</span></span>
              <span><span className="font-bold tnum">{today.totalRolls}</span> <span className="text-muted">rolls</span></span>
              <span><span className="font-bold tnum">{num(today.totalQty)}</span> <span className="text-muted">qty</span></span>
            </div>
            {today.byFabric.length > 0 && (
              <ul className="mt-2 space-y-0.5 t-xs text-t2">
                {today.byFabric.map((f) => (
                  <li key={f.name} className="flex justify-between"><span>{f.name}</span><span className="tnum">{f.rolls} rolls · {num(f.qty)}</span></li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      {/* Change 40 H8.1 — challans that arrived with no PO, still unlinked. */}
      <Card className="p-5">
        <h3 className="mb-3 t-xs font-bold uppercase tracking-wide text-muted">P.O. pending <span className="font-normal text-faint">({poPending.length})</span></h3>
        {poPending.length === 0 ? (
          <p className="py-4 text-center t-sm text-muted">No unlinked inward challans.</p>
        ) : (
          <ul className="space-y-2">
            {poPending.map((c) => <PoPendingRow key={c.id} c={c} />)}
          </ul>
        )}
      </Card>

      {/* Change 40 H8.2 — the Pending POs list, owner asked for it by name. */}
      <Card className="p-5 lg:col-span-2">
        <h3 className="mb-3 t-xs font-bold uppercase tracking-wide text-muted">Pending POs <span className="font-normal text-faint">({pendingPOs.length})</span></h3>
        {pendingPOs.length === 0 ? (
          <p className="py-4 text-center t-sm text-muted">No open purchase orders.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full t-sm">
              <thead>
                <tr className="border-b border-border text-left t-micro uppercase tracking-wide text-faint">
                  <th className="px-2 py-2 font-semibold">PO</th>
                  <th className="px-2 py-2 font-semibold">Supplier</th>
                  <th className="px-2 py-2 font-semibold">Item</th>
                  <th className="px-2 py-2 text-right font-semibold">Ordered</th>
                  <th className="px-2 py-2 text-right font-semibold">Received</th>
                  <th className="px-2 py-2 text-right font-semibold">Balance</th>
                  <th className="px-2 py-2 font-semibold">Expected</th>
                </tr>
              </thead>
              <tbody>
                {pendingPOs.map((o) => (
                  <tr key={`${o.kind}-${o.id}`} className="border-b border-hairline last:border-0">
                    <td className="px-2 py-1.5 font-semibold text-t1">{o.poNumber ?? `#${o.id}`}</td>
                    <td className="px-2 py-1.5 text-t2">{o.supplier}</td>
                    <td className="px-2 py-1.5 text-t2">{o.item}</td>
                    <td className="px-2 py-1.5 text-right tnum">{num(o.ordered)} {o.unit}</td>
                    <td className="px-2 py-1.5 text-right tnum">{num(o.received)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tnum">{num(o.balance)}</td>
                    <td className="px-2 py-1.5">
                      {o.expectedDate ? fmtDate(o.expectedDate) : "—"}
                      {o.daysOverdue > 0 && <Badge tone="danger" className="ml-1.5">{o.daysOverdue}d late</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function PoPendingRow({ c }: { c: PoPendingChallan }) {
  const router = useRouter();
  const [orders, setOrders] = useState<OpenOrder[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadOrders() {
    if (!c.supplierId) { alert("This challan has no supplier — can't find its POs."); return; }
    setBusy(true);
    try {
      const rows = await openOrdersForSupplier(c.supplierId, "both");
      setOrders(rows as OpenOrder[]);
    } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  }
  async function link(o: OpenOrder) {
    setBusy(true);
    try {
      await linkChallanToOrder({ challanId: c.id, fabricOrderId: o.kind === "fabric" ? o.id : null, trimOrderId: o.kind === "trim" ? o.id : null });
      router.refresh();
    } catch (e) { alert((e as Error).message); setBusy(false); }
  }

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Link href={`/challan-doc/${c.id}`} className="t-sm font-bold text-primary-ink">{c.challanNo ?? `Draft #${c.id}`}</Link>
        <Badge tone={c.status === "LOCKED" ? "ok" : "warn"}>{c.status}</Badge>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 t-xs text-t2">
        <span className="tnum text-t3">{fmtDate(c.date)}</span>
        <span>{c.supplier}</span>
        <span className="tnum">{num(c.qty)}</span>
      </div>
      {orders == null ? (
        <button onClick={loadOrders} disabled={busy} className="mt-2 t-xs font-semibold text-primary-ink disabled:opacity-40">Link to a PO…</button>
      ) : orders.length === 0 ? (
        <p className="mt-2 t-xs text-faint">No open POs for {c.supplier}.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {orders.map((o) => (
            <button key={`${o.kind}:${o.id}`} onClick={() => link(o)} disabled={busy} className="rounded-md border border-border px-2 py-1 t-micro font-medium text-t1 hover:bg-surface-2 disabled:opacity-40">
              {o.label}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
