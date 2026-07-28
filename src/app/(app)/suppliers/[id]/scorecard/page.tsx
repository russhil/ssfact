import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { getSupplierScore } from "@/lib/supplier-score";
import { Card, PageHeader, StatCard, Badge } from "@/components/ui";
import { num, pct, inr } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Change 36 Part 6 — the scorecard. Every figure is derived; nothing here was typed by
 * anyone. Where a dimension cannot be computed honestly it reads "—" rather than 0.
 */
export default async function SupplierScorecardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supplierId = Number(id);
  if (!Number.isFinite(supplierId)) notFound();

  const supplier = await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } });
  if (!supplier) notFound();
  const s = await getSupplierScore(supplier.id);

  return (
    <div className="p-6">
      <Link href={`/suppliers/${supplier.id}`} className="t-sm text-muted hover:text-ink">← {supplier.name}</Link>
      <PageHeader title={`${supplier.name} · scorecard`} subtitle="Derived from purchase orders and the challans they arrived on" />

      {!s ? (
        <Card className="p-6 text-center t-body text-muted">No purchase orders against this supplier yet</Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="On time"
              value={s.onTimeRate == null ? "—" : pct(s.onTimeRate, 0)}
              foot={`${num(s.completed)} completed`}
              tone={s.onTimeRate != null && s.onTimeRate < 0.7 ? "warn" : undefined}
            />
            <StatCard label="Avg lead time" value={s.avgLeadDays == null ? "—" : `${num(s.avgLeadDays)} d`} foot="order → full receipt" />
            <StatCard
              label="Fill rate"
              value={s.fillRate == null ? "—" : pct(s.fillRate, 0)}
              foot="received ÷ ordered"
              tone={s.fillRate != null && s.fillRate < 0.95 ? "warn" : undefined}
            />
            <StatCard
              label="Price trend"
              value={s.priceTrend == null ? "—" : `${s.priceTrend > 0 ? "+" : ""}${pct(s.priceTrend, 1)}`}
              foot={s.lastRate != null ? `last ${inr(s.lastRate)}` : "no rate history"}
              tone={s.priceTrend != null && s.priceTrend > 0.05 ? "warn" : undefined}
            />
          </div>

          <Card className="mt-3.5 p-4">
            <h3 className="mb-2 t-body font-bold">Open orders</h3>
            <p className="t-sm text-t2">
              {s.open === 0 ? "Nothing outstanding." : `${num(s.open)} order${s.open === 1 ? "" : "s"} not yet fully received.`}
            </p>
            <h3 className="mb-2 mt-4 t-body font-bold">Quality</h3>
            <p className="t-sm text-t2">
              <Badge tone="default">Not attributable yet</Badge>{" "}
              Fabric rejects are recorded, but nothing ties a reject back to the roll&apos;s supplier until lot
              traceability lands.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
