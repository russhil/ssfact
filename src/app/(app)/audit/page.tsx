import { redirect } from "next/navigation";
import { getAuditLog, getAuditFilterOptions } from "@/lib/masters";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { AuditLog } from "@/components/audit-log";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  // Defence in depth behind the /audit rule in proxy.ts — same pattern as /users.
  const me = await getCurrentUser();
  if (me?.role !== "ADMIN") redirect("/");

  const [rows, options] = await Promise.all([getAuditLog(), getAuditFilterOptions()]);
  return (
    <div className="p-6">
      <PageHeader title="Audit" subtitle="Last 90 days" />
      <AuditLog rows={rows} options={options} />
    </div>
  );
}
