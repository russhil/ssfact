import { redirect } from "next/navigation";
import { listUsers, getVendorList } from "@/lib/masters";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { UserManager } from "@/components/user-manager";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  // Defence in depth behind the /users rule in proxy.ts — and the only check that
  // survives if that rule is ever edited.
  const me = await getCurrentUser();
  if (me?.role !== "ADMIN") redirect("/");

  const [users, vendors] = await Promise.all([listUsers(), getVendorList()]);
  return (
    <div className="p-6">
      <PageHeader
        title="Users"
        subtitle="Logins and roles. Deactivate rather than delete — a disabled login keeps its history and can be switched back on."
      />
      <UserManager
        users={users}
        vendors={vendors.filter((v) => v.active).map((v) => v.name)}
        meId={me.userId}
      />
    </div>
  );
}
