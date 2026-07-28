import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUser, canSeeCost } from "@/lib/auth";
import { getPartyStatement } from "@/lib/party-ledger";
import { Card, PageHeader, DefList, ButtonLink } from "@/components/ui";
import { inr } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Change 36 Part 1 — the supplier detail page, which did not exist before. */
export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supplierId = Number(id);
  if (!Number.isFinite(supplierId)) notFound();

  const supplier = await db.supplier.findUnique({
    where: { id: supplierId },
    include: { contacts: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }, _count: { select: { trims: true, fabricOrders: true, trimOrders: true, materialChallans: true } } },
  });
  if (!supplier) notFound();

  const me = await getCurrentUser();
  const owner = canSeeCost(me);
  const statement = owner ? await getPartyStatement(supplier.id, "SUPPLIER") : null;

  return (
    <div className="p-6">
      <Link href="/suppliers" className="t-sm text-muted hover:text-ink">← Suppliers</Link>
      <PageHeader
        title={supplier.name}
        subtitle={[supplier.type, supplier.city].filter(Boolean).join(" · ") || undefined}
        actions={owner ? <ButtonLink href={`/suppliers/${supplier.id}/account`}>Account</ButtonLink> : undefined}
      />

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 t-body font-bold">Details</h3>
          <DefList
            items={[
              { label: "Phone", value: supplier.phone ?? "—" },
              { label: "Email", value: supplier.email ?? "—" },
              { label: "GST no.", value: supplier.gstNo ?? "—" },
              { label: "Address", value: supplier.address ?? "—" },
              { label: "Contacts", value: supplier.contacts.length ? supplier.contacts.map((c) => `${c.name}${c.role ? ` (${c.role})` : ""}`).join(", ") : "—" },
              { label: "Remarks", value: supplier.remarks ?? "—" },
            ]}
          />
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 t-body font-bold">Activity</h3>
          <DefList
            items={[
              { label: "Trims sourced", value: String(supplier._count.trims) },
              { label: "Fabric orders", value: String(supplier._count.fabricOrders) },
              { label: "Trim orders", value: String(supplier._count.trimOrders) },
              { label: "Challans", value: String(supplier._count.materialChallans) },
              ...(statement ? [{ label: "Outstanding", value: inr(statement.outstanding) }] : []),
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
