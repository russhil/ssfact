import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUser, canSeeCost } from "@/lib/auth";
import { getPartyStatement } from "@/lib/party-ledger";
import { PageHeader } from "@/components/ui";
import { PartyAccount } from "@/components/party-account";

export const dynamic = "force-dynamic";

/** Change 36 Part 1 — a supplier's payable account. Owner-only, gated in the body. */
export default async function SupplierAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supplierId = Number(id);
  if (!Number.isFinite(supplierId)) notFound();

  const me = await getCurrentUser();
  if (!canSeeCost(me)) redirect(`/suppliers/${supplierId}`);

  const supplier = await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } });
  if (!supplier) notFound();

  const statement = await getPartyStatement(supplier.id, "SUPPLIER");

  return (
    <div className="p-6">
      <Link href={`/suppliers/${supplier.id}`} className="t-sm text-muted hover:text-ink">← {supplier.name}</Link>
      <PageHeader title={`${supplier.name} · account`} subtitle="Payable on locked inward challans, less payments" />
      <PartyAccount statement={statement} />
    </div>
  );
}
