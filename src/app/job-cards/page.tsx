import Link from "next/link";
import { getJobs } from "@/lib/jobs";
import { JobsTable } from "@/components/jobs-table";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function JobCardsPage() {
  const rows = await getJobs();
  return (
    <div className="p-6">
      <PageHeader
        title="Job Cards"
        subtitle="Every cutting-to-dispatch order, linked to its style, vendor and fabric."
        actions={
          <Link
            href="/job-cards/new"
            className="rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-indigo-600"
          >
            + New Job Card
          </Link>
        }
      />
      <JobsTable rows={rows} />
    </div>
  );
}
