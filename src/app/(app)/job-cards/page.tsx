import Link from "next/link";
import { getJobs } from "@/lib/jobs";
import { JobsTable } from "@/components/jobs-table";
import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function JobCardsPage() {
  const u = await getCurrentUser();
  const scope = u?.role === "VENDOR" ? { vendorName: u.vendor ?? "" } : undefined;
  const rows = await getJobs(scope);
  const isVendor = u?.role === "VENDOR";
  return (
    <div className="p-6">
      <PageHeader
        title="Job Cards"
        subtitle={
          isVendor
            ? "Your cutting-to-receipt orders, linked to style and fabric."
            : "Every cutting-to-receipt order, linked to its style, vendor and fabric."
        }
        actions={
          isVendor ? undefined : (
            <Link
              href="/job-cards/new"
              className="rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-indigo-600"
            >
              + New Job Card
            </Link>
          )
        }
      />
      <JobsTable rows={rows} />
    </div>
  );
}
