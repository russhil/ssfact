import Link from "next/link";
import { getJobs, getDraftJobs } from "@/lib/jobs";
import { JobsTable } from "@/components/jobs-table";
import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { DraftsStrip } from "@/components/drafts-strip";

export const dynamic = "force-dynamic";

export default async function JobCardsPage() {
  const u = await getCurrentUser();
  const scope = u?.role === "VENDOR" ? { vendorName: u.vendor ?? "" } : undefined;
  const [rows, drafts] = await Promise.all([getJobs(scope), getDraftJobs(scope)]);
  const isVendor = u?.role === "VENDOR";
  return (
    <div className="p-6">
      <PageHeader
        title="Job Cards"
        subtitle={
          isVendor
            ? "Your orders"
            : "All orders"
        }
        actions={
          isVendor ? undefined : (
            <Link
              href="/job-cards/new"
              className="rounded-lg bg-primary px-3.5 py-2 t-body font-semibold text-accent-on shadow-sm transition hover:opacity-90"
            >
              + New Job Card
            </Link>
          )
        }
      />
      <DraftsStrip drafts={drafts} />
      <JobsTable rows={rows} />
    </div>
  );
}
