import Link from "next/link";
import { Card, Badge } from "@/components/ui";
import { num, inr, fmtDate } from "@/lib/format";

/**
 * Change 18 Part E — "who quoted what", read-only.
 *
 * The master's rate is an ESTIMATE (entered when the master is created, used as the default
 * everywhere). The TRUE rate lives on each purchase order, because every order's price
 * varies. This panel surfaces the sourcing history so the owner can eyeball rates without
 * opening every PO — it never writes anything, and it is ADMIN-only (cost data).
 */

export type SourcingRate = {
  id: number;
  supplier: string;
  supplierId: number | null;
  rate: number | null;
  poNumber: string | null;
  sourcedAt: Date | string | null;
};

export type SourcingPO = {
  id: number;
  poNumber: string | null;
  supplier: string | null;
  rate: number | null;
  unit: string;
  qty: number;
  orderDate: Date | string | null;
  status: string;
};

export function SourcingPanel({
  rates = [],
  pos,
  unit,
  poHref,
  estimate,
}: {
  rates?: SourcingRate[];
  pos: SourcingPO[];
  unit: string;
  /** `/po` for fabric, `/pot` for trims. */
  poHref: "/po" | "/pot";
  estimate?: number | null;
}) {
  if (rates.length === 0 && pos.length === 0) return null;
  const per = unit ? `/${unit.toLowerCase()}` : "";

  return (
    <Card className="mt-3.5 p-5">
      <h3 className="t-body font-bold">
        Sourcing
      </h3>
      <p className="mt-0.5 t-xs text-faint">
        Master rate{estimate != null ? `: ${inr(estimate)}${per}` : ""}
      </p>

      {rates.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {rates.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1 t-xs">
              <b className="text-primary-ink">{r.supplier}</b>
              <span className="tnum font-semibold">{r.rate != null ? `${inr(r.rate)}${per}` : "—"}</span>
              {r.poNumber && <span className="text-faint tnum">{r.poNumber}</span>}
              {r.sourcedAt && <span className="text-faint">{fmtDate(r.sourcedAt)}</span>}
            </span>
          ))}
        </div>
      )}

      {pos.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
                <th className="py-2 pr-3 font-semibold">PO</th>
                <th className="py-2 pr-3 font-semibold">Supplier</th>
                <th className="py-2 pr-3 text-right font-semibold">Qty</th>
                <th className="py-2 pr-3 text-right font-semibold">Rate</th>
                <th className="py-2 pr-3 font-semibold">Date</th>
                <th className="py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {pos.map((o) => (
                <tr key={o.id} className="border-b border-hairline last:border-0">
                  <td className="py-2 pr-3">
                    {o.poNumber ? (
                      <Link href={`${poHref}/${o.id}`} className="font-semibold text-primary-ink hover:underline tnum">{o.poNumber}</Link>
                    ) : (
                      <span className="text-faint">draft</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-t2">{o.supplier ?? "—"}</td>
                  <td className="py-2 pr-3 text-right tnum">{num(o.qty)} {o.unit.toLowerCase()}</td>
                  <td className="py-2 pr-3 text-right tnum font-semibold">{o.rate != null ? inr(o.rate) : "—"}</td>
                  <td className="py-2 pr-3 text-t2">{fmtDate(o.orderDate)}</td>
                  <td className="py-2"><Badge tone={o.status === "RECEIVED" ? "ok" : "default"}>{o.status.replace("_", " ")}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
