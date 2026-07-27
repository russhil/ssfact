import { redirect } from "next/navigation";
import { getBuyers } from "@/lib/masters";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { BuyerManager } from "@/components/buyer-manager";

export const dynamic = "force-dynamic";

export default async function BuyersPage() {
  // Defence in depth behind the /buyers rule in proxy.ts — and the only check that
  // survives if that rule is ever edited.
  const me = await getCurrentUser();
  if (me?.role !== "ADMIN" && me?.role !== "STAFF") redirect("/");

  const buyers = await getBuyers();
  return (
    <div className="p-6">
      <PageHeader title="Buyers" />
      <BuyerManager buyers={buyers} />
    </div>
  );
}
