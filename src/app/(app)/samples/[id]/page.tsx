import Link from "next/link";
import { notFound } from "next/navigation";
import { getSample, startBulkHref } from "@/lib/samples";
import { getCurrentUser, canSeeCost } from "@/lib/auth";
import { PageHeader, ButtonLink } from "@/components/ui";
import { SampleDetail } from "@/components/sample-detail";

export const dynamic = "force-dynamic";

export default async function SampleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sampleId = Number(id);
  if (!Number.isFinite(sampleId)) notFound();

  const [s, me] = await Promise.all([getSample(sampleId), getCurrentUser()]);
  if (!s) notFound();
  const owner = canSeeCost(me);
  const bulk = startBulkHref({ id: s.id, productId: s.productId });

  return (
    <div className="p-6">
      <Link href="/samples" className="t-sm text-muted hover:text-ink">← Samples</Link>
      <PageHeader
        title={`${s.code} · ${s.name}`}
        subtitle={`Round ${s.round}${s.product ? ` · ${s.product.name || s.product.skuCode}` : ""}`}
        actions={
          <span className="flex gap-2">
            <ButtonLink href={`/sample-doc/${s.id}`} variant="ghost">Tech pack</ButtonLink>
            {s.status === "APPROVED" && bulk && <ButtonLink href={bulk}>Start bulk</ButtonLink>}
          </span>
        }
      />
      <SampleDetail
        sample={{
          id: s.id, code: s.code, name: s.name, round: s.round, status: s.status as string,
          notes: s.notes, remark: s.remark, targetMrp: s.targetMrp,
          vendor: s.vendor?.name ?? null,
          cost: s.cost, margin: s.margin,
        }}
        costLines={s.costLines.map((l) => ({ id: l.id, kind: l.kind as string, description: l.description, qty: l.qty, rate: l.rate }))}
        measurements={s.measurements.map((m) => ({ id: m.id, pom: m.pom, size: m.size, valueCm: m.valueCm, tolerance: m.tolerance }))}
        owner={owner}
        canStartBulk={s.status === "APPROVED" && bulk != null}
      />
    </div>
  );
}
