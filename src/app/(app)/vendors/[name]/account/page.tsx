import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUser, canSeeCost } from "@/lib/auth";
import { getPartyStatement } from "@/lib/party-ledger";
import { PageHeader } from "@/components/ui";
import { PartyAccount } from "@/components/party-account";

export const dynamic = "force-dynamic";

/**
 * Change 36 Part 1 — a vendor's operational account.
 *
 * The route is /vendors/[name]/account, not /vendors/[id]/account as the spec wrote it:
 * /vendors/[name] already owns that dynamic segment and two dynamic siblings cannot
 * coexist in the app router.
 *
 * The gate is HERE, in the page body, and not in proxy.ts. That matcher is a first-wins
 * flat prefix list, so { prefix: "/vendors", roles: ["ADMIN","STAFF"] } already matches
 * this URL and hands it to STAFF — a prefix rule cannot express /vendors/*​/account.
 */
export default async function VendorAccountPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const vendorName = decodeURIComponent(name);
  const me = await getCurrentUser();
  if (!canSeeCost(me)) redirect(`/vendors/${encodeURIComponent(vendorName)}`);

  const vendor = await db.vendor.findUnique({ where: { name: vendorName }, select: { id: true, name: true, jobRate: true, jobRateType: true } });
  if (!vendor) notFound();

  const statement = await getPartyStatement(vendor.id, "VENDOR");

  return (
    <>
      <Link href={`/vendors/${encodeURIComponent(vendor.name)}`} className="t-sm text-muted hover:text-ink">← {vendor.name}</Link>
      <PageHeader title={`${vendor.name} · account`} subtitle="Job-work billed on returned pieces, less payments" />
      <PartyAccount statement={statement} rate={vendor.jobRate} rateType={vendor.jobRateType} />
    </>
  );
}
